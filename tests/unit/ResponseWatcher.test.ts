import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseWatcher } from '@/content/ResponseWatcher';
import { SiteAdapterFactory } from '@/adapters/SiteAdapterFactory';
import { TargetSite } from '@/common/types';

describe('response monitoring without idle retries', () => {
  let watcher: ResponseWatcher;
  const response = (): HTMLElement => {
    const element = document.createElement('div'); element.dataset.messageAuthorRole = 'assistant';
    document.querySelector('main')!.append(element); return element;
  };
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = '<main><h1>今天想聊些什麼？</h1></main>';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    watcher = new ResponseWatcher(new SiteAdapterFactory().create(TargetSite.CHATGPT), TargetSite.CHATGPT);
  });
  afterEach(() => { watcher.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
  it('does not poll an empty new chat and observes the first reply after a long idle', async () => {
    const callback = vi.fn(); watcher.onResponse(callback); watcher.start();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join(' ')).not.toContain('retrying');
    response().textContent = '第一則測試回答';
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledOnce(); expect(callback.mock.calls[0][0].text).toBe('第一則測試回答');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for text mutations in an empty reply placeholder without polling', async () => {
    const callback = vi.fn(); watcher.onResponse(callback); watcher.start();
    const element = response();
    await vi.advanceTimersByTimeAsync(10000);
    expect(vi.getTimerCount()).toBe(0); expect(callback).not.toHaveBeenCalled();
    element.textContent = '稍後載入的完整回答';
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledOnce();
  });
  it('does not lose the first reply after unrelated UI changes, and stop cancels completion', async () => {
    const callback = vi.fn(); watcher.onResponse(callback); watcher.start();
    document.body.append(document.createElement('aside'));
    await vi.advanceTimersByTimeAsync(20);
    response().textContent = '快速出現的回答';
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledOnce();
    response().textContent = '這則尚未完成';
    await vi.advanceTimersByTimeAsync(20);
    watcher.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(callback).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('marks existing history once and never restarts a stopped empty watcher', async () => {
    response().textContent = '既有歷史回答';
    const callback = vi.fn(); watcher.onResponse(callback); watcher.start(); watcher.start();
    expect(callback).toHaveBeenCalledOnce();
    watcher.destroy(); document.querySelector('main')!.replaceChildren();
    watcher = new ResponseWatcher(new SiteAdapterFactory().create(TargetSite.CHATGPT), TargetSite.CHATGPT);
    watcher.onResponse(callback); watcher.start(); watcher.stop();
    await vi.advanceTimersByTimeAsync(25000);
    response().textContent = '停止後不能監測';
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('wakes when hydration assigns a response role to existing text', async () => {
    const callback = vi.fn(); watcher.onResponse(callback); watcher.start();
    const element = document.createElement('div'); element.textContent = '稍後才取得角色標記';
    document.querySelector('main')!.append(element);
    await vi.advanceTimersByTimeAsync(1000); expect(callback).not.toHaveBeenCalled();
    element.dataset.messageAuthorRole = 'assistant';
    await vi.advanceTimersByTimeAsync(1000); expect(callback).toHaveBeenCalledOnce();
  });
  it.each([TargetSite.CHATGPT, TargetSite.GEMINI])('handles comment and text mutations without passing non-elements to the %s adapter', async site => {
    watcher.destroy();
    watcher = new ResponseWatcher(new SiteAdapterFactory().create(site), site);
    const callback = vi.fn(); watcher.onResponse(callback); watcher.start();
    const marker = document.createComment('render marker');
    document.querySelector('main')!.append(marker);
    await vi.advanceTimersByTimeAsync(20);
    marker.data = 'updated render marker';
    await vi.advanceTimersByTimeAsync(20);
    expect(callback).not.toHaveBeenCalled();
    const element = response();
    if (site === TargetSite.GEMINI) element.classList.add('model-response-text');
    const text = document.createTextNode('尚未完成的回答');
    const responseMarker = document.createComment('stream marker');
    element.append(text, responseMarker);
    await vi.advanceTimersByTimeAsync(20);
    responseMarker.data = 'updated stream marker';
    text.data = '文字節點更新後的完整回答';
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].text).toBe('文字節點更新後的完整回答');
    expect(vi.getTimerCount()).toBe(0);
  });
});
