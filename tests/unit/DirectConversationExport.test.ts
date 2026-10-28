import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectConversationExport } from '@/content/DirectConversationExport';
import { TargetSite } from '@/common/types';
import { downloadText } from '@/common/download';

vi.mock('@/common/download', () => ({ downloadText: vi.fn() }));
const graph = { conversation_id: 'fallback', title: '備用讀取', current_node: 'a', mapping: {
  u: { parent: null, message: { author: { role: 'user' }, content: { parts: ['原問題'] } } },
  a: { parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['完整回答'] } } },
} };
const json = (data: unknown): Response => new Response(JSON.stringify(data));

describe('complete conversation export', () => {
  let exporter: DirectConversationExport;
  let button: HTMLButtonElement;
  let notice: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks(); window.location.href = 'https://chatgpt.com/c/fallback'; document.body.innerHTML = '<button>下載</button>';
    button = document.querySelector('button')!; notice = vi.fn();
    exporter = new DirectConversationExport(TargetSite.CHATGPT, () => 'markdown', notice);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/api/auth/session') ? { accessToken: 'fixture-only' } : graph)));
  });
  afterEach(() => { exporter.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('reads the current branch and downloads automatically without a format or selection window', async () => {
    document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant">頁面只載入最後一小段</article>');
    const pending = exporter.all(button);
    expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true');
    await exporter.all(button); // Repeated clicks cannot start duplicate requests.
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2); expect(downloadText).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('完整回答');
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('2 則訊息（目前聊天完整分支）');
    expect(vi.mocked(downloadText).mock.calls[0][0]).not.toContain('頁面只載入最後一小段');
    expect(button.disabled).toBe(false); expect(button.hasAttribute('aria-busy')).toBe(false);
  });
  it('does not download a response after the user switches chats', async () => {
    let resolveRead!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/api/auth/session') ? json({ accessToken: 'fixture-only' }) : new Promise(resolve => { resolveRead = resolve; }));
    const pending = exporter.all(button);
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
    window.location.href = 'https://chatgpt.com/c/another'; resolveRead(json(graph)); await pending;
    expect(downloadText).not.toHaveBeenCalled(); expect(button.disabled).toBe(false);
    expect(notice.mock.calls.at(-1)![0]).toContain('聊天已切換');
  });
  it('reports authentication errors and lets the user retry', async () => {
    document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant">不應下載的局部回答</article>');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));
    await exporter.all(button); expect(notice.mock.calls.at(-1)![0]).toContain('登入');
    expect(downloadText).not.toHaveBeenCalled(); expect(button.disabled).toBe(false);
    await exporter.all(button); expect(downloadText).toHaveBeenCalledOnce();
  });
  it('reserves one PDF print window before reading, then prints only the exported document', async () => {
    const print = vi.fn(); const write = vi.fn();
    const popup = { opener: window, document: { open: vi.fn(), write, close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print, close: vi.fn(), closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    exporter.destroy(); exporter = new DirectConversationExport(TargetSite.CHATGPT, () => 'pdf', notice);
    await exporter.all(button); await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledOnce(); expect(write.mock.calls[0][0]).toContain('完整回答'); expect(popup.opener).toBeNull();
    expect(write.mock.calls[0][0]).toContain('目前聊天完整分支');
  });
  it('downloads every message in a long chat even when the page contains only its last answer', async () => {
    document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant">第 599 則內容</article>');
    const mapping: Record<string, unknown> = {};
    for (let index = 0; index < 600; index++) mapping[`m${index}`] = { parent: index ? `m${index - 1}` : null, message: { author: { role: index % 2 ? 'assistant' : 'user' }, content: { parts: [`第 ${index} 則內容`] } } };
    vi.mocked(fetch).mockImplementation(async input => json(String(input).endsWith('/api/auth/session') ? { accessToken: 'fixture-only' } : { ...graph, current_node: 'm599', mapping }));
    await exporter.all(button);
    const output = vi.mocked(downloadText).mock.calls[0][0];
    expect(output.match(/^## /gm)).toHaveLength(600);
    expect(output).toContain('第 0 則內容'); expect(output).toContain('第 599 則內容');
    expect(output.indexOf('第 0 則內容')).toBeLessThan(output.indexOf('第 599 則內容'));
  });
  it('rejects a truncated branch instead of falling back to loaded messages', async () => {
    document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant">局部回答</article>');
    vi.mocked(fetch).mockImplementation(async input => json(String(input).endsWith('/api/auth/session') ? { accessToken: 'fixture-only' } : { ...graph, mapping: { a: graph.mapping.a } }));
    await exporter.all(button);
    expect(downloadText).not.toHaveBeenCalled(); expect(notice.mock.calls.at(-1)![0]).toContain('不完整');
    expect(notice.mock.calls.at(-1)![0]).toContain('未下載檔案');
  });
  it('does not treat an unsaved chat or a streaming response as a complete conversation', async () => {
    window.location.href = 'https://chatgpt.com/'; document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant">暫存回答</article>');
    await exporter.all(button); expect(notice.mock.calls.at(-1)![0]).toContain('尚未儲存');
    window.location.href = 'https://chatgpt.com/c/fallback'; document.querySelector('article')!.setAttribute('data-is-streaming', 'true');
    await exporter.all(button); expect(notice.mock.calls.at(-1)![0]).toContain('仍在產生');
    expect(fetch).not.toHaveBeenCalled(); expect(downloadText).not.toHaveBeenCalled();
  });
  it('aborts pending reads immediately when navigation is detected and restores the button', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('stopped'))));
    });
    const pending = exporter.all(button);
    window.location.href = 'https://chatgpt.com/c/another'; exporter.cancelIfNavigated();
    expect(signal!.aborted).toBe(true); expect(button.disabled).toBe(false);
    await pending; expect(downloadText).not.toHaveBeenCalled(); expect(notice.mock.calls.at(-1)![0]).toContain('已取消');
  });
  it('keeps the progress notice active and restores the download button after a timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('timeout')));
    }));
    const pending = exporter.all(button);
    expect(notice.mock.calls[0][1]).toBe(true);
    await vi.advanceTimersByTimeAsync(60000); await pending;
    expect(button.disabled).toBe(false); expect(downloadText).not.toHaveBeenCalled();
    expect(notice.mock.calls.at(-1)![0]).toContain('逾時，未下載檔案');
  });
  it('reports a blocked PDF print window without starting a read or downloading partial content', async () => {
    document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant">局部回答</article>');
    vi.spyOn(window, 'open').mockReturnValue(null);
    exporter.destroy(); exporter = new DirectConversationExport(TargetSite.CHATGPT, () => 'pdf', notice);
    await exporter.all(button);
    expect(fetch).not.toHaveBeenCalled(); expect(downloadText).not.toHaveBeenCalled(); expect(button.disabled).toBe(false);
    expect(notice.mock.calls.at(-1)![0]).toContain('列印視窗被封鎖');
  });
});
