import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PageActions } from '@/content/PageActions';
import { TargetSite } from '@/common/types';
import { downloadText } from '@/common/download';

vi.mock('@/common/download', () => ({ downloadText: vi.fn() }));
const record = (id: string): Record<string, unknown> => ({ id, title: `對話 ${id}`, create_time: new Date(2026, 9, 2, 12).toISOString(), update_time: new Date(2026, 9, 5, 12).toISOString() });
const response = (body: unknown): Response => new Response(JSON.stringify(body));

describe('native page action placement and date review', () => {
  let actions: PageActions;
  let fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response({}));
  beforeEach(() => {
    window.location.href = 'https://chatgpt.com/c/current'; vi.clearAllMocks();
    document.documentElement.classList.add('dark');
    document.body.innerHTML = '<header><button type="button" data-testid="share-chat-button">分享</button></header><nav><h2>最近項目</h2><div><a href="/c/old">對話 old</a></div></nav><main><article data-turn="assistant"><div class="markdown">回答一</div></article><article data-turn="assistant"><div class="markdown">回答二</div></article><form><div id="prompt-textarea" contenteditable="true"></div><div><button type="button" data-testid="composer-speech-button">語音</button></div></form></main>';
    fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/session')) return response({ accessToken: 'fixture-only', user: { email: 'fixture@example.test' } });
      if (url.includes('/conversations?')) return response({ items: [record('current'), record('old')], total: 2 });
      if (init?.method === 'PATCH') return response({ success: true });
      if (url.endsWith('/backend-api/conversation/current')) return response({ conversation_id: 'current', title: '完整測試對話', current_node: 'a2', mapping: {
        u: { parent: null, message: { author: { role: 'user' }, content: { parts: ['頁面未載入的較早問題'] } } },
        a1: { parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['回答一'] } } },
        a2: { parent: 'a1', message: { author: { role: 'assistant' }, content: { parts: ['回答二'] } } },
      } });
      return response(record('old'));
    });
    vi.stubGlobal('fetch', fetcher);
    actions = new PageActions(TargetSite.CHATGPT);
  });
  afterEach(() => { actions.destroy(); document.documentElement.classList.remove('dark'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const button = (id: string): HTMLButtonElement => document.getElementById(id)!.querySelector('button')!;
  const dialogRoot = (): ShadowRoot => document.getElementById('ai-avatar-date-history')!.shadowRoot!;
  const toggle = (visible: boolean): void => { window.dispatchEvent(new CustomEvent('ai-avatar-actions-visibility', { detail: visible })); };
  const choose = (format: string): void => { document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLButtonElement>(`[data-format="${format}"]`)!.click(); };

  it('hides export in a blank new chat, shows it after sending and removes it on returning to a new chat', async () => {
    actions.destroy(); vi.useFakeTimers();
    try {
      window.location.href = 'https://chatgpt.com/';
      document.body.innerHTML = '<header><button data-testid="share-chat-button">分享</button></header><main><h1>準備好了，隨時等你。</h1><div id="prompt-textarea" contenteditable="true">尚未送出的草稿</div></main>';
      actions = new PageActions(TargetSite.CHATGPT);
      expect(document.getElementById('ai-avatar-composer-export')).toBeNull();
      document.getElementById('prompt-textarea')!.textContent = '修改草稿';
      await vi.advanceTimersByTimeAsync(30000);
      expect(document.getElementById('ai-avatar-composer-export')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<article data-turn="user">第一個已送出的問題</article>');
      await vi.advanceTimersByTimeAsync(200);
      expect(document.getElementById('ai-avatar-composer-export')).not.toBeNull();
      button('ai-avatar-composer-export').click();
      const menu = document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLElement>('.menu')!;
      expect(menu.hidden).toBe(false);
      document.querySelector('main')!.innerHTML = '<h1>另一個新對話</h1><textarea>尚未送出</textarea>';
      await vi.advanceTimersByTimeAsync(200);
      expect(document.getElementById('ai-avatar-composer-export')).toBeNull();
      expect(menu.hidden).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      window.location.href = 'https://chatgpt.com/c/current';
      document.querySelector('main')!.innerHTML = '<section>聊天載入中</section>';
      await vi.advanceTimersByTimeAsync(200);
      expect(document.getElementById('ai-avatar-composer-export')).not.toBeNull();
    } finally { actions.destroy(); vi.useRealTimers(); }
  });
  it('settles after mounting page controls without an idle observer or network loop', async () => {
    actions.destroy(); vi.useFakeTimers();
    const layout = vi.fn();
    window.addEventListener('ai-avatar-composer-layout', layout);
    try {
      document.querySelector('main')!.insertAdjacentHTML('afterbegin', '<article data-turn="user">已送出的問題</article>');
      actions = new PageActions(TargetSite.CHATGPT);
      await vi.advanceTimersByTimeAsync(1000);
      const mounts = layout.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(layout).toHaveBeenCalledTimes(mounts);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      actions.destroy(); window.removeEventListener('ai-avatar-composer-layout', layout); vi.useRealTimers();
    }
  });
  it('places export immediately before Share and keeps deletion outside the native heading', async () => {
    expect(document.getElementById('ai-avatar-composer-export')!.nextElementSibling?.getAttribute('data-testid')).toBe('share-chat-button');
    expect(document.getElementById('ai-avatar-date-delete')!.parentElement).toBe(document.body);
    expect(document.querySelector('h2')!.style.cssText).toBe('');
    expect(document.querySelector('form #ai-avatar-composer-export')).toBeNull();
    const submit = vi.fn(); document.querySelector('form')!.addEventListener('submit', submit);
    expect(document.getElementById('ai-avatar-composer-export')!.style.display).toBe('inline-flex');

    expect(document.getElementById('ai-avatar-date-delete')!.style.display).toBe('inline-flex');
    button('ai-avatar-composer-export').dispatchEvent(new PointerEvent('pointerenter'));
    expect(downloadText).not.toHaveBeenCalled();
    button('ai-avatar-composer-export').click();
    expect(downloadText).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    expect(button('ai-avatar-composer-export').textContent).toBe('下載');
    choose('markdown');
    await vi.waitFor(() => expect(downloadText).toHaveBeenCalledOnce());
    expect(submit).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('回答一');
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('回答二');
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('頁面未載入的較早問題');
    const answer = document.querySelectorAll<HTMLElement>('[data-ai-avatar-answer-download]')[1].shadowRoot!.querySelector('button')!;
    answer.click();
    choose('markdown');
    expect(vi.mocked(downloadText).mock.calls[1][0]).toContain('回答二');
    expect(vi.mocked(downloadText).mock.calls[1][0]).not.toContain('回答一');
    expect(document.getElementById('ai-avatar-export-dialog')).toBeNull();
    expect(document.getElementById('ai-avatar-message-picker')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    toggle(false);
    expect(document.getElementById('ai-avatar-composer-export')!.style.display).toBe('inline-flex');
    expect(button('ai-avatar-composer-export').getAttribute('aria-haspopup')).toBe('menu');
  });
  it('mounts only one control after repeated mutations and remounts when the header is replaced', async () => {

    document.body.append(document.createElement('div'));
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(document.querySelectorAll('#ai-avatar-date-delete')).toHaveLength(1);
    expect(document.querySelectorAll('#ai-avatar-composer-export')).toHaveLength(1);
    expect(document.getElementById('ai-avatar-composer-export')!.style.display).toBe('inline-flex');
    document.querySelector('header')!.outerHTML = '<header><button type="button" aria-label="分享聊天">分享</button></header>';
    await vi.waitFor(() => expect(document.querySelector('#ai-avatar-composer-export')?.nextElementSibling?.getAttribute('aria-label')).toBe('分享聊天'));
    expect(document.querySelectorAll('#ai-avatar-composer-export')).toHaveLength(1);
  });
  it('uses a top-right fallback when Share is unavailable, without placing export in the composer', async () => {
    actions.destroy();
    document.body.innerHTML = '<main><div class="new-composer"><div class="editor"><div id="prompt-textarea" contenteditable="true"></div></div><div class="actions"><button aria-label="Send prompt" type="button">Send</button></div></div></main>';
    actions = new PageActions(TargetSite.CHATGPT);
    const host = document.getElementById('ai-avatar-composer-export')!;
    expect(host.style.top).toBe('16px'); expect(host.style.right).toBe('20px');
    expect(host.hasAttribute('data-fallback')).toBe(true); expect(host.parentElement).toBe(document.body);
    button('ai-avatar-composer-export').click();
    expect(document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLElement>('.menu')!.hidden).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps export available before hydration and moves the same control when Share appears', async () => {
    actions.destroy();
    document.body.innerHTML = '<header class="pending"><button type="button">待載入</button></header><main></main>';
    actions = new PageActions(TargetSite.CHATGPT);
    const host = document.getElementById('ai-avatar-composer-export')!;
    expect(host.parentElement).toBe(document.body); expect(host.style.position).toBe('fixed');
    expect(host.style.display).toBe('inline-flex');
    button('ai-avatar-composer-export').click();
    expect(document.getElementById('ai-avatar-export-dialog')).toBeNull();
    // Hydration can assign attributes to existing nodes without adding any children.
    const wrapper = document.querySelector<HTMLElement>('.pending')!;
    wrapper.id = 'thread-header'; wrapper.firstElementChild!.setAttribute('data-testid', 'share-chat-button');
    await vi.waitFor(() => expect(host.parentElement).toBe(wrapper));
    expect(document.getElementById('ai-avatar-composer-export')).toBe(host);
    expect(host.hasAttribute('data-fallback')).toBe(false); expect(host.style.position).toBe('');
    expect(button('ai-avatar-composer-export').getAttribute('aria-haspopup')).toBe('menu');
    wrapper.hidden = true;
    await vi.waitFor(() => expect(host.parentElement).toBe(document.body));
    expect(host.style.display).toBe('inline-flex');
    toggle(false); expect(host.style.display).toBe('inline-flex');
  });
  it('skips hidden Share buttons and attaches to the visible header', () => {
    actions.destroy();
    document.body.innerHTML = '<header hidden><button data-testid="share-chat-button">舊分享</button></header><header id="thread-header"><button type="button" data-testid="share-chat-button">分享</button></header>';
    actions = new PageActions(TargetSite.CHATGPT);
    expect(document.getElementById('ai-avatar-composer-export')!.parentElement?.id).toBe('thread-header');
    expect(document.getElementById('ai-avatar-composer-export')!.nextElementSibling?.textContent).toBe('分享');
  });
  it('uses native toolbar classes without copying native actions or identities', async () => {
    actions.destroy();
    document.body.innerHTML = `<header><button id="native-share" data-testid="share-chat-button" class="share-button hover-surface" style="height:36px;border:0;font-weight:500" aria-label="分享"><svg class="size-5" style="width:20px;height:20px"></svg><span class="max-sm:hidden">分享</span></button></header>
      <nav><h2>最近項目</h2><button id="native-new" data-testid="create-new-chat-button" class="new-chat-button hover-surface" aria-label="新對話" style="width:32px;height:32px"><svg class="size-5" style="width:20px;height:20px"></svg></button></nav>`;
    const nativeClick = vi.fn(); document.getElementById('native-new')!.addEventListener('click', nativeClick);
    actions = new PageActions(TargetSite.CHATGPT);
    const download = button('ai-avatar-composer-export'); const deletion = button('ai-avatar-date-delete');
    expect(download.className).toBe('share-button hover-surface');
    expect(download.style.border).toBe('0px');
    expect(download.querySelector('span')!.className).toBe('max-sm:hidden');
    expect(download.querySelector('svg')!.getAttribute('class')).toBe('size-5');
    expect(deletion.className).toBe('new-chat-button hover-surface');
    expect(deletion.style.height).toBe('32px');
    expect(deletion.getAttribute('aria-label')).toBe('依日期刪除對話');
    expect(deletion.hasAttribute('data-testid')).toBe(false); expect(deletion.id).toBe('');
    deletion.click(); expect(nativeClick).not.toHaveBeenCalled();
    expect(dialogRoot().querySelector('dialog')!.open).toBe(true);
    const share = document.getElementById('native-share')!;
    share.className = 'updated-share';
    await vi.waitFor(() => expect(download.className).toBe('updated-share'));
    share.remove();
    await vi.waitFor(() => expect(download.className).toBe('header-download'));
    expect(download.style.border).toBe('');
    expect(download.querySelector('span')!.className).toBe('');
  });
  it('preserves native icon and hit-area dimensions outside sidebar-scoped styles', () => {
    actions.destroy();
    document.body.innerHTML = `<style>.sidebar .new-chat{width:36px;height:36px;padding:6px}.sidebar .new-chat svg{width:24px;height:24px}</style>
      <nav class="sidebar"><h2>最近項目</h2><button class="new-chat" aria-label="新對話"><svg viewBox="0 0 24 24"></svg></button></nav>`;
    actions = new PageActions(TargetSite.CHATGPT);
    const deletion = button('ai-avatar-date-delete'); const icon = deletion.querySelector('svg')!;
    expect(deletion.closest('.sidebar')).toBeNull();
    expect(deletion.style.width).toBe('36px'); expect(deletion.style.height).toBe('36px');
    expect(deletion.style.minWidth).toBe('36px'); expect(deletion.style.flexShrink).toBe('0');
    expect(icon.style.width).toBe('24px'); expect(icon.style.height).toBe('24px'); expect(icon.style.flexShrink).toBe('0');
    expect(icon.getAttribute('viewBox')).toBe('2 2 20 20');
  });
  it('does not shift deletion or trigger the native new-chat row when hover actions appear', async () => {
    actions.destroy();
    document.body.innerHTML = '<nav><div class="row"><button type="button"><span>最近項目</span></button><div class="hover-actions" hidden><button type="button">新增對話</button></div></div></nav>';
    const label = document.querySelector('nav span')!;
    const labelBounds = vi.spyOn(label, 'getBoundingClientRect').mockReturnValue({ left: 24, right: 104, top: 100, bottom: 120, width: 80, height: 20, x: 24, y: 100, toJSON() {} });
    const range = document.createRange();
    vi.spyOn(range, 'getBoundingClientRect').mockImplementation(() => label.getBoundingClientRect());
    vi.spyOn(document, 'createRange').mockReturnValue(range);
    const sidebar = document.querySelector('nav')!;
    sidebar.style.paddingRight = '20px';
    const bounds = vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 360, top: 0, bottom: 700, width: 360, height: 700, x: 0, y: 0, toJSON() {} });
    const row = document.querySelector<HTMLElement>('.row')!;
    row.style.setProperty('max-width', '100%', 'important');
    const original = row.style.cssText;
    const clicked = vi.fn(); document.querySelector('.row')!.addEventListener('click', clicked);
    actions = new PageActions(TargetSite.CHATGPT);
    const host = document.getElementById('ai-avatar-date-delete')!; const before = host.style.cssText;
    expect(host.style.left).toBe('126px');
    expect(row.style.cssText).toBe(original);
    (document.querySelector('.hover-actions') as HTMLElement).hidden = false;
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(host.style.cssText).toBe(before); expect(host.parentElement).toBe(document.body);
    button('ai-avatar-date-delete').click();
    expect(clicked).not.toHaveBeenCalled(); expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(dialogRoot().querySelector('dialog')!.open).toBe(true);
    bounds.mockReturnValue({ left: 0, right: 300, top: 0, bottom: 700, width: 300, height: 700, x: 0, y: 0, toJSON() {} });
    window.dispatchEvent(new Event('resize'));
    expect(host.style.left).toBe('126px');
    labelBounds.mockReturnValue({ left: 44, right: 124, top: 100, bottom: 120, width: 80, height: 20, x: 44, y: 100, toJSON() {} });
    window.dispatchEvent(new Event('resize'));
    expect(host.style.left).toBe('146px');
    actions.destroy();
    expect(row.style.cssText).toBe(original);
  });
  it.each([
    '<h2>最近項目</h2><div><a href="/c/old">對話 old</a></div>',
    '<h2>最近項目</h2><div style="height:160px"><div style="position:absolute;top:40px"><a href="/c/old">對話 old</a></div><div><a href="/c/keep">保留對話</a></div></div>',
    '<h2>最近項目</h2><div><a href="/c/old">對話 old</a><a href="/c/keep">保留對話</a><button>更多</button></div>',
  ])('confirms deletion and preserves native sidebar layout: %s', async sidebar => {
    const nav = document.querySelector('nav')!; nav.innerHTML = sidebar;
    const nativeMarkup = nav.innerHTML;
    button('ai-avatar-date-delete').click();
    const root = dialogRoot();
    expect(root.querySelector('dialog')!.open).toBe(true);
    expect(fetcher).toHaveBeenCalled();
    (root.getElementById('start') as HTMLInputElement).value = '2026-10-01';
    (root.getElementById('end') as HTMLInputElement).value = '2026-10-10';
    root.getElementById('preview')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('#list input')).toHaveLength(2));
    expect(root.querySelector<HTMLInputElement>('#list input[value=current]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('#list input[value=old]')!.checked).toBe(false);
    expect((root.getElementById('delete') as HTMLButtonElement).disabled).toBe(true);
    const selected = root.querySelector<HTMLInputElement>('#list input[value=old]')!; selected.checked = true; selected.dispatchEvent(new Event('change'));
    expect(root.getElementById('check')).toBeNull();
    root.getElementById('delete')!.click();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(root.getElementById('confirm-titles')!.textContent).toContain('對話 old');
    root.getElementById('confirm-cancel')!.click();
    root.getElementById('delete')!.click();
    root.getElementById('confirm-delete')!.click();
    await vi.waitFor(() => expect(root.getElementById('status')!.textContent).toContain('已刪除 1 筆'));
    expect(root.getElementById('result-view')!.hidden).toBe(false);
    expect(root.getElementById('result-title')!.textContent).toBe('刪除成功');
    expect(nav.innerHTML).toBe(nativeMarkup);
  });
  it('refuses reversed dates without making authenticated requests', () => {
    const root = dialogRoot();
    (root.getElementById('start') as HTMLInputElement).value = '2026-10-10';
    (root.getElementById('end') as HTMLInputElement).value = '2026-10-01';
    root.getElementById('end')!.dispatchEvent(new Event('change'));
    button('ai-avatar-date-delete').click();
    expect(root.getElementById('status')!.textContent).toContain('結束日期'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('supports dismissing the format menu and never downloads merely from opening it', async () => {
    const trigger = button('ai-avatar-composer-export'); trigger.click();
    const menu = document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLElement>('.menu')!;
    expect(menu.querySelectorAll('button')).toHaveLength(3); expect(fetcher).not.toHaveBeenCalled();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click(); button('ai-avatar-date-delete').click(); expect(menu.hidden).toBe(true);
    dialogRoot().getElementById('close')!.click();
    trigger.click(); window.location.href = 'https://chatgpt.com/c/another'; document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(menu.hidden).toBe(true)); expect(downloadText).not.toHaveBeenCalled();
  });
  it('removes disabled features immediately and keeps them off through navigation and page mutations', async () => {
    actions.setFeatures({ questionOutline: false, conversationExport: false, answerExport: false, historyDelete: false });
    const controls = '#ai-avatar-question-outline,#ai-avatar-composer-export,#ai-avatar-date-delete,[data-ai-avatar-answer-download]';
    expect(document.querySelectorAll(controls)).toHaveLength(0);
    window.location.href = 'https://chatgpt.com/c/new';
    document.querySelector('main')!.innerHTML = '<article data-turn="user">新問題</article><article data-turn="assistant">新回答</article>';
    window.dispatchEvent(new Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(document.querySelectorAll(controls)).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
    actions.setFeatures({ questionOutline: true, conversationExport: false, answerExport: false, historyDelete: false });
    expect(document.querySelector('#ai-avatar-question-outline')).not.toBeNull();
    expect(document.querySelector('[data-ai-avatar-answer-download],#ai-avatar-composer-export,#ai-avatar-date-delete')).toBeNull();
    actions.setFeatures({ questionOutline: false, conversationExport: false, answerExport: true, historyDelete: false });
    expect(document.querySelector('#ai-avatar-question-outline')).toBeNull();
    expect(document.querySelectorAll('[data-ai-avatar-answer-download]')).toHaveLength(1);
    actions.setFeatures();
    expect(document.querySelectorAll('[data-ai-avatar-answer-download]')).toHaveLength(1);
    expect(document.querySelector('#ai-avatar-composer-export')).not.toBeNull();
    expect(document.querySelector('#ai-avatar-date-delete')).not.toBeNull();
  });
  it('closes feature UI and aborts a pending full export when the feature is disabled', async () => {
    let signal: AbortSignal | null | undefined;
    fetcher.mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    button('ai-avatar-composer-export').click(); choose('markdown');
    await vi.waitFor(() => expect(signal).toBeDefined());
    actions.setFeatures({ conversationExport: false });
    expect(signal!.aborted).toBe(true);
    expect(document.getElementById('ai-avatar-composer-export')).toBeNull();
    expect(document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLElement>('.menu')!.hidden).toBe(true);
    expect(document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLElement>('.notice')!.hidden).toBe(true);
    expect(document.querySelectorAll('[data-ai-avatar-answer-download]')).toHaveLength(2);
    expect(downloadText).not.toHaveBeenCalled();
  });
});
