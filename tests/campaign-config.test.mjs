import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/extension/campaign-config.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const campaignConfig = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("campaign behavior overrides global preferences independently", () => {
  const global = {
    unrestrictedWebFetchEnabled: false,
    webSearchEnabled: true,
    requireRoll20Approval: false,
  };
  const campaign = campaignConfig.createCampaignRecord("campaign-1", "Game", 1);
  assert.equal(campaign.memoryEnabled, false);
  const configured = {
    ...campaign,
    overrides: {
      unrestrictedWebFetch: "enabled",
      webSearch: "inherit",
      requireRoll20Approval: "disabled",
    },
  };
  assert.deepEqual(campaignConfig.resolveCampaignBehavior(global, configured), {
    unrestrictedWebFetchEnabled: true,
    webSearchEnabled: true,
    requireRoll20Approval: false,
  });
  assert.deepEqual(campaignConfig.resolveCampaignBehavior(global, undefined), global);
});
