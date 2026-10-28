import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateHistoryDialog } from '@/content/DateHistoryDialog';

const record = (id: string, day: number): Record<string, unknown> => ({ id, title: `對話 ${id}`, create_time: String(new Date(2026, 9, 1, 12).getTime() / 1000), update_time: String(new Date(2026, 9, day, 12).getTime() / 1000) });
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('cached history dialog', () => {
  let dialog: DateHistoryDialog;
  let root: ShadowRoot;
  let fetcher = vi.fn(async (_input: string, _init?: RequestInit) => response({}));
  let account: string;
  let rows: Record<string, unknown>[];
  let recent: boolean;
  const element = <T extends HTMLElement = HTMLElement>(id: string): T => root.getElementById(id) as T;
  const listInputs = (): HTMLInputElement[] => Array.from(root.querySelectorAll('#list input'));
  beforeEach(() => {
    window.location.href = 'https://chatgpt.com/c/current'; document.body.replaceChildren();
    account = 'account-a'; rows = [record('current', 25), record('old', 5), record('older', 2)]; recent = false;
    fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/api/auth/session')) return response({ accessToken: 'fixture-only', user: { id: account, email: `${account}@example.test` } });
      if (input.includes('/conversations?')) {
        const offset = Number(new URL(input).searchParams.get('offset'));
        return response({ items: recent ? rows.slice(0, 2) : rows.slice(offset, offset + 2), total: rows.length });
      }
      const id = input.split('/').pop();
      if (init?.method === 'PATCH') { rows = rows.filter(item => item.id !== id); return response({ success: true }); }
      return response(rows.find(item => item.id === id));
    });
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div'); document.body.append(host); dialog = new DateHistoryDialog(host); root = host.shadowRoot!;
    dialog.open(document.body);
    element<HTMLInputElement>('start').value = '2026-10-01'; element<HTMLInputElement>('end').value = '2026-10-31';
    element('end').dispatchEvent(new Event('change'));
  });
  afterEach(() => { dialog.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const load = async (): Promise<void> => {
    element('preview').click(); await vi.waitFor(() => expect(element<HTMLButtonElement>('preview').disabled).toBe(false));
    expect(listInputs()).toHaveLength(3);
  };
  it('reuses older cached pages after reopening and fetches only the newest page for new conversations', async () => {
    await load();
    dialog.close(); recent = true; rows.unshift(record('latest', 26)); dialog.open(document.body);
    await vi.waitFor(() => expect(element('status').textContent).toContain('最新對話已更新'));
    expect(listInputs().map(input => input.value)).toEqual(['latest', 'current', 'old', 'older']);
    const pages = fetcher.mock.calls.filter(([url]) => String(url).includes('/conversations?')).map(([url]) => new URL(url).searchParams.get('offset'));
    expect(pages).toEqual(['0', '2', '0']);
    expect(element('preview').textContent).toBe('更新清單');
  });
  it('shows the current conversation but excludes it from selection and bulk selection', async () => {
    await load();
    const current = listInputs().find(input => input.value === 'current')!;
    expect(current.disabled).toBe(true); expect(current.parentElement!.textContent).toContain('目前開啟');
    element('all').click();
    expect(listInputs().filter(input => input.checked).map(input => input.value)).toEqual(['old', 'older']);
    expect(current.checked).toBe(false);
  });
  it('rebuilds the cache rather than mixing records after the account changes', async () => {
    await load(); dialog.close(); account = 'account-b'; rows = [record('different-account', 27)]; dialog.open(document.body);
    await vi.waitFor(() => expect(element('status').textContent).toContain('最新對話已更新'));
    expect(listInputs().map(input => input.value)).toEqual(['different-account']);
    expect(root.getElementById('account')).toBeNull(); expect(root.textContent).not.toContain('account-b');
    expect(element('list').textContent).not.toContain('older');
  });
  it('removes deleted records from the cache and still verifies fresh metadata before a PATCH', async () => {
    await load();
    const selected = listInputs().find(input => input.value === 'old')!; selected.click(); element('delete').click();
    element('confirm-delete').click();
    await vi.waitFor(() => expect(element('status').textContent).toContain('已刪除 1 筆'));
    expect(listInputs().some(input => input.value === 'old')).toBe(false);
    expect(fetcher.mock.calls.some(([url, init]) => String(url).endsWith('/conversation/old') && !init?.method?.includes('PATCH'))).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    dialog.close(); dialog.open(document.body);
    await vi.waitFor(() => expect(element('status').textContent).toContain('最新對話已更新'));
    expect(listInputs().some(input => input.value === 'old')).toBe(false);
  });
  it('asks for confirmation directly, and cancellation never sends a delete request', async () => {
    await load();
    const confirm = vi.spyOn(window, 'confirm');
    listInputs().find(input => input.value === 'old')!.click();
    expect(root.getElementById('check')).toBeNull(); expect(root.getElementById('ack')).toBeNull();
    element('delete').click();
    expect(confirm).not.toHaveBeenCalled();
    expect(element('confirm-title').textContent).toBe('刪除 1 筆對話？');
    expect(element('confirm-titles').textContent).toBe('對話 old');
    expect(element('confirm-range').textContent).toContain('2026-10-01 至 2026-10-31');
    expect(element('history-view').hidden).toBe(true);
    expect(root.activeElement).toBe(element('confirm-cancel'));
    element('confirm-cancel').click();
    expect(element('confirm-view').hidden).toBe(true);
    expect(element('history-view').hidden).toBe(false);
    expect(root.activeElement).toBe(element('delete'));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(listInputs().find(input => input.value === 'old')!.checked).toBe(true);
  });
  it('shows a focused success result and refreshes the page only when requested', async () => {
    await load(); const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    listInputs().find(input => input.value === 'old')!.click(); element('delete').click(); element('confirm-delete').click();
    await vi.waitFor(() => expect(element('result-view').hidden).toBe(false));
    expect(element('result-description').textContent).toBe('已刪除 1 筆對話。');
    expect(element('history-view').hidden).toBe(true);
    expect(root.activeElement).toBe(element('result-title'));
    expect(root.querySelector('dialog')!.getAttribute('aria-labelledby')).toBe('result-title');
    expect(reload).not.toHaveBeenCalled();
    element('result-refresh').click(); expect(reload).toHaveBeenCalledOnce();
  });
  it('immediately shows deletion progress and stays there until the request completes', async () => {
    await load();
    const original = fetcher.getMockImplementation()!;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') await pending;
      return original(url, init);
    });
    listInputs().find(input => input.value === 'old')!.click(); element('delete').click(); element('confirm-delete').click();
    expect(element('deleting-view').hidden).toBe(false);
    expect(element('history-view').hidden).toBe(true); expect(element('confirm-view').hidden).toBe(true);
    expect(element('result-view').hidden).toBe(true);
    expect(element('deleting-status').textContent).toBe('已完成 0／1 筆，正在刪除…');
    expect(element<HTMLProgressElement>('deleting-progress').value).toBe(0);
    expect(root.activeElement).toBe(element('deleting-title'));
    expect(root.querySelector('dialog')!.getAttribute('aria-labelledby')).toBe('deleting-title');
    element('confirm-delete').click();
    root.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await vi.waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1));
    expect(element('deleting-view').hidden).toBe(false); expect(element('history-view').hidden).toBe(true);
    element('deleting-stop').focus();
    element('deleting-stop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(root.activeElement).toBe(element('deleting-stop'));
    finish();
    await vi.waitFor(() => expect(element('result-view').hidden).toBe(false));
    expect(element('deleting-view').hidden).toBe(true); expect(element('history-view').hidden).toBe(true);
  });
  it('updates completed counts while the next deletion waits and returns errors to the query', async () => {
    await load(); const original = fetcher.getMockImplementation()!;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/conversation/older') && init?.method === 'PATCH') { await pending; return response({}, 500); }
      return original(url, init);
    });
    element('all').click(); element('delete').click(); element('confirm-delete').click();
    await vi.waitFor(() => expect(element('deleting-status').textContent).toBe('已完成 1／2 筆，正在刪除…'));
    expect(element<HTMLProgressElement>('deleting-progress').value).toBe(1);
    expect(element<HTMLProgressElement>('deleting-progress').max).toBe(2);
    expect(element('history-view').hidden).toBe(true); expect(element('result-view').hidden).toBe(true);
    finish();
    await vi.waitFor(() => expect(element('status').textContent).toContain('500'));
    expect(element('deleting-view').hidden).toBe(true); expect(element('history-view').hidden).toBe(false);
    expect(element('result-view').hidden).toBe(true); expect(root.activeElement).toBe(element('start'));
  });
  it('keeps stopping visible until the in-flight deletion settles and preserves the remaining queue', async () => {
    await load(); const original = fetcher.getMockImplementation()!;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') await pending;
      return original(url, init);
    });
    element('all').click(); element('delete').click(); element('confirm-delete').click();
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    element('deleting-stop').click();
    expect(element('deleting-title').textContent).toBe('正在停止…');
    expect(element<HTMLButtonElement>('deleting-stop').disabled).toBe(true);
    expect(element('deleting-view').hidden).toBe(false); expect(element('history-view').hidden).toBe(true);
    finish();
    await vi.waitFor(() => expect(element('status').textContent).toContain('尚未處理的對話會保留'));
    expect(element('status').textContent).toContain('已刪除 1 筆');
    expect(element('deleting-view').hidden).toBe(true); expect(element('result-view').hidden).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(listInputs().map(input => input.value)).toEqual(['current', 'older']);
  });
  it('can continue from success with deleted records removed and clears the result on reopening', async () => {
    await load(); listInputs().find(input => input.value === 'old')!.click(); element('delete').click(); element('confirm-delete').click();
    await vi.waitFor(() => expect(element('result-view').hidden).toBe(false));
    element('result-continue').click();
    expect(element('result-view').hidden).toBe(true); expect(element('history-view').hidden).toBe(false);
    expect(root.activeElement).toBe(element('start'));
    expect(listInputs().map(input => input.value)).toEqual(['current', 'older']);
    expect(element('refresh-history').hidden).toBe(false);
    dialog.close(); dialog.open(document.body);
    expect(element('result-view').hidden).toBe(true);
  });
  it('keeps partial failures visible without reporting success and offers a sidebar refresh', async () => {
    await load(); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => url.endsWith('/conversation/older') && init?.method === 'PATCH'
      ? Promise.resolve(response({}, 500)) : original(url, init));
    element('all').click(); element('delete').click(); element('confirm-delete').click();
    await vi.waitFor(() => expect(element('status').textContent).toContain('500'));
    expect(element('status').textContent).toContain('已刪除 1 筆');
    expect(element('status').classList.contains('error')).toBe(true);
    expect(element('result-view').hidden).toBe(true); expect(element('history-view').hidden).toBe(false);
    expect(listInputs().map(input => input.value)).toEqual(['current', 'older']);
    expect(element('refresh-history').hidden).toBe(false);
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    element('refresh-history').click(); expect(reload).toHaveBeenCalledOnce();
  });
  it('does not show success when no deletion was confirmed', async () => {
    await load(); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(response({}, 500)) : original(url, init));
    listInputs().find(input => input.value === 'old')!.click(); element('delete').click(); element('confirm-delete').click();
    await vi.waitFor(() => expect(element('status').textContent).toContain('500'));
    expect(element('result-view').hidden).toBe(true); expect(element('refresh-history').hidden).toBe(true);
  });
  it('keeps keyboard focus inside confirmation and Escape returns to the selected list', async () => {
    await load(); element('all').click(); element('delete').click();
    expect(element('confirm-titles').children).toHaveLength(2);
    const modal = root.querySelector('dialog')!;
    element('confirm-delete').focus();
    element('confirm-delete').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(root.activeElement).toBe(element('confirm-cancel'));
    element('confirm-cancel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(root.activeElement).toBe(element('confirm-delete'));
    modal.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(modal.open).toBe(true); expect(element('confirm-view').hidden).toBe(true);
    expect(listInputs().filter(input => input.checked)).toHaveLength(2);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it('rejects confirmation after navigation and discards it on closing', async () => {
    await load(); listInputs().find(input => input.value === 'old')!.click(); element('delete').click();
    window.location.href = 'https://chatgpt.com/c/another'; element('confirm-delete').click();
    expect(element('status').textContent).toContain('目前對話已切換');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    element('delete').click(); dialog.close(); element('confirm-delete').click();
    expect(element('confirm-view').hidden).toBe(true);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it('automatically loads on open, permits date edits during loading, and hides secondary options', async () => {
    expect(fetcher).toHaveBeenCalled();
    expect(element<HTMLInputElement>('start').disabled).toBe(false);
    expect(root.querySelector('details')!.hasAttribute('open')).toBe(false);
    await load();
    expect(root.textContent).not.toContain('@example.test');
    expect(root.textContent).not.toContain('確認帳號');
    expect(element('delete').textContent).toBe('刪除對話');
    listInputs().find(input => input.value === 'old')!.click();
    expect(element('delete').textContent).toBe('刪除 1 筆');
  });
  it('uses one update button for the newest page and offers full reload separately', async () => {
    await load(); recent = true; rows.unshift(record('latest', 26));
    element('preview').click();
    await vi.waitFor(() => expect(element('status').textContent).toContain('最新對話已更新'));
    expect(listInputs().map(input => input.value)).toEqual(['latest', 'current', 'old', 'older']);
    recent = false; element('full').click();
    await vi.waitFor(() => expect(element<HTMLButtonElement>('preview').disabled).toBe(false));
    const pages = fetcher.mock.calls.filter(([url]) => String(url).includes('/conversations?')).map(([url]) => new URL(url).searchParams.get('offset'));
    expect(pages).toEqual(['0', '2', '0', '0', '2']);
  });
});
