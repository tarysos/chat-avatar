/**
 * Core domain types for the AI Avatar Overlay extension
 */

/**
 * Avatar state representing current activity
 */
export enum AvatarState {
  IDLE = 'idle',
  IDLE2 = 'idle2',
  IDLE3 = 'idle3',
  THINKING = 'thinking',
  HAPPY = 'happy',
  SAD = 'sad',
  EXCITED = 'excited',
  CONFUSED = 'confused',
  ANGRY = 'angry',
  SURPRISED = 'surprised',
  WORRIED = 'worried',
  NEUTRAL = 'neutral',
}

/**
 * Supported LLM providers for emotion analysis
 */
export enum LlmProvider {
  NONE = 'none',
  GEMINI = 'gemini',
  OPENAI = 'openai',
}

/**
 * Supported target websites
 */
export enum TargetSite {
  CHATGPT = 'chatgpt',
  GEMINI = 'gemini',
}

/**
 * Custom avatar images (URLs or data URLs)
 */
export interface CustomAvatarImages {
  [AvatarState.IDLE]?: string;
  [AvatarState.IDLE2]?: string;
  [AvatarState.IDLE3]?: string;
  [AvatarState.THINKING]?: string;
  [AvatarState.HAPPY]?: string;
  [AvatarState.SAD]?: string;
  [AvatarState.EXCITED]?: string;
  [AvatarState.CONFUSED]?: string;
  [AvatarState.ANGRY]?: string;
  [AvatarState.SURPRISED]?: string;
  [AvatarState.WORRIED]?: string;
  [AvatarState.NEUTRAL]?: string;
}

/**
 * Configuration stored in Chrome storage (sync)
 * Note: Custom avatars are stored separately in local storage due to size limits
 */
export interface PageFeatureSettings {
  questionOutline: boolean;
  conversationExport: boolean;
  answerExport: boolean;
  historyDelete: boolean;
}

export interface ExtensionConfig {
  enabled: boolean;
  llmProvider: LlmProvider;
  apiKey?: string;
  modelName?: string;
  avatarStyle: string;
  targetSites: TargetSite[];
  pageFeatures?: Partial<PageFeatureSettings>;
}

/**
 * AI response data extracted from page
 */
export interface AiResponse {
  text: string;
  timestamp: number;
  site: TargetSite;
}

/**
 * Emotion analysis result from LLM
 */
export interface EmotionAnalysis {
  emotion: AvatarState;
  confidence: number;
  reasoning?: string;
}

/**
 * Avatar position on screen
 */
export interface AvatarPosition {
  x: number;
  y: number;
}

/**
 * Message types for communication between content script and background
 */
export enum MessageType {
  ANALYZE_EMOTION = 'ANALYZE_EMOTION',
  EMOTION_RESULT = 'EMOTION_RESULT',
  CONFIG_UPDATED = 'CONFIG_UPDATED',
  GET_CONFIG = 'GET_CONFIG',
  OPEN_OPTIONS = 'OPEN_OPTIONS',
  CLAIM_ONBOARDING = 'CLAIM_ONBOARDING',
}

/**
 * Message structure for extension communication
 */
export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload: T;
}
