/**
 * Application constants
 */

import type { ExtensionConfig, PageFeatureSettings } from './types';
import { AvatarState, LlmProvider, TargetSite } from './types';

/**
 * Default configuration
 */
export const DEFAULT_PAGE_FEATURES: PageFeatureSettings = {
  questionOutline: true,
  conversationExport: true,
  answerExport: true,
  historyDelete: true,
};

/** Older saved settings keep all existing page tools enabled. */
export function resolvePageFeatures(settings?: Partial<PageFeatureSettings>): PageFeatureSettings {
  return {
    questionOutline: settings?.questionOutline !== false,
    conversationExport: settings?.conversationExport !== false,
    answerExport: settings?.answerExport !== false,
    historyDelete: settings?.historyDelete !== false,
  };
}

export const DEFAULT_CONFIG: ExtensionConfig = {
  enabled: true,
  llmProvider: LlmProvider.NONE,
  avatarStyle: 'default',
  targetSites: [TargetSite.CHATGPT, TargetSite.GEMINI],
  pageFeatures: { ...DEFAULT_PAGE_FEATURES },
};

/**
 * Avatar state to image file mapping
 */
export const AVATAR_IMAGES: Record<AvatarState, string> = {
  [AvatarState.IDLE]: 'assets/avatar/idle.svg',
  [AvatarState.IDLE2]: 'assets/avatar/idle2.svg',
  [AvatarState.IDLE3]: 'assets/avatar/idle3.svg',
  [AvatarState.THINKING]: 'assets/avatar/thinking.svg',
  [AvatarState.HAPPY]: 'assets/avatar/happy.svg',
  [AvatarState.SAD]: 'assets/avatar/sad.svg',
  [AvatarState.EXCITED]: 'assets/avatar/excited.svg',
  [AvatarState.CONFUSED]: 'assets/avatar/confused.svg',
  [AvatarState.ANGRY]: 'assets/avatar/angry.svg',
  [AvatarState.SURPRISED]: 'assets/avatar/surprised.svg',
  [AvatarState.WORRIED]: 'assets/avatar/worried.svg',
  [AvatarState.NEUTRAL]: 'assets/avatar/neutral.svg',
};

/**
 * Avatar overlay DOM IDs
 */
export const AVATAR_OVERLAY_ID = 'ai-avatar-overlay';
export const AVATAR_IMAGE_ID = 'ai-avatar-img';

/**
 * Speaking duration calculation: minimum duration + per-character duration
 */
export const SPEAKING_BASE_DURATION_MS = 1000;
export const SPEAKING_DURATION_PER_CHAR_MS = 50;

/**
 * Chrome storage keys
 */
export const STORAGE_KEY_CONFIG = 'extensionConfig';
export const STORAGE_KEY_CUSTOM_AVATARS = 'customAvatars';
export const STORAGE_KEY_DISPLAY = 'avatarDisplay';
export const STORAGE_KEY_ONBOARDING = 'avatarOnboardingV1';
export const avatarPositionKey = (site: TargetSite): string => `avatarPosition:${site}`;
export const DEFAULT_AVATAR_SIZE = 128;
export const MIN_AVATAR_SIZE = 64;
export const MAX_AVATAR_SIZE = 320;

export function clampAvatarSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_AVATAR_SIZE, Math.min(MAX_AVATAR_SIZE, Math.round(value)))
    : DEFAULT_AVATAR_SIZE;
}

/**
 * Site-specific selectors
 */
export const SITE_SELECTORS = {
  [TargetSite.CHATGPT]: {
    responseContainer: '[data-message-author-role="assistant"]',
    userInputContainer: '[data-message-author-role="user"]',
    textContent: '.markdown',
  },
  [TargetSite.GEMINI]: {
    responseContainer: '.model-response-text',
    userInputContainer: '.user-query',
    textContent: '.message-content',
  },
} as const;
