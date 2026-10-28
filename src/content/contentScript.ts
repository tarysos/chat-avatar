/**
 * Content Script - Main entry point for the extension
 * Orchestrates all components following Dependency Injection pattern
 */

import { AvatarOverlay } from '@/avatar/AvatarOverlay';
import { AvatarController } from '@/avatar/AvatarController';
import { ResponseWatcher } from './ResponseWatcher';
import { PageActions } from './PageActions';
import { OnboardingTour } from './OnboardingTour';
import { SiteAdapterFactory } from '@/adapters/SiteAdapterFactory';
import { detectSite } from '@/common/utils';
import { TargetSite, MessageType, AvatarState } from '@/common/types';
import type { AiResponse, ExtensionMessage, EmotionAnalysis, ExtensionConfig } from '@/common/types';
import { STORAGE_KEY_CUSTOM_AVATARS, STORAGE_KEY_CONFIG, STORAGE_KEY_DISPLAY, clampAvatarSize, avatarPositionKey } from '@/common/constants';

class ContentScriptApp {
  private overlay: AvatarOverlay | null = null;
  private controller: AvatarController | null = null;
  private watcher: ResponseWatcher | null = null;
  private siteAdapterFactory: SiteAdapterFactory;
  private currentSite: string | null = null;
  private enabled = true;
  private pageActions: PageActions | null = null;
  private onboarding: OnboardingTour | null = null;

  constructor() {
    this.siteAdapterFactory = new SiteAdapterFactory();
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Detect current site
    this.currentSite = detectSite(window.location.href);
    if (!this.currentSite) {
      console.warn('AI Avatar Overlay: Unsupported site');
      return;
    }

    try {
      // Initialize components
      this.overlay = new AvatarOverlay(this.currentSite as TargetSite);
      this.controller = new AvatarController(this.overlay);
      this.onboarding = new OnboardingTour(this.currentSite as TargetSite, () => {
        chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS, payload: null });
      }, state => this.controller?.setPresentationState(state));

      // Load custom avatars from config
      await this.loadCustomAvatars();
      await this.loadDisplaySettings();
      chrome.storage.onChanged.addListener(this.handleStorageChange);

      // Enable dragging
      this.overlay.enableDragging();

      // Set up response watcher
      const siteAdapter = this.siteAdapterFactory.create(this.currentSite);
      this.watcher = new ResponseWatcher(siteAdapter, this.currentSite as TargetSite);

      // Listen for AI responses
      this.watcher.onResponse((response) => this.handleAiResponse(response));

      // Start the watcher immediately
      // It will handle marking existing responses internally
      this.watcher.start();
      if (this.enabled) this.onboarding.maybeStart();

      console.log('AI Avatar Overlay: Initialized successfully');

