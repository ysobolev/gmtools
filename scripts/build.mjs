import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

const generatedBanner = {
  js: "// Generated from TypeScript by `pnpm build`. Do not edit directly.",
};

await mkdir("extension", { recursive: true });
await mkdir("roll20-mod", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/extension/content-script.ts"],
    outdir: "extension",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome114",
    banner: generatedBanner,
  }),
  build({
    entryPoints: [
      "src/extension/service-worker.ts",
      "src/extension/sidepanel.tsx",
    ],
    outdir: "extension",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome114",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    banner: generatedBanner,
  }),
  build({
    entryPoints: ["src/roll20-mod/GMToolsPoc.ts"],
    outfile: "roll20-mod/GMToolsPoc.js",
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: "es2018",
    banner: generatedBanner,
  }),
  copyFile("src/extension/static/manifest.json", "extension/manifest.json"),
  copyFile("src/extension/static/sidepanel.html", "extension/sidepanel.html"),
  copyFile("src/extension/static/sidepanel.css", "extension/sidepanel.css"),
]);
