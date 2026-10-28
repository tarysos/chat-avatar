import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DatedHistoryClient, dateBounds, filterDatedChats, type DatedChat, type HistoryRange } from '@/content/DatedHistory';

const day = (number: number): number => new Date(2026, 9, number, 12).getTime();
const range: HistoryRange = { start: '2026-10-01', end: '2026-10-10', basis: 'updatedAt' };
const record = (id = 'old', updated = day(5)): Record<string, unknown> => ({ id, title: `對話 ${id}`, create_time: new Date(day(1)).toISOString(), update_time: new Date(updated).toISOString() });
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function transport(options: { changed?: boolean; failure?: number; unconfirmed?: boolean; pages?: boolean } = {}): Mock<[url: string, init?: RequestInit], Promise<Response>> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/auth/session')) return response({ accessToken: 'fixture-only-token', user: { email: 'fixture@example.test' } });
    if (url.includes('/backend-api/conversations?')) {
      if (options.failure) return response({}, options.failure);
      const offset = new URL(url).searchParams.get('offset');
      return response({ items: options.pages && offset !== '0' ? [record('second')] : [record()], total: options.pages ? 2 : 1 });
    }
    if (init?.method === 'PATCH') return response(options.unconfirmed ? {} : { success: true });
    const id = url.split('/').pop();
    return response(record(id, options.changed ? day(12) : day(5)));
  });
}

