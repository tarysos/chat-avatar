import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { OnboardingTour } from '@/content/OnboardingTour';
import { OnboardingState } from '@/background/OnboardingState';
import { STORAGE_KEY_ONBOARDING } from '@/common/constants';
import { AvatarState, TargetSite } from '@/common/types';

const root = (): ShadowRoot => document.getElementById('ai-avatar-onboarding')!.shadowRoot!;
const button = (id: string): HTMLButtonElement => root().getElementById(id) as HTMLButtonElement;
describe('expression-led first-use guide', () => {
  let tour: OnboardingTour;
  let saved: Record<string, unknown>;
  let set: Mock<[Record<string, unknown>], Promise<void>>;
  let send: Mock<[unknown, (result: { show: boolean }) => void], void>;
  let openOptions: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.body.innerHTML = '<button id="origin">教學</button><main style="padding:20px">聊天內容</main><div id="ai-avatar-overlay"><img id="ai-avatar-img" src="original.svg" alt="角色"></div>';
    saved = {}; set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(saved, values); });
    const storage = { get: vi.fn(async () => ({ ...saved })), set };
    const state = new OnboardingState(storage);
    send = vi.fn((_message: unknown, callback: (result: { show: boolean }) => void) => { void state.claim().then(show => callback({ show })); });
    vi.stubGlobal('chrome', { storage: { local: storage }, runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: send,
    } });
    openOptions = vi.fn(); tour = new OnboardingTour(TargetSite.CHATGPT, openOptions);
  });
  afterEach(() => { tour.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
  it('automatically appears once, changes expressions, respects skip and supports replay', async () => {
    document.getElementById('origin')!.focus(); tour.maybeStart();
    await vi.waitFor(() => expect(document.getElementById('ai-avatar-onboarding')).not.toBeNull());
    expect(root().querySelector('[role="dialog"], img')).toBeNull();
    expect(root().querySelector('[role="region"]')).not.toBeNull();
    expect(root().getElementById('progress')!.textContent).toBe('使用教學 1 / 6');
    expect((document.getElementById('ai-avatar-img') as HTMLImageElement).src).toContain('happy.svg');
    button('next').click();
    expect((document.getElementById('ai-avatar-img') as HTMLImageElement).src).toContain('thinking.svg');
    expect(root().getElementById('hint')!.textContent).toContain('第一個問題');
    expect(button('action').disabled).toBe(true);
    button('skip').click(); expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
    expect((document.getElementById('ai-avatar-img') as HTMLImageElement).src).toContain('original.svg');
    expect(document.activeElement?.id).toBe('origin');
    tour.maybeStart(); await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
    window.dispatchEvent(new Event('ai-avatar-start-tour'));
    expect(root().getElementById('progress')!.textContent).toBe('使用教學 1 / 6');
  });
  it('opens the real download menu only on request without changing native styles or deleting anything', () => {
    const host = document.createElement('div'); host.id = 'ai-avatar-composer-export';
    const actual = document.createElement('button'); actual.textContent = '下載'; actual.click = vi.fn(); host.append(actual);
    host.scrollIntoView = vi.fn(); document.body.append(host);
    const nativeStyle = document.querySelector<HTMLElement>('main')!.style.cssText;
    tour.start(); button('next').click(); button('next').click();
    expect(button('action').disabled).toBe(false); expect(actual.click).not.toHaveBeenCalled();
    button('action').click(); expect(actual.click).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLElement>('main')!.style.cssText).toBe(nativeStyle);
    expect(openOptions).not.toHaveBeenCalled();
  });
  it('skips disabled and unsupported features, completes once and can open settings', async () => {
    tour.destroy(); tour = new OnboardingTour(TargetSite.GEMINI, openOptions);
    tour.configure({ answerExport: false }); tour.start();
    expect(root().getElementById('progress')!.textContent).toBe('使用教學 1 / 3');
    button('next').click(); expect(root().getElementById('title')!.textContent).toContain('整段對話');
    expect(root().getElementById('description')!.textContent).toContain('已載入');
    button('back').click(); expect(root().getElementById('progress')!.textContent).toContain('1 / 3');
    button('next').click(); button('next').click(); button('action').click();
    expect(openOptions).toHaveBeenCalledOnce(); expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
    await Promise.resolve(); expect(saved[STORAGE_KEY_ONBOARDING]).toEqual({ seen: true, completed: true });
  });
  it('uses imported expression images and closes on Escape even if persistence fails', async () => {
    const image = 'data:image/png;base64,dGVzdA==';
    tour.configure(undefined, { [AvatarState.HAPPY]: image }); tour.start();
    expect((document.getElementById('ai-avatar-img') as HTMLImageElement).src).toBe(image);
    set.mockRejectedValueOnce(new Error('storage'));
    button('next').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve(); expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
  });
  it('anchors the bubble beside a moved avatar and above it on a narrow screen', async () => {
    const avatar = document.getElementById('ai-avatar-overlay')!;
    const bounds = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON(): object { return {}; } });
    const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(bounds(700, 500, 128, 128));
    tour.start();
    const bubble = document.getElementById('ai-avatar-onboarding')!;
    vi.spyOn(root().querySelector<HTMLElement>('.bubble')!, 'getBoundingClientRect').mockReturnValue(bounds(0, 0, 320, 240));
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(bubble.style.left).toBe('366px'));
    expect(bubble.dataset.side).toBe('left');
    rect.mockReturnValue(bounds(400, 100, 128, 128)); avatar.style.left = '400px';
    await vi.waitFor(() => expect(bubble.style.left).toBe('66px'));
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
    rect.mockReturnValue(bounds(242, 696, 128, 128)); window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(bubble.dataset.side).toBe('above'));
    expect(bubble.style.top).toBe('442px');
    expect(parseFloat(bubble.style.left) + 320).toBeLessThanOrEqual(378);
    expect(avatar.style.left).toBe('400px');
  });
  it('releases presentation on skip and teardown, and does not create a duplicate avatar', () => {
    tour.destroy(); const present = vi.fn();
    tour = new OnboardingTour(TargetSite.CHATGPT, openOptions, present);
    tour.start(); expect(present).toHaveBeenLastCalledWith(AvatarState.HAPPY);
    button('next').click(); expect(present).toHaveBeenLastCalledWith(AvatarState.THINKING);
    expect(document.querySelectorAll('img')).toHaveLength(1);
    button('skip').click(); expect(present).toHaveBeenLastCalledWith(null);
    tour.start(); tour.destroy(); expect(present).toHaveBeenLastCalledWith(null);
  });
  it('does not reopen after a delayed first-use response arrives following teardown', () => {
    let reply: ((result: { show: boolean }) => void) | undefined;
    send.mockImplementation((_message, callback) => { reply = callback; });
    tour.maybeStart(); tour.destroy(); reply!({ show: true });
    expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
  });
  it('does not show a detached bubble when the avatar is hidden', () => {
    document.getElementById('ai-avatar-overlay')!.style.visibility = 'hidden';
    tour.start(); expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
  });
});
