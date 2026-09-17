import { AVAILABLE_PROFILE } from "../src/content/assemble.ts";
import type { ProfileId } from "../src/core/types.ts";

export function profileForMode(mode: string): ProfileId {
  if (["development", "production", "acceptance"].includes(mode)) return AVAILABLE_PROFILE;
  if (!/^m[1-5]$/i.test(mode))
    throw new Error(`未知构建模式 ${mode}；使用 development、production、acceptance 或 m1–m5。`);
  const profile = mode.toUpperCase() as ProfileId;
  if (Number(profile.slice(1)) > Number(AVAILABLE_PROFILE.slice(1)))
    throw new Error(`尚未交付 ${profile}`);
  return profile;
}