      // Listen for messages from background
      chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    } catch (error) {
      console.error('AI Avatar Overlay: Initialization failed', error);
    }
  }

  private async loadCustomAvatars(): Promise<void> {
    try {
      // Load custom avatars from local storage (larger quota)
      const result = await chrome.storage.local.get(STORAGE_KEY_CUSTOM_AVATARS);
      const customAvatars = result[STORAGE_KEY_CUSTOM_AVATARS];

      if (this.controller) {
        this.controller.setCustomAvatars(customAvatars || {});
        this.onboarding?.setImages(customAvatars || {});
        console.log('✅ Custom avatars loaded:', Object.keys(customAvatars || {}).length, 'states');
      }
    } catch (error) {
      console.error('Failed to load custom avatars:', error);
    }
  }

  private async loadDisplaySettings(): Promise<void> {
    const [local, sync]: [Record<string, unknown>, Record<string, unknown>] = await Promise.all([
      chrome.storage.local.get([STORAGE_KEY_DISPLAY, avatarPositionKey(this.currentSite as TargetSite)]).catch(error => {
        console.error('Failed to load avatar display settings:', error); return {};
      }),
      chrome.storage.sync.get(STORAGE_KEY_CONFIG).catch(error => {
        console.error('Failed to load page feature settings:', error); return {};
      }),
    ]);
    const display = local[STORAGE_KEY_DISPLAY] as { size?: unknown } | undefined;
    const config = sync[STORAGE_KEY_CONFIG] as Partial<ExtensionConfig> | undefined;
    this.overlay?.setSize(clampAvatarSize(display?.size));
    this.overlay?.restorePosition(local[avatarPositionKey(this.currentSite as TargetSite)]);
    this.enabled = config?.enabled !== false;
    const pageFeatures = config?.pageFeatures;
    if (this.enabled) this.overlay?.show(); else this.overlay?.hide();
    // Optional page tools must not prevent the original avatar/watcher from starting.
    try {
      this.onboarding?.configure(pageFeatures);
      if (this.pageActions) this.pageActions.setFeatures(pageFeatures);
      else this.pageActions = new PageActions(this.currentSite as TargetSite, pageFeatures);
    } catch (error) { console.error('Failed to initialize page tools:', error); }
  }

  private handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && changes[STORAGE_KEY_CUSTOM_AVATARS]) {
      this.controller?.setCustomAvatars(changes[STORAGE_KEY_CUSTOM_AVATARS].newValue || {});
      this.onboarding?.setImages(changes[STORAGE_KEY_CUSTOM_AVATARS].newValue || {});
    }
    if (area === 'local' && changes[STORAGE_KEY_DISPLAY]) {
      this.overlay?.setSize(clampAvatarSize(changes[STORAGE_KEY_DISPLAY].newValue?.size));
    }
    const positionKey = avatarPositionKey(this.currentSite as TargetSite);
    if (area === 'local' && changes[positionKey]) this.overlay?.restorePosition(changes[positionKey].newValue);
    if (area === 'sync' && changes[STORAGE_KEY_CONFIG]) {
      this.enabled = changes[STORAGE_KEY_CONFIG].newValue?.enabled !== false;
      this.pageActions?.setFeatures(changes[STORAGE_KEY_CONFIG].newValue?.pageFeatures);
      this.onboarding?.configure(changes[STORAGE_KEY_CONFIG].newValue?.pageFeatures);
      if (this.enabled) this.overlay?.show(); else this.overlay?.hide();
    }
  };

  private handleAiResponse(response: AiResponse): void {
    if (!this.controller || !this.enabled) return;

    console.log('📨 Handling AI response in contentScript');

    // Check if LLM emotion analysis is enabled
    this.checkEmotionAnalysis(response);
  }

  private async checkEmotionAnalysis(response: AiResponse): Promise<void> {
    try {
      // Request emotion analysis from background
      const message: ExtensionMessage<AiResponse> = {
        type: MessageType.ANALYZE_EMOTION,
        payload: response,
      };

      chrome.runtime.sendMessage(message, (result) => {
        if (chrome.runtime.lastError) {
          // LLM not configured, keep current state
          console.log('⚠️ Background service error, keeping current state');
          return;
        }

        console.log('🧠 Emotion analysis result:', result);

        if (result && result.emotion) {
          // Use analyzed emotion
          console.log('✨ Using emotion:', result.emotion, `(confidence: ${result.confidence || 'N/A'})`);
          this.controller?.onNewResponse(response.text, result.emotion);
        } else {
          // No emotion detected, keep current state
          console.log('💬 No emotion detected, keeping current state');
        }
      });
    } catch (error) {
      // Fallback to default behavior
      this.controller?.onNewResponse(response.text);
    }
  }

  private handleMessage(
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean {
    switch (message.type) {
      case MessageType.EMOTION_RESULT: {
        const result = message.payload as EmotionAnalysis;
        // This could be used for future enhancements
        console.log('Emotion analysis result:', result);
        sendResponse({ success: true });
        break;
      }
      case MessageType.CONFIG_UPDATED:
        // Reload or update configuration
        this.handleConfigUpdate();
        sendResponse({ success: true });
        break;
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    return true; // Keep message channel open for async response
  }

  private async handleConfigUpdate(): Promise<void> {
    // Reload custom avatars when config is updated
    console.log('Configuration updated, reloading custom avatars...');
    await this.loadCustomAvatars();
    await this.loadDisplaySettings();
  }

  public destroy(): void {
    chrome.storage.onChanged.removeListener(this.handleStorageChange);
    this.watcher?.destroy();
    this.controller?.destroy();
    this.overlay?.destroy();
    this.pageActions?.destroy();
    this.onboarding?.destroy();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ContentScriptApp());
} else {
  new ContentScriptApp();
}
