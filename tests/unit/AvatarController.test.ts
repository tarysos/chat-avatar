/**
 * Unit tests for AvatarController
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AvatarController } from '@/avatar/AvatarController';
import type { IAvatarOverlay } from '@/common/interfaces';
import { AvatarState } from '@/common/types';

describe('AvatarController', () => {
  let mockOverlay: IAvatarOverlay;
  let controller: AvatarController;

  beforeEach(() => {
    mockOverlay = {
      show: vi.fn(),
      hide: vi.fn(),
      setImage: vi.fn(),
      setPosition: vi.fn(),
      enableDragging: vi.fn(),
      disableDragging: vi.fn(),
    };

    controller = new AvatarController(mockOverlay);
  });

  afterEach(() => {
    controller.destroy();
  });

  describe('setState', () => {
    it('preserves the original three-minute idle reset after an emotional response', () => {
      vi.useFakeTimers();
      try {
        controller.onNewResponse('positive response', AvatarState.HAPPY);
        vi.advanceTimersByTime(179999); expect(controller.getState()).toBe(AvatarState.HAPPY);
        vi.advanceTimersByTime(1); expect([AvatarState.IDLE, AvatarState.IDLE2, AvatarState.IDLE3]).toContain(controller.getState());
      } finally { vi.useRealTimers(); }
    });
    it('keeps the tutorial expression while remembering new response state and custom images', () => {
      controller.setState(AvatarState.SAD);
      controller.setPresentationState(AvatarState.HAPPY);
      controller.onNewResponse('New answer', AvatarState.THINKING);
      expect(controller.getState()).toBe(AvatarState.THINKING);
      expect(mockOverlay.setImage).toHaveBeenLastCalledWith(expect.stringContaining('happy.svg'));
      controller.setCustomAvatars({ [AvatarState.HAPPY]: 'data:image/png;base64,happy', [AvatarState.THINKING]: 'data:image/png;base64,thinking' });
      expect(mockOverlay.setImage).toHaveBeenLastCalledWith('data:image/png;base64,happy');
      controller.setPresentationState(null);
      expect(mockOverlay.setImage).toHaveBeenLastCalledWith('data:image/png;base64,thinking');
    });
    it('should set state and update overlay image', () => {
      controller.setState(AvatarState.THINKING);
      expect(controller.getState()).toBe(AvatarState.THINKING);
      expect(mockOverlay.setImage).toHaveBeenCalled();
    });

    it('should not update if state is the same', () => {
      controller.setState(AvatarState.HAPPY);
      const callCount = (mockOverlay.setImage as ReturnType<typeof vi.fn>).mock.calls.length;
      controller.setState(AvatarState.HAPPY);
      expect((mockOverlay.setImage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });

    it('should trigger state change callbacks', () => {
      const callback = vi.fn();
      controller.onStateChange(callback);
      controller.setState(AvatarState.HAPPY);
      expect(callback).toHaveBeenCalledWith(AvatarState.HAPPY);
    });
  });

  describe('onNewResponse', () => {
    it('should keep current state when no emotion provided', () => {
      vi.useFakeTimers();
      const initialState = controller.getState();
      controller.onNewResponse('Hello world');
      expect(controller.getState()).toBe(initialState);
      vi.useRealTimers();
    });

    it('should use provided emotion state', () => {
      vi.useFakeTimers();
      controller.onNewResponse('Great news!', AvatarState.HAPPY);
      expect(controller.getState()).toBe(AvatarState.HAPPY);
      vi.useRealTimers();
    });

    it('should stay in emotion state (no auto-return to idle)', () => {
      vi.useFakeTimers();
      controller.onNewResponse('Test', AvatarState.SAD);
      expect(controller.getState()).toBe(AvatarState.SAD);

      vi.advanceTimersByTime(5000);
      expect(controller.getState()).toBe(AvatarState.SAD);
      vi.useRealTimers();
    });
  });

  describe('setThinking', () => {
    it('should set thinking state', () => {
      controller.setThinking();
      expect(controller.getState()).toBe(AvatarState.THINKING);
    });
  });

  describe('setIdle', () => {
    it('should select an idle variant', () => {
      controller.setState(AvatarState.HAPPY);
      controller.setIdle();
      expect([AvatarState.IDLE, AvatarState.IDLE2, AvatarState.IDLE3]).toContain(controller.getState());
    });
  });
});
