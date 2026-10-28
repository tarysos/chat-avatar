/**
 * AvatarController - Controls avatar state transitions
 * Follows Single Responsibility Principle: manages state logic only
 */

import type { IAvatarController, IAvatarOverlay } from '@/common/interfaces';
import type { CustomAvatarImages } from '@/common/types';
import { AvatarState } from '@/common/types';
import { AVATAR_IMAGES } from '@/common/constants';
import { getAssetUrl, calculateSpeakingDuration } from '@/common/utils';

export class AvatarController implements IAvatarController {
  private currentState: AvatarState = AvatarState.IDLE;
  private stateChangeCallbacks: Array<(state: AvatarState) => void> = [];
  private stateTimeout: ReturnType<typeof setTimeout> | null = null;
  private customAvatars: CustomAvatarImages = {};
  private presentationState: AvatarState | null = null;
  private lastIdleVariant: AvatarState = AvatarState.IDLE;
  private autoResetTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly AUTO_RESET_DELAY = 3 * 60 * 1000; // 3 minutes in milliseconds

  constructor(private overlay: IAvatarOverlay) {
    // Delay initial state to ensure chrome API is ready
    setTimeout(() => {
      this.setState(this.getRandomIdleVariant());
    }, 100);
  }

  /**
   * Get a random idle variant different from the last one
   */
  private getRandomIdleVariant(): AvatarState {
    const idleVariants = [AvatarState.IDLE, AvatarState.IDLE2, AvatarState.IDLE3];

    // Filter out the last used variant
    const availableVariants = idleVariants.filter(v => v !== this.lastIdleVariant);

    // Pick a random one from the available variants
    const randomVariant = availableVariants[Math.floor(Math.random() * availableVariants.length)];

    this.lastIdleVariant = randomVariant;
    return randomVariant;
  }

  /**
   * Set custom avatar images
   */
  public setCustomAvatars(customAvatars: CustomAvatarImages): void {
    this.customAvatars = customAvatars;
    // Update current state image
    this.updateOverlayImage();
  }

  /** Temporarily speak with the existing avatar; keep live response state underneath. */
  public setPresentationState(state: AvatarState | null): void {
    this.presentationState = state;
    this.updateOverlayImage();
  }

  public setState(state: AvatarState): void {
    // If setting to IDLE, randomly choose a variant
    let actualState = state;
    if (state === AvatarState.IDLE) {
      actualState = this.getRandomIdleVariant();
    }

    if (this.currentState === actualState) return;

    this.currentState = actualState;
    this.updateOverlayImage();
    this.notifyStateChange();

    // Clear any pending state transitions
    if (this.stateTimeout) {
      clearTimeout(this.stateTimeout);
      this.stateTimeout = null;
    }

    // Start auto-reset timer (3 minutes)
    this.startAutoResetTimer();
  }

  public getState(): AvatarState {
    return this.currentState;
  }

  public onStateChange(callback: (state: AvatarState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Handle new AI response - triggers state transitions
   */
  public onNewResponse(text: string, emotion?: AvatarState): void {
    // Reset the auto-reset timer on new response
    this.startAutoResetTimer();

    // If emotion is provided (from LLM analysis), use it
    // Otherwise keep current state (don't change)
    if (!emotion) {
      console.log('💬 No emotion detected, keeping current state:', this.currentState);
      return;
    }

    console.log('🎭 Avatar state change:', {
      from: this.currentState,
      to: emotion,
      textLength: text.length,
    });

    // Clear any existing timeout
    if (this.stateTimeout) {
      clearTimeout(this.stateTimeout);
      this.stateTimeout = null;
    }

    this.setState(emotion);

    console.log('✨ Avatar will stay in this state until next response or page change');
  }

  /**
   * Set thinking state (called when user sends a message)
   */
  public setThinking(): void {
    this.setState(AvatarState.THINKING);
  }

  /**
   * Return to idle state
   */
  public setIdle(): void {
    this.setState(AvatarState.IDLE);
  }

  /**
   * Start auto-reset timer (3 minutes)
   * Automatically returns to idle state after 3 minutes of inactivity
   */
  private startAutoResetTimer(): void {
    // Clear existing timer
    if (this.autoResetTimeout) {
      clearTimeout(this.autoResetTimeout);
      this.autoResetTimeout = null;
    }

    // Set new timer
    this.autoResetTimeout = setTimeout(() => {
      console.log('⏰ Auto-reset: 3 minutes of inactivity, returning to idle state');
      this.resetToIdle();
    }, this.AUTO_RESET_DELAY);
  }

  /**
   * Reset to idle state and clear all timers
   */
  private resetToIdle(): void {
    // Clear all timers
    if (this.stateTimeout) {
      clearTimeout(this.stateTimeout);
      this.stateTimeout = null;
    }
    if (this.autoResetTimeout) {
      clearTimeout(this.autoResetTimeout);
      this.autoResetTimeout = null;
    }

    // Return to idle
    this.setState(AvatarState.IDLE);
    console.log('🔄 State reset to idle');
  }

  private updateOverlayImage(): void {
    // Use custom avatar if available, otherwise use default
    const state = this.presentationState ?? this.currentState;
    const customUrl = this.customAvatars[state];

    if (customUrl) {
      this.overlay.setImage(customUrl);
    } else {
      const imagePath = AVATAR_IMAGES[state];
      const imageUrl = getAssetUrl(imagePath);
      this.overlay.setImage(imageUrl);
    }
  }

  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach((callback) => {
      try {
        callback(this.currentState);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  public destroy(): void {
    if (this.stateTimeout) {
      clearTimeout(this.stateTimeout);
    }
    if (this.autoResetTimeout) {
      clearTimeout(this.autoResetTimeout);
    }
    this.stateChangeCallbacks = [];
  }
}
