import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import sourceManifest from "../public/assets/manifest.json" with { type: "json" };
import type { ProfileId } from "../src/core/types.ts";

export async function verifyArtifacts(directory: string, profile: ProfileId): Promise<unknown> {
  const root = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(root, "assets/manifest.json"), "utf8"),
  ) as typeof sourceManifest & {
    profile: ProfileId;
  };
  assert.equal(manifest.profile, profile, "产物 manifest 必须标识请求的 profile");
  const expected = sourceManifest.assets.filter((asset) => asset.profiles.includes(profile));
  assert.deepEqual(manifest.assets, expected, "产物资源必须恰好属于当前 profile，不能混入未来分期");
  const paths = new Set<string>();
  for (const asset of expected) {
    const representations = [{ localPath: asset.localPath, sha256: asset.sha256 }];
    if ("raster" in asset && asset.raster) representations.push(asset.raster);
    for (const representation of representations) {
      const bytes = await readFile(join(root, representation.localPath));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        representation.sha256,
        representation.localPath,
      );
      paths.add(representation.localPath);
    }
    if ("licenseLocalPath" in asset && typeof asset.licenseLocalPath === "string") {
      assert.ok((await readFile(join(root, asset.licenseLocalPath))).length > 0);
      paths.add(asset.licenseLocalPath);
    }
  }
  const html = await readFile(join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(
    (match) => match[1]!,
  );
  assert.ok(scripts.length > 0, "静态页面必须引用构建后的游戏入口");
  for (const script of scripts) assert.ok((await readFile(join(root, script))).length > 0);
  const files = await readdir(root, { recursive: true });
  const declared = new Set([
    "index.html",
    "assets/manifest.json",
    ...[...paths].map((path) => path.slice(1)),
  ]);
  for (const file of files)
    if ((await stat(join(root, file))).isFile())
      assert.ok(
        declared.has(file.replaceAll("\\", "/")) || /\.(?:js|css)$/.test(file),
        `产物包含当前 profile 未声明的资源：${file}`,
      );
  const javascriptFiles = files.filter((file) => file.endsWith(".js"));
  for (const file of javascriptFiles) {
    const code = await readFile(join(root, file), "utf8");
    for (const marker of [
      "__CAMELLIA_INSPECT__",
      "camellia-inspection",
      "data-acceptance-faults",
      "camellia.acceptance.session",
    ])
      assert.equal(code.includes(marker), false, `正式包 ${file} 不得包含验收入口 ${marker}`);
  }
  return { profile, assets: expected.length, representations: paths.size, javascriptFiles };
}

if (import.meta.main) {
  const profile = process.argv[3] ?? "M5";
  assert.match(profile, /^M[1-5]$/);
  console.log(
    JSON.stringify(await verifyArtifacts(process.argv[2] ?? "dist", profile as ProfileId), null, 2),
  );
}
