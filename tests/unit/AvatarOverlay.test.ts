import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarOverlay } from '@/avatar/AvatarOverlay';

describe('avatar direct manipulation', () => {
  let overlay: AvatarOverlay;
  let save: ReturnType<typeof vi.fn>;
  let container: HTMLElement;
  let root: ShadowRoot;
  beforeEach(() => {
    save = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { set: save } }, runtime: { sendMessage: vi.fn() } });
    document.body.replaceChildren(); overlay = new AvatarOverlay(); overlay.enableDragging();
    container = document.getElementById('ai-avatar-overlay')!;
    root = container.lastElementChild!.shadowRoot!;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 128, height: 128, right: 228, bottom: 228, x: 100, y: 100, toJSON() {} });
  });
  afterEach(() => { overlay.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('keeps conversation actions visible independently of avatar interactions', () => {
    const visibility = vi.fn(); window.addEventListener('ai-avatar-actions-visibility', visibility);
    expect(root.querySelector('.toggle, #tools-panel, #avatar-menu, input[type=range]')).toBeNull();
    expect(container.getAttribute('role')).toBe('group');
    expect(container.hasAttribute('aria-pressed')).toBe(false);
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(visibility).not.toHaveBeenCalled();
    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(visibility).not.toHaveBeenCalled();
    expect(container.hasAttribute('aria-pressed')).toBe(false);
    window.removeEventListener('ai-avatar-actions-visibility', visibility);
  });
  it('shows resize handles on hover and saves size after dragging a corner', () => {
    container.dispatchEvent(new MouseEvent('mouseenter'));
    expect(container.lastElementChild!.hasAttribute('data-hover')).toBe(true);
    root.querySelector('.se')!.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 228, clientY: 228, button: 0, bubbles: true, composed: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 300 }));
    expect(container.style.width).toBe('200px'); expect(container.style.left).toBe('100px');
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    expect(save).toHaveBeenCalledWith({ avatarDisplay: { size: 200 }, 'avatarPosition:chatgpt': { x: 100, y: 100 } });
  });
  it('preserves native clicks and starts pointer capture only when a drag crosses the movement threshold', () => {
    const capture = vi.fn(); container.setPointerCapture = capture;
    const down = new PointerEvent('pointerdown', { pointerId: 7, clientX: 150, clientY: 150, button: 0, bubbles: true, cancelable: true });
    container.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false); expect(capture).not.toHaveBeenCalled();
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 151, clientY: 151 }));
    expect(capture).not.toHaveBeenCalled();
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.hasAttribute('aria-pressed')).toBe(false);
    container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, clientX: 150, clientY: 150, button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: 170, clientY: 170 }));
    expect(capture).toHaveBeenCalledWith(8); expect(container.style.left).toBe('120px');
  });
  it('anchors the opposite corner while resizing and cancels without saving', () => {
    overlay.setPosition(100, 100);
    root.querySelector('.nw')!.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 60, clientY: 60 }));
    expect(container.style.width).toBe('168px'); expect(container.style.left).toBe('60px'); expect(container.style.top).toBe('60px');
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2 }));
    expect(container.style.width).toBe('128px'); expect(container.style.left).toBe('100px'); expect(save).not.toHaveBeenCalled();
  });
  it('saves a completed drag per site and restores it after recreating the overlay', async () => {
    container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 150, clientY: 150, button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 230, clientY: 210 }));
    expect(save).not.toHaveBeenCalled();
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 }));
    expect(save).toHaveBeenCalledWith({ 'avatarPosition:chatgpt': { x: 180, y: 160 } });
    const stored = save.mock.calls[0][0]['avatarPosition:chatgpt'];
    overlay.destroy(); overlay = new AvatarOverlay(); overlay.restorePosition(stored);
    container = document.getElementById('ai-avatar-overlay')!;
    expect(container.style.left).toBe('180px'); expect(container.style.top).toBe('160px');
    window.dispatchEvent(new Event('ai-avatar-composer-layout'));
    expect(container.style.left).toBe('180px'); expect(container.style.top).toBe('160px');
  });
  it('rejects invalid stored coordinates, bounds restored positions, and does not save cancelled gestures', () => {
    overlay.restorePosition({ x: 100000, y: 100000 });
    expect(parseFloat(container.style.left)).toBe(Math.max(0, window.innerWidth - 128));
    expect(parseFloat(container.style.top)).toBe(Math.max(0, window.innerHeight - 128));
    overlay.restorePosition({ x: NaN, y: 10 });
    expect(container.style.left).toBe(''); expect(container.style.right).toBe('20px');
    container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, clientX: 150, clientY: 150, button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 10, clientX: 230, clientY: 210 }));
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 10 }));
    expect(container.style.left).toBe(''); expect(container.style.right).toBe('20px'); expect(save).not.toHaveBeenCalled();
  });
  it('supports keyboard resize and keeps movement within the viewport', () => {
    root.querySelector('.se')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(container.style.width).toBe('136px'); expect(save).toHaveBeenCalledWith({ avatarDisplay: { size: 136 } });
    overlay.setPosition(-100, -100); expect(container.style.left).toBe('0px'); expect(container.style.top).toBe('0px');
  });
  it('replays the tutorial by double-clicking the avatar or pressing Enter, without saving or extra buttons', () => {
    const replay = vi.fn(); window.addEventListener('ai-avatar-start-tour', replay);
    try {
      expect(root.querySelector('.help')).toBeNull(); expect(root.querySelectorAll('button')).toHaveLength(4);
      container.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(replay).not.toHaveBeenCalled();
      container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); expect(replay).toHaveBeenCalledTimes(1);
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(replay).toHaveBeenCalledTimes(2);
      root.querySelector('.se')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
      root.querySelector('.se')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
      expect(replay).toHaveBeenCalledTimes(2); expect(save).not.toHaveBeenCalled();
    } finally { window.removeEventListener('ai-avatar-start-tour', replay); }
  });
  it('ignores double-clicks produced at the end of a drag, then allows a new clean double-click', () => {
    const replay = vi.fn(); window.addEventListener('ai-avatar-start-tour', replay);
    try {
      container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, clientX: 150, clientY: 150, button: 0, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, clientX: 200, clientY: 200 }));
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11 }));
      container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); expect(replay).not.toHaveBeenCalled();
      for (const pointerId of [12, 13]) {
        container.dispatchEvent(new PointerEvent('pointerdown', { pointerId, clientX: 200, clientY: 200, button: 0, bubbles: true }));
        document.dispatchEvent(new PointerEvent('pointerup', { pointerId }));
      }
      container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); expect(replay).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('ai-avatar-start-tour', replay); }
  });
  it('keeps its default position above an overlapping composer while preserving a dragged position', () => {
    document.body.insertAdjacentHTML('beforeend', '<form><div id="prompt-textarea"></div></form>');
    vi.spyOn(document.querySelector('form')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: window.innerHeight - 90, bottom: window.innerHeight - 10, right: window.innerWidth, width: window.innerWidth, height: 80, x: 0, y: window.innerHeight - 90, toJSON() {} });
    window.dispatchEvent(new Event('ai-avatar-composer-layout'));
    expect(container.style.bottom).toBe('106px');
    overlay.setPosition(100, 100); window.dispatchEvent(new Event('ai-avatar-composer-layout'));
    expect(container.style.top).toBe('100px'); expect(container.style.left).toBe('100px');
  });
});
