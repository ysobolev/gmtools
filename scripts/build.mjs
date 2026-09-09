import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
    manifest: "src/extension/manifest.chrome.json",
  },
  {
    browser: "Firefox",
    outdir: "generated/firefox",
    target: "firefox140",
    manifest: "src/extension/manifest.firefox.json",
  },
];
async function buildManifest(source, destination) {
  const manifest = JSON.parse(await readFile(source, "utf8"));
  manifest.version = packageJson.version;
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
}

const hashedFiles = [
  ...(await sourceFiles("src/extension")),
  "src/build-info.ts",
  "src/feedback-schema.ts",
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
const feedbackSubmissionUrl = process.env.GMTOOLS_FEEDBACK_SUBMISSION_URL;
if (feedbackSubmissionUrl !== undefined) {
  const url = new URL(feedbackSubmissionUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("GMTOOLS_FEEDBACK_SUBMISSION_URL must be an HTTP(S) URL without credentials or a fragment.");
  }
  sourceHash.update(`feedbackSubmissionUrl:${feedbackSubmissionUrl}`);
}
const extensionBuildId = sourceHash.digest("hex").slice(0, 12);
const extensionDefines = {
  __GMTOOLS_BUILD_ID__: JSON.stringify(extensionBuildId),
  __GMTOOLS_EXTENSION_VERSION__: JSON.stringify(packageJson.version),
  __GMTOOLS_FEEDBACK_SUBMISSION_URL__: feedbackSubmissionUrl === undefined
    ? "undefined" : JSON.stringify(feedbackSubmissionUrl),
};

const generatedBanner = {
  js: "// Generated from TypeScript by `pnpm build`. Do not edit directly.",
};

await Promise.all(
  extensionBuilds.map(({ outdir }) => mkdir(outdir, { recursive: true })),
);
await mkdir("generated/roll20-mod", { recursive: true });

await Promise.all([
  import("./build-feedback.mjs"),
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
    buildManifest(manifest, `${outdir}/manifest.json`),
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
