import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { build, preview } from "vite";
import type { PreviewServer } from "vite";
import { chromium } from "playwright";
import type { ProfileId } from "../src/core/types.ts";
import { verifyArtifacts } from "./verify-artifacts.ts";
import { verifyProductionProfile } from "./browser/production-profile.ts";
import { verifyReviewRegressions } from "./browser/review-regressions.ts";
import { verifyMigrationNotes } from "./browser/migration-notes.ts";
import { verifyFirewallCue } from "./browser/firewall-cue.ts";
import { verifyMenuKeyboard } from "./browser/menu-keyboard.ts";
import { verifyR1Journey } from "./browser/r1-journey.ts";
import { verifyR1StaticBoundaries } from "./browser/r1-static-boundaries.ts";
import { verifyR1ProfileUpgrades } from "./browser/r1-profile-upgrades.ts";
import { verifyR1PlatformBoundaries } from "./browser/r1-platform-boundaries.ts";
import { verifyR1InputRealtimeBoundaries } from "./browser/r1-input-realtime-boundaries.ts";

const reviewOnly = process.argv.includes("--review-only");
if (process.argv.slice(2).some((argument) => argument !== "--review-only"))
  throw new Error("唯一可选参数为 --review-only；发布前必须运行不带参数的完整验证。");
const outputDir = resolve("test-results/r1/pipeline");
await mkdir(outputDir, { recursive: true });
const servers: PreviewServer[] = [];
const browser = await chromium.launch({
  channel: "chrome",
  headless: process.env.CAMELLIA_HEADED !== "1",
});
const results: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  browser: browser.version(),
  node: process.version,
  headless: process.env.CAMELLIA_HEADED !== "1",
  platform: process.platform,
  arch: process.arch,
  mode: reviewOnly ? "targeted-review-regressions" : "full",
  profileChecks: [],
};

async function serveBuiltMode(
  mode: string,
  inspection = false,
): Promise<{ url: string; directory: string }> {
  const directory = join(outputDir, "builds", inspection ? `${mode}-inspection` : mode);
  await build({
    mode,
    ...(inspection ? { define: { "import.meta.env.MODE": JSON.stringify("acceptance") } } : {}),
    build: { outDir: directory, emptyOutDir: true },
  });
  const server = await preview({
    mode,
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
  });
  servers.push(server);
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("无法取得独立 preview 服务端口。");
  return { url: `http://127.0.0.1:${address.port}`, directory };
}

try {
  const production = await serveBuiltMode("production");
  const profiles = results.profileChecks as unknown[];
  profiles.push(await verifyArtifacts(production.directory, "M5"));
  if (!reviewOnly) {
    profiles.push(
      await verifyProductionProfile({
        browser,
        url: production.url,
        profile: "M5",
        outputDir,
        completeJourney: true,
      }),
    );
    for (const profile of ["M1", "M2", "M3", "M4"] as const satisfies readonly ProfileId[]) {
      const artifact = await serveBuiltMode(profile.toLowerCase());
      profiles.push(await verifyArtifacts(artifact.directory, profile));
      profiles.push(
        await verifyProductionProfile({
          browser,
          url: artifact.url,
          profile,
          outputDir,
          completeJourney: false,
        }),
      );
    }
  }
  const acceptance = await serveBuiltMode("acceptance");
  results.menuKeyboard = await verifyMenuKeyboard({ browser, url: production.url, outputDir });
  results.reviewRegressions = await verifyReviewRegressions({
    browser,
    productionUrl: production.url,
    acceptanceUrl: acceptance.url,
    outputDir,
  });
  results.migrationNotes = await verifyMigrationNotes({
    browser,
    productionUrl: production.url,
    outputDir: join(outputDir, "migration-notes"),
  });
  if (!reviewOnly)
    results.r1PlatformBoundaries = await verifyR1PlatformBoundaries({
      browser,
      url: acceptance.url,
      alternateUrl: production.url,
      outputDir,
    });
  if (!reviewOnly)
    results.r1InputRealtimeBoundaries = await verifyR1InputRealtimeBoundaries({
      browser,
      url: acceptance.url,
      outputDir,
    });
  results.firewallCue = await verifyFirewallCue({
    browser,
    url: production.url,
    acceptanceUrl: acceptance.url,
    outputDir,
  });
  if (!reviewOnly) {
    const journeys: unknown[] = [];
    const observationArtifacts = new Map<string, { url: string; directory: string }>();
    for (const profile of ["M5", "M1", "M2", "M3"] as const) {
      // Production clipping is checked above. A separately built observation variant exposes only read-only snapshots.
      const artifact =
        profile === "M5" ? acceptance : await serveBuiltMode(profile.toLowerCase(), true);
      observationArtifacts.set(profile, artifact);
      journeys.push(
        await verifyR1Journey({ browser, url: artifact.url, profile, route: "full", outputDir }),
      );
    }
    results.r1Journeys = journeys;
    results.r1StaticBoundaries = await verifyR1StaticBoundaries({
      browser,
      url: acceptance.url,
      outputDir,
      sourceSavePath: join(outputDir, "m5-full", "earned-save.json"),
    });
    const m4Observation = await serveBuiltMode("m4", true);
    observationArtifacts.set("M4", m4Observation);
    results.r1ProfileUpgrades = await verifyR1ProfileUpgrades({
      browser,
      urls: {
        M2: observationArtifacts.get("M2")!.url,
        M3: observationArtifacts.get("M3")!.url,
        M4: m4Observation.url,
      },
      sourceSavePath: join(outputDir, "m1-full", "earned-save.json"),
      outputDir,
    });
    results.r1M3ToM4Journey = await verifyR1Journey({
      browser,
      url: m4Observation.url,
      profile: "M4",
      route: "full",
      outputDir,
      sourceSavePath: join(outputDir, "m3-full", "earned-save.json"),
    });
  }
  results.success = true;
  console.log(
    reviewOnly
      ? "Chrome 定向故障与接线回归通过；未执行完整分期矩阵。"
      : "Chrome 正常键鼠、保存恢复、分期产物与故障回归全部通过。",
  );
} catch (error) {
  results.success = false;
  results.error = error instanceof Error ? error.stack : String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(
    join(outputDir, reviewOnly ? "browser-review-results.json" : "browser-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  await browser.close();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((done, fail) =>
          server.httpServer.close((error) => (error ? fail(error) : done())),
        ),
    ),
  );
}
