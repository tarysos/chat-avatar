export interface DatedChat {
  id: string;
  title: string;
  createdAt: number | null;
  updatedAt: number | null;
}
export interface HistoryRange { start: string; end: string; basis: 'createdAt' | 'updatedAt'; }

function timestamp(value: unknown): number | null {
  const numeric = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  const time = typeof numeric === 'number' ? numeric * (numeric < 1e12 ? 1000 : 1)
    : typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
}
function chat(value: unknown): DatedChat {
  if (!value || typeof value !== 'object') throw new Error('ChatGPT 對話資料格式已變更，請更新擴充功能。');
  const item = value as Record<string, unknown>;
  const id = item.id || item.conversation_id;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('ChatGPT 回傳無效的對話識別碼，已停止。');
  return { id, title: typeof item.title === 'string' && item.title.trim() ? item.title : '未命名對話', createdAt: timestamp(item.create_time), updatedAt: timestamp(item.update_time) };
}
function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('請選擇完整的開始與結束日期。');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('日期無效，請重新選擇。');
  return date;
}
export function dateBounds(range: HistoryRange): { start: number; end: number } {
  const start = calendarDate(range.start); const end = calendarDate(range.end);
  if (end < start) throw new Error('結束日期必須晚於或等於開始日期。');
  if (range.basis !== 'createdAt' && range.basis !== 'updatedAt') throw new Error('請選擇日期依據。');
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}
export function filterDatedChats(chats: DatedChat[], range: HistoryRange, currentId: string | null): DatedChat[] {
  const bounds = dateBounds(range);
  return chats.filter(item => item.id !== currentId && item[range.basis] !== null && item[range.basis]! >= bounds.start && item[range.basis]! < bounds.end)
    .sort((a, b) => b[range.basis]! - a[range.basis]!);
}
export function currentChatId(): string | null { return location.pathname.match(/\/c\/([\w-]+)\/?$/)?.[1] || null; }

