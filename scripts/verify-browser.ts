import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { build, preview } from "vite";
import type { PreviewServer } from "vite";
import { chromium } from "playwright";
import type { ProfileId } from "../src/core/types.ts";
import { verifyArtifacts } from "./verify-artifacts.ts";
import { verifyProductionProfile } from "./browser/production-profile.ts";
import { verifyReviewRegressions } from "./browser/review-regressions.ts";
import { verifyFirewallCue } from "./browser/firewall-cue.ts";

const reviewOnly = process.argv.includes("--review-only");
if (process.argv.slice(2).some((argument) => argument !== "--review-only"))
  throw new Error("唯一可选参数为 --review-only；发布前必须运行不带参数的完整验证。");
const outputDir = resolve("test-results/review-fixes/pipeline");
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
  mode: reviewOnly ? "targeted-review-regressions" : "full",
  profileChecks: [],
};

async function serveBuiltMode(mode: string): Promise<{ url: string; directory: string }> {
  const directory = join(outputDir, "builds", mode);
  await build({ mode, build: { outDir: directory, emptyOutDir: true } });
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
  results.reviewRegressions = await verifyReviewRegressions({
    browser,
    productionUrl: production.url,
    acceptanceUrl: acceptance.url,
    outputDir,
  });
  results.firewallCue = await verifyFirewallCue({ browser, url: production.url, outputDir });
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
