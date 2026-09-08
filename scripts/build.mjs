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
const extensionBuilds = [
  {
    browser: "Chrome",
    outdir: "generated/chrome",
    target: "chrome114",
    manifest: "src/extension/static/manifest.chrome.json",
  },
  {
    browser: "Firefox",
    outdir: "generated/firefox",
    target: "firefox140",
    manifest: "src/extension/static/manifest.firefox.json",
  },
];
for (const extensionBuild of extensionBuilds) {
  const manifest = JSON.parse(await readFile(extensionBuild.manifest, "utf8"));
  if (packageJson.version !== manifest.version) {
    throw new Error(
      `package.json and ${extensionBuild.manifest} versions must match.`,
    );
  }
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

await Promise.all(
  extensionBuilds.map(({ outdir }) => mkdir(outdir, { recursive: true })),
);
await mkdir("generated/roll20-mod", { recursive: true });

await Promise.all([
  ...extensionBuilds.flatMap(({ browser, outdir, target, manifest }) => {
    const browserDefines = {
      ...extensionDefines,
      __GMTOOLS_BROWSER_NAME__: JSON.stringify(browser),
    };
    return [
    build({
      entryPoints: ["src/extension/content-script.ts"],
      outdir,
      bundle: true,
      format: "iife",
      platform: "browser",
      target,
      define: browserDefines,
      banner: generatedBanner,
    }),
    build({
      entryPoints: [
        "src/extension/options.tsx",
        "src/extension/service-worker.ts",
        "src/extension/sidepanel.tsx",
      ],
      outdir,
      bundle: true,
      format: "iife",
      platform: "browser",
      target,
      jsx: "automatic",
      define: {
        ...browserDefines,
        "process.env.NODE_ENV": '"production"',
      },
      minify: true,
      banner: generatedBanner,
    }),
    copyFile(manifest, `${outdir}/manifest.json`),
    copyFile("src/extension/static/design-system.css", `${outdir}/design-system.css`),
    copyFile("src/extension/static/options.html", `${outdir}/options.html`),
    copyFile("src/extension/static/options.css", `${outdir}/options.css`),
    copyFile("src/extension/static/sidepanel.html", `${outdir}/sidepanel.html`),
    copyFile("src/extension/static/sidepanel.css", `${outdir}/sidepanel.css`),
    ];
  }),
  build({
    entryPoints: ["src/roll20-mod/GMToolsPoc.ts"],
    outfile: "generated/roll20-mod/GMToolsPoc.js",
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: "es2018",
    banner: generatedBanner,
  }),
]);
