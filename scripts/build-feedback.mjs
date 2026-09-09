import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("generated/feedback-worker", { recursive: true });
await build({
  entryPoints: ["src/feedback-worker/index.ts"],
  outfile: "generated/feedback-worker/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  banner: {
    js: "// Generated from TypeScript by `pnpm feedback:build`. Do not edit directly.",
  },
});
