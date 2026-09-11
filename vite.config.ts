import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import assetManifest from "./public/assets/manifest.json" with { type: "json" };
import { assembleContent, AVAILABLE_PROFILE } from "./src/content/assemble.ts";
import type { ProfileId } from "./src/core/types.ts";

export default defineConfig(({ mode }) => {
  const selected = /^m[1-5]$/i.test(mode) ? (mode.toUpperCase() as ProfileId) : AVAILABLE_PROFILE;
  if (Number(selected.slice(1)) > Number(AVAILABLE_PROFILE.slice(1)))
    throw new Error(`尚未交付 ${selected}`);
  return {
    server: { host: "localhost", port: 5174, strictPort: true },
    preview: { host: "localhost", port: 5174, strictPort: true },
    build: { target: ["es2022", "safari17"], chunkSizeWarningLimit: 650, copyPublicDir: false },
    plugins: [
      {
        name: "fixed-camellia-profile",
        resolveId(id) {
          if (id === "virtual:camellia-content") return "\0virtual:camellia-content";
        },
        load(id) {
          if (id === "\0virtual:camellia-content")
            return `export default ${JSON.stringify(assembleContent(selected))};`;
        },
        generateBundle() {
          const assets = assetManifest.assets.filter((asset) => asset.profiles.includes(selected));
          const paths = new Set(
            assets
              .flatMap((asset) => [
                asset.localPath,
                "raster" in asset ? asset.raster?.localPath : undefined,
                "licenseLocalPath" in asset ? asset.licenseLocalPath : undefined,
              ])
              .filter((path): path is string => typeof path === "string"),
          );
          for (const path of paths)
            this.emitFile({
              type: "asset",
              fileName: path.slice(1),
              source: readFileSync(new URL(`./public${path}`, import.meta.url)),
            });
          this.emitFile({
            type: "asset",
            fileName: "assets/manifest.json",
            source: JSON.stringify({ ...assetManifest, profile: selected, assets }, null, 2),
          });
        },
      },
    ],
  };
});
