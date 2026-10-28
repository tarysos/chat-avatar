import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '@/common/download';
import { DEFAULT_PAGE_FEATURES, STORAGE_KEY_CONFIG } from '@/common/constants';

vi.mock('@/common/download', () => ({ downloadBlob: vi.fn() }));

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=';
const html = readFileSync(resolve('src/options/options.html'), 'utf8');
const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const choosePack = (text = JSON.stringify({ format: 'ai-avatar-pack', version: 1, name: '自訂表情包', images: { happy: png, sad: png } })): void => {
  const input = element<HTMLInputElement>('packFiles');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'custom.avatar-pack.json', { type: 'application/json' })] });
  input.dispatchEvent(new Event('change'));
};

describe('options pack workflow', () => {
  let save: ReturnType<typeof vi.fn>;
  let getConfig: ReturnType<typeof vi.fn>;
  let getLocal: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(downloadBlob).mockClear();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, '');
    save = vi.fn().mockResolvedValue(undefined);
    getConfig = vi.fn().mockResolvedValue({});
    getLocal = vi.fn().mockResolvedValue({});
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: { sync: { get: getConfig, set: vi.fn().mockResolvedValue(undefined) }, local: { get: getLocal, set: save, remove: vi.fn().mockResolvedValue(undefined) } },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer }));
    await import('@/options/options');
    await vi.waitFor(() => expect(document.querySelector('#preview-happy img')).not.toBeNull());
  });
  afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('preserves uploaded avatars when resetting settings, and keeps the original per-image upload and reset flow', async () => {
    const legacy = 'data:image/bmp;base64,Qk0AAAAA';
    getLocal.mockResolvedValue({ customAvatars: { happy: png, sad: legacy } });
    element('resetBtn').click();
    await vi.waitFor(() => expect(element('statusMessage').textContent).toBe('Settings reset to defaults'));
    expect(element('preview-happy').querySelector('img')!.src).toBe(png);
    expect(element('preview-sad').querySelector('img')!.src).toBe(legacy);
    expect(chrome.storage.local.remove).not.toHaveBeenCalledWith(expect.arrayContaining(['customAvatars']));
    const input = element<HTMLInputElement>('file-happy');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['BMfixture'], 'legacy.bmp', { type: 'image/bmp' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(element('statusMessage').textContent).toContain('happy 圖片已更新'));
    expect(element('preview-happy').querySelector('img')!.src).toContain('data:image/bmp;base64,');
    expect(element('preview-sad').querySelector('img')!.src).toBe(legacy);
    document.querySelector<HTMLButtonElement>('.btn-reset-avatar[data-state="happy"]')!.click();
    element<HTMLSelectElement>('llmProvider').value = 'openai';
    element<HTMLInputElement>('apiKey').value = 'fixture-api-key';
    element<HTMLInputElement>('modelName').value = 'fixture-model';
    element('saveBtn').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ customAvatars: { sad: legacy } })));
    await vi.waitFor(() => expect(chrome.storage.sync.set).toHaveBeenLastCalledWith({ [STORAGE_KEY_CONFIG]: expect.objectContaining({ llmProvider: 'openai', apiKey: 'fixture-api-key', modelName: 'fixture-model' }) }));
  });
  it('keeps original default avatars until import, previews a whole pack and saves it only on request', async () => {
    expect(new DOMParser().parseFromString(html.replace(/<script[\s\S]*?<\/script>/g, ''), 'text/html').documentElement.lang).toBe('en');
    expect(element('saveBtn').textContent).toBe('Save Settings');
    expect(element('resetBtn').textContent).toBe('Reset to Defaults');
    expect(element<HTMLImageElement>('preview-happy').querySelector('img')!.src).toContain('/assets/avatar/happy.svg');
    expect(element('preview-happy').querySelector('img')!.style.opacity).toBe('0.5');
    expect(element('exportPackBtn').textContent).toBe('匯出目前表情包');
    choosePack();
    await vi.waitFor(() => expect(element('importSummary').textContent).toContain('2／12'));
    expect(element('preview-happy').querySelector('img')!.src).toBe(png);
    expect(element('preview-happy').querySelector('img')!.style.opacity).toBe('');
    expect(save).not.toHaveBeenCalled();
    element<HTMLInputElement>('avatarSize').value = '200';
    element('saveBtn').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ customAvatars: { happy: png, sad: png }, avatarDisplay: { size: 200 } }));
    await vi.waitFor(() => expect(element('statusMessage').textContent).toContain('已儲存'));
    element('clearAvatarsBtn').click();
    expect(element('preview-happy').querySelector('img')!.src).toContain('/happy.svg');
  });
  it('keeps the original three-second status-message dismissal', async () => {
    vi.useFakeTimers();
    try {
      document.querySelector<HTMLButtonElement>('.btn-reset-avatar[data-state="happy"]')!.click();
      expect(element('statusMessage').classList.contains('show')).toBe(true);
      await vi.advanceTimersByTimeAsync(2999);
      expect(element('statusMessage').classList.contains('show')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(element('statusMessage').classList.contains('show')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('preserves the existing preview when an import fails and reports storage errors', async () => {
    choosePack();
    await vi.waitFor(() => expect(element('importSummary').textContent).toContain('2／12'));
    choosePack('{"broken":true}');
    await vi.waitFor(() => expect(element('statusMessage').textContent).toContain('不支援'));
    expect(element('preview-happy').querySelector('img')!.src).toBe(png);
    save.mockRejectedValueOnce(new Error('QUOTA_BYTES'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    element('saveBtn').click();
    await vi.waitFor(() => expect(element('statusMessage').textContent).toContain('無法儲存'));
  });
  it('downloads the preview as images in one ZIP and restores the button after a failed export', async () => {
    choosePack();
    await vi.waitFor(() => expect(element('importSummary').textContent).toContain('2／12'));
    vi.mocked(fetch).mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer } as Response);
    element('exportPackBtn').click();
    expect(element<HTMLButtonElement>('exportPackBtn').disabled).toBe(true);
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('avatar-images.zip');
    expect(vi.mocked(downloadBlob).mock.calls[0][0].type).toBe('application/zip');
    expect(element('statusMessage').textContent).toContain('12 張表情圖片');
    expect(save).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    element('exportPackBtn').click();
    await vi.waitFor(() => expect(element('statusMessage').textContent).toContain('預設圖片'));
    expect(element<HTMLButtonElement>('exportPackBtn').disabled).toBe(false);
    expect(downloadBlob).toHaveBeenCalledOnce();
  });
  it('defaults legacy settings to enabled features and saves each switch independently', async () => {
    for (const key of Object.keys(DEFAULT_PAGE_FEATURES)) expect(element<HTMLInputElement>(key).checked).toBe(true);
    element<HTMLInputElement>('questionOutline').checked = false;
    element<HTMLInputElement>('answerExport').checked = false;
    element('saveFeaturesBtn').click();
    await vi.waitFor(() => expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      [STORAGE_KEY_CONFIG]: expect.objectContaining({ pageFeatures: { questionOutline: false, conversationExport: true, answerExport: false, historyDelete: true } }),
    }));
    expect(element('statusMessage').textContent).toContain('已開啟的聊天頁面會自動套用');
    await vi.waitFor(() => expect(element('featuresStatus').textContent).toContain('已儲存'));
  });
  it('loads saved feature preferences and restores all feature defaults on reset', async () => {
    vi.resetModules();
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, '');
    getConfig.mockResolvedValue({ [STORAGE_KEY_CONFIG]: { pageFeatures: { questionOutline: false, historyDelete: false } } });
    await import('@/options/options');
    await vi.waitFor(() => expect(element<HTMLInputElement>('questionOutline').checked).toBe(false));
    expect(element<HTMLInputElement>('historyDelete').checked).toBe(false);
    expect(element<HTMLInputElement>('conversationExport').checked).toBe(true);
    getConfig.mockResolvedValue({});
    element('resetBtn').click();
    await vi.waitFor(() => expect(element<HTMLInputElement>('questionOutline').checked).toBe(true));
    expect(element<HTMLInputElement>('historyDelete').checked).toBe(true);
  });
  it('offers replay from settings using the current preview expressions and selected features', async () => {
    choosePack(); await vi.waitFor(() => expect(element('importSummary').textContent).toContain('2／12'));
    element<HTMLInputElement>('questionOutline').checked = false;
    element('showTourBtn').click();
    const guide = element('ai-avatar-onboarding').shadowRoot!;
    expect(guide.getElementById('progress')!.textContent).toBe('使用教學 1 / 5');
    expect(element('preview-happy').querySelector('img')!.src).toBe(png);
    guide.getElementById('skip')!.click(); expect(document.getElementById('ai-avatar-onboarding')).toBeNull();
  });
});
