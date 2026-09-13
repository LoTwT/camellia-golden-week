import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { verifyArtifacts } from "../../scripts/verify-artifacts.ts";
import manifest from "../../public/assets/manifest.json" with { type: "json" };

test("发布产物拒绝错误分期、漏入口、隐藏诊断和未声明的未来资源", async () => {
  const directory = await mkdtemp(join(tmpdir(), "camellia-artifacts-"));
  try {
    await cp(resolve("public/assets"), join(directory, "assets"), { recursive: true });
    await rm(join(directory, "assets/font-manifest.json"));
    await writeFile(
      join(directory, "assets/manifest.json"),
      JSON.stringify({ ...manifest, profile: "M5" }),
    );
    await writeFile(
      join(directory, "index.html"),
      '<script type="module" src="/assets/game.js"></script>',
    );
    const entry = join(directory, "assets/game.js");
    await writeFile(entry, "export {};");
    await verifyArtifacts(directory, "M5");
    await assert.rejects(verifyArtifacts(directory, "M1"), /请求的 profile/);
    await writeFile(entry, "window.__CAMELLIA_INSPECT__ = {};");
    await assert.rejects(verifyArtifacts(directory, "M5"), /不得包含验收入口/);
    await writeFile(entry, "export {};");
    const extra = join(directory, "assets/future-only.svg");
    await writeFile(extra, "<svg/>");
    await assert.rejects(verifyArtifacts(directory, "M5"), /未声明的资源/);
    await rm(extra);
    await writeFile(join(directory, "index.html"), "<main></main>");
    await assert.rejects(verifyArtifacts(directory, "M5"), /游戏入口/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