/** Same-origin ChatGPT web transport. Authentication is memory-only and never logged or persisted. */
export class DatedHistoryClient {
  private token = '';
  public identity = '';
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}

  private async json(path: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    if (signal.aborted) throw new Error('已停止，尚未處理的對話會保留。');
    let response: Response;
    try {
      response = await this.request(new URL(path, location.origin).href, {
        method, credentials: 'include', signal, cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      if (method === 'PATCH') throw new Error('刪除結果未確認，請重新整理 ChatGPT 後再檢查。後續項目已停止。');
      if (signal.aborted) throw new Error('已停止，尚未處理的對話會保留。');
      throw new Error('無法連線到 ChatGPT，請檢查連線後重試。');
    }
    if (signal.aborted) throw new Error('已停止，尚未處理的對話會保留。');
    if (!response.ok) {
      if (response.status === 401) { this.token = ''; throw new Error('登入已過期，請重新登入 ChatGPT 後再讀取。'); }
      if (response.status === 429) throw new Error('ChatGPT 暫時限制請求，請稍後重新讀取清單。');
      throw new Error(`ChatGPT 無法處理這次操作（${response.status}），已停止。`);
    }
    try {
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result as Record<string, unknown>;
    } catch { throw new Error('ChatGPT 回應格式無法辨識，請重新整理後檢查結果。'); }
  }

  private async authenticate(signal: AbortSignal): Promise<void> {
    const response = await this.request(new URL('/api/auth/session', location.origin).href, { credentials: 'include', cache: 'no-store', signal });
    if (!response.ok) throw new Error('無法讀取登入狀態，請重新登入 ChatGPT。');
    const session = await response.json();
    if (typeof session?.accessToken !== 'string' || !session.accessToken) throw new Error('請先登入 ChatGPT，再讀取日期清單。');
    this.token = session.accessToken;
    this.identity = typeof session.user?.id === 'string' ? session.user.id : typeof session.user?.email === 'string' ? session.user.email : '';
  }

  public async connect(signal: AbortSignal): Promise<string> { await this.authenticate(signal); return this.identity; }

  /** Refresh the newest page; older cached records remain subject to per-item delete checks. */
  public async recent(signal: AbortSignal): Promise<{ items: DatedChat[]; removed: string[]; complete: boolean }> {
    if (!this.token) await this.authenticate(signal);
    const data = await this.json('/backend-api/conversations?offset=0&limit=100&order=updated', signal);
    if (!Array.isArray(data.items)) throw new Error('ChatGPT 日期清單格式已變更，請重新讀取全部。');
    const items: DatedChat[] = []; const removed: string[] = []; const seen = new Set<string>();
    for (const value of data.items) {
      const item = chat(value);
      if (seen.has(item.id)) throw new Error('最新清單含重複對話，請重新讀取全部。');
      seen.add(item.id);
      const metadata = value as Record<string, unknown>;
      if (metadata.is_archived || metadata.is_visible === false) removed.push(item.id); else items.push(item);
    }
    return { items, removed, complete: typeof data.total === 'number' && data.total <= data.items.length };
  }

  public async list(signal: AbortSignal, progress: (count: number) => void = () => {}): Promise<DatedChat[]> {
    await this.authenticate(signal);
    const found = new Map<string, DatedChat>();
    const seen = new Set<string>();
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const data = await this.json(`/backend-api/conversations?offset=${offset}&limit=100&order=updated`, signal);
      if (!Array.isArray(data.items)) throw new Error('ChatGPT 日期清單格式已變更，無法安全篩選。');
      if (!data.items.length) {
        if (typeof data.total === 'number' && offset < data.total) throw new Error('對話清單尚未完整讀取，請重新讀取後再篩選。');
        return Array.from(found.values());
      }
      for (const value of data.items) {
        const item = chat(value);
        if (seen.has(item.id)) throw new Error('對話清單在載入期間變動，請重新讀取。');
        seen.add(item.id);
        if (!(value as Record<string, unknown>).is_archived && (value as Record<string, unknown>).is_visible !== false) found.set(item.id, item);
      }
      offset += data.items.length; progress(found.size);
      if (typeof data.total === 'number' && offset >= data.total) return Array.from(found.values());
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('對話數量超過這次可完整讀取的範圍，請稍後重試。沒有執行刪除。');
  }

  public async remove(selected: DatedChat[], range: HistoryRange, signal: AbortSignal, progress: (count: number) => void): Promise<void> {
    if (!this.token) throw new Error('請先重新讀取對話日期清單。');
    const page = location.pathname;
    const check = (): void => {
      if (signal.aborted) throw new Error('已停止，尚未處理的對話會保留。');
      if (page !== location.pathname) throw new Error('目前對話已切換，後續刪除已停止。');
    };
    const bounds = dateBounds(range);
    if (!selected.length || new Set(selected.map(item => item.id)).size !== selected.length) throw new Error('請重新勾選要刪除的對話。');
    if (filterDatedChats(selected, range, currentChatId()).length !== selected.length) throw new Error('刪除清單不符合日期區間，或包含目前開啟的對話。');
    check();
    const identity = this.identity;
    await this.authenticate(signal);
    if (identity && identity !== this.identity) throw new Error('登入狀態已變更，請更新清單後再刪除。');
    check();
    const reads = new AbortController();
    const stopReads = (): void => reads.abort();
    signal.addEventListener('abort', stopReads, { once: true });
    // Read at most one item ahead. Settle failures immediately so an unused
    // prefetch cannot reject unhandled when the current deletion fails or stops.
    const read = (item: DatedChat) => this.json(`/backend-api/conversation/${encodeURIComponent(item.id)}`, reads.signal)
      .then(data => ({ data, readAt: Date.now() }), (error: unknown) => ({ error }));
    let detail = read(selected[0]);
    try {
      for (let index = 0; index < selected.length; index++) {
        check();
        const item = selected[index];
        let fetched = await detail;
        check();
        // A slow preceding deletion must not turn read-ahead into a stale cache.
        if ('data' in fetched && Date.now() - fetched.readAt > 2000) fetched = await read(item);
        check();
        if ('error' in fetched) throw fetched.error;
        const data = fetched.data;
        const fresh = chat({ ...data, id: data.conversation_id || data.id || item.id });
        if (fresh.id !== item.id) throw new Error('回傳的對話與勾選項目不同，請更新清單後再試。');
        if (data.is_archived === true) throw new Error(`「${item.title}」已封存，請更新清單後再試。`);
        // Validate the chosen date basis immediately before sending its deletion;
        // omitted detail fields retain the dates in the confirmed selection.
        const currentDate = fresh[range.basis];
        if (currentDate !== null && (currentDate < bounds.start || currentDate >= bounds.end)) throw new Error(`「${item.title}」已不在所選日期範圍，請更新清單後再試。`);
        check();
        if (data.is_visible !== false) {
          // Finish observing a sent deletion even after Stop. Only its next
          // metadata read runs concurrently; a second PATCH must wait for success.
          const completion = new AbortController();
          const timeout = setTimeout(() => completion.abort(), 15000);
          let result: Record<string, unknown>;
          try {
            const deletion = this.json(`/backend-api/conversation/${encodeURIComponent(item.id)}`, completion.signal, 'PATCH', { is_visible: false });
            if (index + 1 < selected.length) detail = read(selected[index + 1]);
            result = await deletion;
          } finally { clearTimeout(timeout); }
          if (result.success !== true && result.is_visible !== false) throw new Error('刪除結果未確認，請重新整理 ChatGPT 後檢查；後續項目已停止。');
        }
        progress(index + 1);
        if (data.is_visible === false && index + 1 < selected.length) {
          check(); detail = read(selected[index + 1]);
        }
      }
    } finally {
      signal.removeEventListener('abort', stopReads);
      reads.abort();
    }
  }
  public clear(): void { this.token = ''; this.identity = ''; }
}
