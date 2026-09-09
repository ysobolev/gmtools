import type { GlobalPreferences } from "./global-preferences";
import { isRoll20SandboxVersion, type Roll20SandboxVersion } from "../protocol";
import { DEFAULT_PROFILE } from "./profile-config";

export const CAMPAIGN_OVERRIDE_VALUES = [
  "inherit",
  "enabled",
  "disabled",
] as const;
export type CampaignOverride = (typeof CAMPAIGN_OVERRIDE_VALUES)[number];

export interface CampaignOverrides {
  readonly unrestrictedWebFetch: CampaignOverride;
  readonly webSearch: CampaignOverride;
  readonly requireRoll20Approval: CampaignOverride;
}

export interface CampaignRecord {
  readonly campaignId: string;
  readonly name: string;
  readonly defaultProfileId: string;
  readonly overrides: CampaignOverrides;
  readonly memoryEnabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sandboxVersion?: Roll20SandboxVersion;
  readonly sandboxObservedAt?: number;
}

export const DEFAULT_CAMPAIGN_OVERRIDES: CampaignOverrides = {
  unrestrictedWebFetch: "inherit",
  webSearch: "inherit",
  requireRoll20Approval: "inherit",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCampaignOverride(value: unknown): value is CampaignOverride {
  return CAMPAIGN_OVERRIDE_VALUES.includes(value as CampaignOverride);
}

export function isCampaignRecord(value: unknown): value is CampaignRecord {
  if (!isRecord(value) || !isRecord(value.overrides)) return false;
  return (
    typeof value.campaignId === "string" &&
    value.campaignId.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.defaultProfileId === "string" &&
    value.defaultProfileId.length > 0 &&
    isCampaignOverride(value.overrides.unrestrictedWebFetch) &&
    isCampaignOverride(value.overrides.webSearch) &&
    isCampaignOverride(value.overrides.requireRoll20Approval) &&
    typeof value.memoryEnabled === "boolean" &&
    (value.sandboxVersion === undefined || isRoll20SandboxVersion(value.sandboxVersion)) &&
    (value.sandboxObservedAt === undefined || (typeof value.sandboxObservedAt === "number" && Number.isFinite(value.sandboxObservedAt))) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

export function createCampaignRecord(
  campaignId: string,
  name: string,
  now = Date.now(),
): CampaignRecord {
  return {
    campaignId,
    name: name.trim() || "Roll20 campaign",
    defaultProfileId: DEFAULT_PROFILE.id,
    overrides: DEFAULT_CAMPAIGN_OVERRIDES,
    memoryEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

function resolveOverride(value: CampaignOverride, globalValue: boolean): boolean {
  return value === "inherit" ? globalValue : value === "enabled";
}

export function resolveCampaignBehavior(
  globalPreferences: GlobalPreferences,
  campaign: CampaignRecord | undefined,
): Pick<
  GlobalPreferences,
  | "unrestrictedWebFetchEnabled"
  | "webSearchEnabled"
  | "requireRoll20Approval"
> {
  if (!campaign) {
    return {
      unrestrictedWebFetchEnabled:
        globalPreferences.unrestrictedWebFetchEnabled,
      webSearchEnabled: globalPreferences.webSearchEnabled,
      requireRoll20Approval: globalPreferences.requireRoll20Approval,
    };
  }
  return {
    unrestrictedWebFetchEnabled: resolveOverride(
      campaign.overrides.unrestrictedWebFetch,
      globalPreferences.unrestrictedWebFetchEnabled,
    ),
    webSearchEnabled: resolveOverride(
      campaign.overrides.webSearch,
      globalPreferences.webSearchEnabled,
    ),
    requireRoll20Approval: resolveOverride(
      campaign.overrides.requireRoll20Approval,
      globalPreferences.requireRoll20Approval,
    ),
  };
}
