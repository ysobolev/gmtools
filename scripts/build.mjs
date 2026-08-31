import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";

async function sourceFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const child = `${path}/${entry.name}`;
      return entry.isDirectory() ? sourceFiles(child) : [child];
    }),
  );
  return files.flat();
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(
  await readFile("src/extension/static/manifest.json", "utf8"),
);
if (packageJson.version !== manifest.version) {
  throw new Error("package.json and extension manifest versions must match.");
}

const hashedFiles = [
  ...(await sourceFiles("src/extension")),
  "src/build-info.ts",
  "src/protocol.ts",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/build.mjs",
].sort();
const sourceHash = createHash("sha256");
for (const file of hashedFiles) {
  sourceHash.update(file);
  sourceHash.update(await readFile(file));
}
const extensionBuildId = sourceHash.digest("hex").slice(0, 12);
const extensionDefines = {
  __GMTOOLS_BUILD_ID__: JSON.stringify(extensionBuildId),
  __GMTOOLS_EXTENSION_VERSION__: JSON.stringify(packageJson.version),
};

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
    define: extensionDefines,
    banner: generatedBanner,
  }),
  build({
    entryPoints: [
      "src/extension/options.tsx",
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
      ...extensionDefines,
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
  copyFile("src/extension/static/options.html", "extension/options.html"),
  copyFile("src/extension/static/options.css", "extension/options.css"),
  copyFile("src/extension/static/sidepanel.html", "extension/sidepanel.html"),
  copyFile("src/extension/static/sidepanel.css", "extension/sidepanel.css"),
]);