describe('exact history date filtering', () => {
  beforeEach(() => { window.location.href = 'https://chatgpt.com/c/current'; });
  it('includes both local calendar endpoints and excludes missing dates and the current chat', () => {
    const bounds = dateBounds(range);
    const item = (id: string, date: number | null): DatedChat => ({ id, title: id, createdAt: date, updatedAt: date });
    const result = filterDatedChats([item('start', bounds.start), item('end', bounds.end - 1), item('outside', bounds.end), item('unknown', null), item('current', day(5))], range, 'current');
    expect(result.map(chat => chat.id)).toEqual(['end', 'start']);
  });
  it('rejects reversed or impossible dates and supports creation-date filtering', () => {
    expect(() => dateBounds({ ...range, end: '2026-09-01' })).toThrow('結束');
    expect(() => dateBounds({ ...range, start: '2026-02-30' })).toThrow('無效');
    const item: DatedChat = { id: 'a', title: 'a', createdAt: day(3), updatedAt: day(20) };
    expect(filterDatedChats([item], range, null)).toEqual([]);
    expect(filterDatedChats([item], { ...range, basis: 'createdAt' }, null)).toEqual([item]);
  });
  it('reads every metadata page and uses memory-only authentication', async () => {
    const fetcher = transport({ pages: true }); const client = new DatedHistoryClient(fetcher as typeof fetch);
    const result = await client.list(new AbortController().signal);
    expect(result.map(item => item.id)).toEqual(['old', 'second']);
    expect(client.identity).toBe('fixture@example.test');
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer fixture-only-token' });
    client.clear();
    await expect(client.remove([result[0]], range, new AbortController().signal, vi.fn())).rejects.toThrow('先重新讀取');
  });
  it('rechecks metadata before deleting only the reviewed IDs', async () => {
    const fetcher = transport(); const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    await client.remove(selected, range, new AbortController().signal, progress);
    const patches = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches).toHaveLength(1); expect(patches[0][0]).toBe('https://chatgpt.com/backend-api/conversation/old');
    expect(JSON.parse(patches[0][1]!.body as string)).toEqual({ is_visible: false });
    expect(progress).toHaveBeenCalledWith(1);
  });
  it('refuses dates moved outside the selected range, the current chat, and cancellation before mutation', async () => {
    const fetcher = transport({ changed: true }); const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await expect(client.remove(selected, range, new AbortController().signal, vi.fn())).rejects.toThrow('日期範圍');
    await expect(client.remove([{ ...selected[0], id: 'current' }], range, new AbortController().signal, vi.fn())).rejects.toThrow('目前');
    const abort = new AbortController(); abort.abort();
    await expect(client.remove(selected, range, abort.signal, vi.fn())).rejects.toThrow('停止');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it('stops a queue after the completed item when requested', async () => {
    const fetcher = transport({ pages: true }); const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const abort = new AbortController();
    await expect(client.remove(selected, range, abort.signal, () => abort.abort())).rejects.toThrow('停止');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('overlaps one metadata read with one sequential deletion without fixed waits', async () => {
    const fetcher = transport(); const original = fetcher.getMockImplementation()!;
    const records = Array.from({ length: 5 }, (_, index) => record(`item-${index}`));
    let measuring = false; let active = 0; let maxActive = 0; let patches = 0; let maxPatches = 0;
    fetcher.mockImplementation(async (url, init) => {
      if (url.includes('/conversations?')) return response({ items: records, total: records.length });
      if (measuring) {
        maxActive = Math.max(maxActive, ++active);
        if (init?.method === 'PATCH') maxPatches = Math.max(maxPatches, ++patches);
        await new Promise(resolve => setTimeout(resolve, 100));
        active--; if (init?.method === 'PATCH') patches--;
      }
      return original(url, init);
    });
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    const before = fetcher.mock.calls.length;
    vi.useFakeTimers();
    try {
      measuring = true; const start = Date.now(); const progress = vi.fn();
      const deletion = client.remove(selected, range, new AbortController().signal, progress);
      await vi.runAllTimersAsync(); await deletion;
      // With 100ms per request: auth + first read + five sequential PATCHes.
      // The old serial path took 11 * 100ms + four 350ms waits = 2500ms.
      expect(Date.now() - start).toBe(700);
      expect(maxActive).toBe(2); expect(maxPatches).toBe(1);
      expect(fetcher.mock.calls.slice(before)).toHaveLength(11);
      expect(progress.mock.calls.map(([count]) => count)).toEqual([1, 2, 3, 4, 5]);
    } finally { vi.useRealTimers(); }
  });
  it('cancels the prefetched read on Stop but observes the in-flight PATCH before reporting progress', async () => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    const patch = deferred<Response>(); let readSignal: AbortSignal | undefined; let patchSignal: AbortSignal | undefined;
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') { patchSignal = init.signal!; return patch.promise; }
      if (url.endsWith('/conversation/second')) {
        readSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => readSignal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
      }
      return original(url, init);
    });
    const client = new DatedHistoryClient(fetcher as typeof fetch); const abort = new AbortController();
    const selected = await client.list(abort.signal); const progress = vi.fn();
    const deletion = client.remove(selected, range, abort.signal, progress);
    const stopped = expect(deletion).rejects.toThrow('停止');
    await vi.waitFor(() => expect(readSignal).toBeDefined());
    abort.abort();
    expect(readSignal!.aborted).toBe(true); expect(patchSignal!.aborted).toBe(false);
    expect(progress).not.toHaveBeenCalled();
    patch.resolve(response({ success: true })); await stopped;
    expect(progress.mock.calls).toEqual([[1]]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('refreshes aged prefetches after a slow deletion and rejects dates that changed meanwhile', async () => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    let reads = 0;
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/conversation/old') && init?.method === 'PATCH') await new Promise(resolve => setTimeout(resolve, 3000));
      if (url.endsWith('/conversation/second') && init?.method !== 'PATCH') return response(record('second', ++reads === 1 ? day(5) : day(12)));
      return original(url, init);
    });
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    vi.useFakeTimers();
    try {
      const deletion = expect(client.remove(selected, range, new AbortController().signal, progress)).rejects.toThrow('日期範圍');
      await vi.runAllTimersAsync(); await deletion;
      expect(reads).toBe(2); expect(progress.mock.calls).toEqual([[1]]);
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('aborts unused prefetches when the current deletion is unconfirmed', async () => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    const patch = deferred<Response>(); let readSignal: AbortSignal | undefined;
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') return patch.promise;
      if (url.endsWith('/conversation/second')) {
        readSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => readSignal!.addEventListener('abort', () => reject(new Error('unused')), { once: true }));
      }
      return original(url, init);
    });
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    const deletion = expect(client.remove(selected, range, new AbortController().signal, progress)).rejects.toThrow('未確認');
    await vi.waitFor(() => expect(readSignal).toBeDefined());
    patch.resolve(response({})); await deletion;
    expect(readSignal!.aborted).toBe(true); expect(progress).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('handles an early prefetch rate limit after observing the current deletion without retrying', async () => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    const patch = deferred<Response>();
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') return patch.promise;
      if (url.endsWith('/conversation/second')) return response({}, 429);
      return original(url, init);
    });
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    const deletion = expect(client.remove(selected, range, new AbortController().signal, progress)).rejects.toThrow('限制');
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/conversation/second'))).toBe(true));
    expect(progress).not.toHaveBeenCalled();
    patch.resolve(response({ success: true })); await deletion;
    expect(progress.mock.calls).toEqual([[1]]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/conversation/second'))).toHaveLength(1);
  });
  it.each([
    { id: 'different' }, { is_archived: true }, { update_time: new Date(day(12)).toISOString() },
  ])('validates prefetched metadata before sending its deletion: %j', async detail => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => url.endsWith('/conversation/second') && init?.method !== 'PATCH'
      ? Promise.resolve(response({ ...record('second'), ...detail })) : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    await expect(client.remove(selected, range, new AbortController().signal, progress)).rejects.toThrow();
    expect(progress.mock.calls).toEqual([[1]]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url]) => url.split('/').pop())).toEqual(['old']);
  });
  it('stops before using prefetched data after navigating away', async () => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    const patch = deferred<Response>();
    fetcher.mockImplementation((url, init) => init?.method === 'PATCH' ? patch.promise : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    const deletion = expect(client.remove(selected, range, new AbortController().signal, progress)).rejects.toThrow('對話已切換');
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/conversation/second'))).toBe(true));
    window.location.href = 'https://chatgpt.com/c/another';
    patch.resolve(response({ success: true })); await deletion;
    expect(progress.mock.calls).toEqual([[1]]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('advances a read-ahead queue when a selected conversation is already deleted', async () => {
    const fetcher = transport({ pages: true }); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => url.endsWith('/conversation/old') && init?.method !== 'PATCH'
      ? Promise.resolve(response({ ...record(), is_visible: false })) : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    await client.remove(selected, range, new AbortController().signal, progress);
    expect(progress.mock.calls).toEqual([[1], [2]]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url]) => url.split('/').pop())).toEqual(['second']);
  });
  it('does not retry or claim success for uncertain deletion results or rate limits', async () => {
    const fetcher = transport({ unconfirmed: true }); const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await expect(client.remove(selected, range, new AbortController().signal, vi.fn())).rejects.toThrow('未確認');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    const limited = new DatedHistoryClient(transport({ failure: 429 }) as typeof fetch);
    await expect(limited.list(new AbortController().signal)).rejects.toThrow('限制');
  });
  it('normalizes fractional Unix seconds and ISO microseconds to the same millisecond precision', async () => {
    const fetcher = transport();
    const iso = new Date(day(5) + 123).toISOString().replace('.123Z', '.123456Z');
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/api/auth/session')) return response({ accessToken: 'fixture' });
      if (url.includes('/conversations?')) return response({ items: [{ ...record(), update_time: iso }], total: 1 });
      if (init?.method === 'PATCH') return response({ success: true });
      return response({ ...record(), update_time: (day(5) + 123.456) / 1000 });
    });
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await expect(client.remove(selected, range, new AbortController().signal, vi.fn())).resolves.toBeUndefined();
  });
  it('does not expose an incomplete or duplicated page sequence for deletion', async () => {
    for (const repeated of [false, true]) {
      const fetcher = transport();
      fetcher.mockImplementation(async url => {
        if (url.endsWith('/api/auth/session')) return response({ accessToken: 'fixture' });
        return response({ items: new URL(url).searchParams.get('offset') === '0' || repeated ? [record()] : [], total: 2 });
      });
      const client = new DatedHistoryClient(fetcher as typeof fetch);
      await expect(client.list(new AbortController().signal)).rejects.toThrow(repeated ? '期間變動' : '完整讀取');
    }
  });
  it('recognizes numeric timestamp strings and refreshes only the newest metadata page', async () => {
    const fetcher = transport();
    fetcher.mockImplementation(async url => url.endsWith('/api/auth/session') ? response({ accessToken: 'fixture', user: { id: 'account-a' } }) : response({ items: [{ ...record('latest'), create_time: String(day(1) / 1000), update_time: String(day(9) / 1000) }], total: 200 }));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    expect(await client.connect(new AbortController().signal)).toBe('account-a');
    const page = await client.recent(new AbortController().signal);
    expect(page.complete).toBe(false); expect(page.items[0].updatedAt).toBe(day(9));
    expect(filterDatedChats(page.items, range, null)[0].id).toBe('latest');
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/conversations?'))).toHaveLength(1);
  });
  it('rejects deletion after a login account change without sending a PATCH', async () => {
    const fetcher = transport(); let sessions = 0;
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => url.endsWith('/api/auth/session') ? response({ accessToken: 'fixture', user: { id: ++sessions === 1 ? 'account-a' : 'account-b' } }) : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await expect(client.remove(selected, range, new AbortController().signal, vi.fn())).rejects.toThrow('登入狀態已變更');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it.each([
    { title: '自動產生的新標題', update_time: new Date(day(6) + 456).toISOString() },
    { title: '新標題', create_time: undefined, update_time: undefined },
    { update_time: (day(5) + 999) / 1000 },
  ])('accepts the same selected ID despite list/detail metadata differences: %j', async detail => {
    const fetcher = transport(); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => url.endsWith('/conversation/old') && init?.method !== 'PATCH'
      ? Promise.resolve(response({ ...record(), ...detail })) : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await client.remove(selected, range, new AbortController().signal, vi.fn());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('uses only the chosen date basis when a different date changes', async () => {
    const fetcher = transport({ changed: true }); const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await client.remove(selected, { ...range, basis: 'createdAt' }, new AbortController().signal, vi.fn());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it.each([{ id: 'different' }, { is_archived: true }])('rejects mismatched IDs or archived conversations: %j', async detail => {
    const fetcher = transport(); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => url.endsWith('/conversation/old') && init?.method !== 'PATCH'
      ? Promise.resolve(response({ ...record(), ...detail })) : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal);
    await expect(client.remove(selected, range, new AbortController().signal, vi.fn())).rejects.toThrow();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it('clears a record already removed elsewhere without repeating its PATCH', async () => {
    const fetcher = transport(); const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => url.endsWith('/conversation/old') && init?.method !== 'PATCH'
      ? Promise.resolve(response({ ...record(), is_visible: false })) : original(url, init));
    const client = new DatedHistoryClient(fetcher as typeof fetch);
    const selected = await client.list(new AbortController().signal); const progress = vi.fn();
    await client.remove(selected, range, new AbortController().signal, progress);
    expect(progress).toHaveBeenCalledWith(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
});
