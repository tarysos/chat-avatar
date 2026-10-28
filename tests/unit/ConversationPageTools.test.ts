import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageActions } from '@/content/PageActions';
import { captureConversation } from '@/content/ConversationExport';
import { TargetSite } from '@/common/types';
import { downloadText } from '@/common/download';

vi.mock('@/common/download', () => ({ downloadText: vi.fn() }));

describe('question navigation and direct downloads', () => {
  let actions: PageActions;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const resize = (width: number, height = 900): void => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  };
  const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON(): object { return {}; } });
  const outline = (): ShadowRoot => document.getElementById('ai-avatar-question-outline')!.shadowRoot!;
  const answerButtons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll('[data-ai-avatar-answer-download]')).map(host => host.shadowRoot!.querySelector('button')!);
  const header = (): HTMLElement => document.getElementById('ai-avatar-composer-export')!;
  const choose = (format: string): void => { document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector<HTMLButtonElement>(`[data-format="${format}"]`)!.click(); };
  beforeEach(() => {
    vi.clearAllMocks(); window.location.href = 'https://chatgpt.com/c/questions';
    document.body.innerHTML = '<header><button data-testid="share-chat-button">分享</button></header><nav><h2>最近項目</h2><a href="/c/old">舊聊天</a></nav><main><article data-turn="user">第一個問題</article><article data-turn="assistant">第一則回答</article><article data-turn="user">第二個問題</article><article data-turn="assistant">第二則回答</article></main>';
    vi.stubGlobal('fetch', vi.fn(async (input: string) => new Response(JSON.stringify(input.endsWith('/api/auth/session') ? { accessToken: 'fixture-only' } : {
      conversation_id: 'questions', title: '測試聊天', current_node: 'a', mapping: {
        u: { parent: null, message: { author: { role: 'user' }, content: { parts: ['第一個問題'] } } },
        a: { parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['第一則回答'] } } },
      },
    }))));
    actions = new PageActions(TargetSite.CHATGPT);
  });
  afterEach(() => { actions.destroy(); resize(viewport.width, viewport.height); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('lists original questions on the left, jumps to the question and downloads an answer without a dialog', async () => {
    expect(document.getElementById('ai-avatar-question-outline')!.parentElement).toBe(document.body);
    expect(document.querySelector('nav #ai-avatar-question-outline')).toBeNull();
    expect(outline().querySelector('summary')!.textContent).toContain('問題');
    expect(outline().querySelectorAll('nav button')).toHaveLength(2);
    const second = document.querySelectorAll<HTMLElement>('article')[2];
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 240, height: 40, left: 300, right: 900, width: 600, x: 300, y: 200, toJSON() {} });
    second.scrollIntoView = vi.fn();
    const jump = outline().querySelectorAll<HTMLButtonElement>('nav button')[1]; jump.click();
    expect(second.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(jump.getAttribute('aria-current')).toBe('true');
    document.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(jump.getAttribute('aria-current')).toBe('true');
    answerButtons()[1].click();
    expect(downloadText).not.toHaveBeenCalled(); choose('markdown');
    const [text, filename] = vi.mocked(downloadText).mock.calls[0];
    expect(text).toContain('第二則回答'); expect(text).not.toContain('第一則回答'); expect(text).not.toContain('第二個問題');
    expect(filename).toContain('回答-2.md');
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.getElementById('ai-avatar-export-dialog')).toBeNull();
    expect(captureConversation(TargetSite.CHATGPT).messages[1].preview).toBe('第一則回答');
  });
  it('updates new questions, streaming answers and replaced chats without duplicate or stale controls', async () => {
    const stale = answerButtons()[0];
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<article data-turn="user">第三個問題</article><article data-turn="assistant" data-is-streaming="true">產生中</article>');
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(3));
    expect(answerButtons()).toHaveLength(3); expect(answerButtons()[2].disabled).toBe(true);
    const last = document.querySelectorAll('article')[5]; last.textContent = '第三則回答'; last.removeAttribute('data-is-streaming');
    await vi.waitFor(() => expect(answerButtons()[2].disabled).toBe(false));
    answerButtons()[2].click(); choose('markdown'); expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('第三則回答');
    vi.mocked(downloadText).mockClear();
    window.location.href = 'https://chatgpt.com/c/replaced';
    document.querySelector('main')!.innerHTML = '<article data-turn="user">新的聊天問題</article><article data-turn="assistant">新的回答</article>';
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(1));
    expect(outline().querySelector('nav')!.textContent).toContain('新的聊天問題'); expect(answerButtons()).toHaveLength(1);
    stale.click(); choose('markdown'); expect(downloadText).not.toHaveBeenCalled();
    answerButtons()[0].click(); choose('markdown'); expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('新的回答');
  });
  it('restores individual downloads for role-free answers and remounts after content replacement', async () => {
    const main = document.querySelector('main')!;
    main.innerHTML = '<div data-role="user">問題</div><section data-message-id="first"><div class="markdown">第一段回答</div><div class="markdown">第二段回答</div></section><div data-testid="assistant-message">另一則回答</div>';
    await vi.waitFor(() => expect(answerButtons()).toHaveLength(2));
    answerButtons()[0].click(); choose('markdown');
    const first = vi.mocked(downloadText).mock.calls[0][0];
    expect(first).toContain('第一段回答'); expect(first).toContain('第二段回答'); expect(first).not.toContain('另一則回答');
    vi.mocked(downloadText).mockClear();
    document.querySelector('section')!.innerHTML = '<div class="markdown">更新後的回答</div>';
    await vi.waitFor(() => expect(answerButtons()).toHaveLength(2));
    document.querySelector<HTMLElement>('section + [data-ai-avatar-answer-download]')!.shadowRoot!.querySelector('button')!.click(); choose('html');
    const updated = vi.mocked(downloadText).mock.calls[0][0];
    expect(updated).toContain('更新後的回答'); expect(updated).not.toContain('第一段回答');
    expect(updated).not.toContain('另一則回答'); expect(updated).not.toContain('下載此回答');
  });
  it('places an icon-only download before Share outside a clipped answer body and follows toolbar replacement', async () => {
    document.querySelector('main')!.innerHTML = '<article><div data-message-author-role="assistant" style="overflow:hidden;max-height:100px"><div class="markdown">完整回答</div></div><div id="actions" role="toolbar"><button data-testid="copy-turn-action-button">複製</button><span id="share-wrapper"><button data-testid="share-turn-action-button">分享</button></span><button>更多</button></div></article>';
    await vi.waitFor(() => expect(document.querySelector('#actions [data-ai-avatar-answer-download]')).not.toBeNull());
    expect(document.querySelector('[data-message-author-role] [data-ai-avatar-answer-download]')).toBeNull();
    expect(answerButtons()).toHaveLength(1); expect(answerButtons()[0].textContent).toBe('');
    expect(answerButtons()[0].querySelectorAll('svg')).toHaveLength(1);
    expect(answerButtons()[0].getAttribute('aria-label')).toBe('下載第 1 則回答');
    expect(answerButtons()[0].title).toContain('下載此回答');
    expect(document.querySelector('[data-ai-avatar-answer-download]')!.nextElementSibling?.id).toBe('share-wrapper');
    answerButtons()[0].click(); choose('markdown');
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('完整回答');
    document.getElementById('actions')!.outerHTML = '<div id="new-actions"><button aria-label="複製">複製</button><button aria-label="分享">分享</button><button>更多</button></div>';
    await vi.waitFor(() => expect(document.querySelector('#new-actions [data-ai-avatar-answer-download]')).not.toBeNull());
    expect(answerButtons()).toHaveLength(1);
    expect(document.querySelector('[data-ai-avatar-answer-download]')!.nextElementSibling?.getAttribute('aria-label')).toBe('分享');
  });
  it('uses native copy actions to restore a download when an answer has no role or Markdown markers', async () => {
    document.querySelector('main')!.innerHTML = '<div><div id="plain-answer"><p>第一段純文字回答</p><p>第二段內容</p></div><div role="toolbar"><button aria-label="複製">複製</button><button>更多</button></div></div>';
    await vi.waitFor(() => expect(answerButtons()).toHaveLength(1));
    expect(document.querySelector('[role="toolbar"] [data-ai-avatar-answer-download]')).not.toBeNull();
    answerButtons()[0].click(); choose('html');
    const result = vi.mocked(downloadText).mock.calls[0][0];
    expect(result).toContain('第一段純文字回答'); expect(result).toContain('第二段內容'); expect(result).not.toContain('更多');
  });
  it('keeps the fallback outside clipped message content when native actions are hidden', async () => {
    document.querySelector('main')!.innerHTML = '<article><div data-role="assistant" style="overflow:hidden;max-height:20px">回答內容</div><div role="toolbar" style="opacity:0"><button data-testid="copy-turn-action-button">複製</button></div></article>';
    await vi.waitFor(() => expect(answerButtons()).toHaveLength(1));
    const host = document.querySelector<HTMLElement>('[data-ai-avatar-answer-download]')!;
    expect(host.dataset.placement).toBe('below'); expect(host.previousElementSibling?.getAttribute('data-role')).toBe('assistant');
    expect(host.closest('[style*="overflow:hidden"],[role="toolbar"]')).toBeNull();
  });
  it('opens a format menu only on click and remembers the chosen format for later menus', async () => {
    actions.destroy();
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ conversationExportFormat: 'html' }), set } } });
    actions = new PageActions(TargetSite.CHATGPT);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(header().querySelector('select')).toBeNull();
    header().querySelector('button')!.click();
    expect(downloadText).not.toHaveBeenCalled();
    expect(document.getElementById('ai-avatar-page-menu')!.shadowRoot!.querySelector('[data-format=html]')!.getAttribute('aria-checked')).toBe('true');
    choose('html');
    await vi.waitFor(() => expect(downloadText).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadText).mock.calls[0][1]).toMatch(/\.html$/);
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('第一個問題');
    answerButtons()[0].click(); choose('markdown');
    expect(set).toHaveBeenCalledWith({ conversationExportFormat: 'markdown' });
    expect(vi.mocked(downloadText).mock.calls[1][1]).toMatch(/\.md$/);
  });
  it('keeps the outline outside the history sidebar when the native sidebar is replaced', async () => {
    document.querySelector('nav')!.remove();
    document.body.insertAdjacentHTML('afterbegin', '<nav><h2>最近項目</h2></nav>');
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(document.getElementById('ai-avatar-question-outline')!.parentElement).toBe(document.body);
    expect(document.querySelector('nav')!.textContent).toBe('最近項目');
    expect(document.querySelectorAll('#ai-avatar-question-outline')).toHaveLength(1);
  });
  it('does not move the history heading or trash when the independent outline is collapsed', async () => {
    const heading = document.querySelector<HTMLElement>('nav h2')!;
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(rect(20, 200, 80, 20));
    const range = document.createRange();
    vi.spyOn(range, 'getBoundingClientRect').mockImplementation(() => heading.getBoundingClientRect());
    vi.spyOn(document, 'createRange').mockReturnValue(range);
    window.dispatchEvent(new Event('resize'));
    const trash = document.getElementById('ai-avatar-date-delete')!;
    expect(trash.style.top).toBe('193px');
    const details = outline().querySelector('details')!; details.open = false; details.dispatchEvent(new Event('toggle'));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(trash.style.top).toBe('193px'); expect(heading.style.cssText).toBe('');
  });
  it('uses the conversation gutter beside the native sidebar on a wide screen', () => {
    actions.destroy(); resize(1800);
    const sidebar = document.querySelector<HTMLElement>('nav')!; const main = document.querySelector<HTMLElement>('main')!;
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 300, 900));
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(rect(300, 0, 1500, 900));
    document.querySelectorAll<HTMLElement>('article').forEach(element => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(750, 100, 800, 100)));
    const sidebarHtml = sidebar.innerHTML;
    actions = new PageActions(TargetSite.CHATGPT);
    const host = document.getElementById('ai-avatar-question-outline')!;
    expect(host.style.left).toBe('316px'); expect(host.style.width).toBe('280px');
    expect(host.parentElement).toBe(document.body); expect(main.style.cssText).toBe(''); expect(sidebar.innerHTML).toBe(sidebarHtml);
  });
  it('keeps the outline beside the visible sidebar as it collapses to an icon rail, hides and expands', async () => {
    actions.destroy(); resize(1800);
    const sidebar = document.querySelector<HTMLElement>('nav')!; const main = document.querySelector<HTMLElement>('main')!;
    let sidebarWidth = 300;
    vi.spyOn(sidebar, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, sidebarWidth, 900));
    vi.spyOn(main, 'getBoundingClientRect').mockImplementation(() => rect(sidebarWidth, 0, 1800 - sidebarWidth, 900));
    document.querySelectorAll<HTMLElement>('article').forEach(element => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(750, 100, 800, 100)));
    const sidebarHtml = sidebar.innerHTML;
    actions = new PageActions(TargetSite.CHATGPT);
    const host = document.getElementById('ai-avatar-question-outline')!;
    expect(host.style.left).toBe('316px');
    for (const width of [70, 0, 300]) {
      sidebarWidth = width;
      window.dispatchEvent(new Event('resize'));
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(host.style.left).toBe(`${width + 16}px`);
      expect(host.parentElement).toBe(document.body);
      expect(main.style.cssText).toBe(''); expect(sidebar.innerHTML).toBe(sidebarHtml);
    }
  });
  it('uses a collapsed overlay on a medium desktop without altering native layout during open, resize or cleanup', async () => {
    actions.destroy(); resize(1280);
    const sidebar = document.querySelector<HTMLElement>('nav')!; const main = document.querySelector<HTMLElement>('main')!;
    main.style.setProperty('padding-left', '20px', 'important'); main.style.marginLeft = '12px'; main.style.width = 'calc(100% - 12px)'; const original = main.style.cssText;
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 300, 900));
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(rect(300, 0, 980, 900));
    document.querySelectorAll<HTMLElement>('article').forEach(element => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(340, 100, 700, 100)));
    actions = new PageActions(TargetSite.CHATGPT);
    expect(document.getElementById('ai-avatar-question-outline')!.hasAttribute('data-compact')).toBe(true);
    const details = outline().querySelector('details')!; expect(details.open).toBe(false);
    expect(main.style.cssText).toBe(original);
    details.open = true; details.dispatchEvent(new Event('toggle'));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(main.style.cssText).toBe(original);
    resize(1800); window.dispatchEvent(new Event('resize')); await new Promise(resolve => requestAnimationFrame(resolve));
    expect(main.style.cssText).toBe(original);
    details.open = false; details.dispatchEvent(new Event('toggle')); await new Promise(resolve => requestAnimationFrame(resolve));
    expect(main.style.cssText).toBe(original);
    actions.destroy(); expect(main.style.cssText).toBe(original);
  });
  it('collapses into the conversation area on narrow screens and closes after jumping', async () => {
    actions.destroy(); resize(390, 680); actions = new PageActions(TargetSite.CHATGPT);
    const host = document.getElementById('ai-avatar-question-outline')!;
    expect(host.hasAttribute('data-compact')).toBe(true); expect(outline().querySelector('details')!.open).toBe(false);
    expect(document.querySelector<HTMLElement>('main')!.style.paddingLeft).toBe('');
    outline().querySelector('details')!.open = true;
    document.querySelector<HTMLElement>('article')!.scrollIntoView = vi.fn();
    outline().querySelector<HTMLButtonElement>('nav button')!.click();
    expect(outline().querySelector('details')!.open).toBe(false);
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  it('recognizes roles assigned after hydration instead of leaving a visible question count at zero', async () => {
    document.querySelector('main')!.innerHTML = '<div id="hydrated-question">請搜尋 Reddit 國外都建議怎麼命名</div>';
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(0));
    document.getElementById('hydrated-question')!.setAttribute('data-role', 'user');
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(1));
    expect(outline().querySelector('nav')!.textContent).toContain('請搜尋 Reddit');
  });
  it('keeps a new chat idle and shows the outline only after a question is sent', async () => {
    actions.destroy(); vi.useFakeTimers();
    try {
      window.location.href = 'https://chatgpt.com/';
      document.querySelector('main')!.innerHTML = '<h1>今天想聊些什麼？</h1><div contenteditable="true">尚未送出的問題</div>';
      actions = new PageActions(TargetSite.CHATGPT);
      expect(document.getElementById('ai-avatar-question-outline')).toBeNull();
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetch).not.toHaveBeenCalled();
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<article data-turn="user">第一個已送出的問題</article>');
      await vi.advanceTimersByTimeAsync(200);
      expect(outline().querySelector('nav')!.textContent).toContain('第一個已送出的問題');
      expect(outline().getElementById('retry')!.hidden).toBe(true);
      window.location.href = 'https://chatgpt.com/';
      document.querySelector('main')!.innerHTML = '<h1>另一個新對話</h1>';
      await vi.advanceTimersByTimeAsync(30000);
      expect(document.getElementById('ai-avatar-question-outline')).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('uses saved chat data to navigate questions when the page exposes no recognizable message roles', async () => {
    document.querySelector('main')!.outerHTML = '<div id="main"><div class="unknown-turn"><p>第一個問題</p></div><div class="unknown-turn"><p>第一則回答</p></div></div>';
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(1), { timeout: 3500 });
    expect(outline().querySelector('nav')!.textContent).toContain('第一個問題');
    const question = document.querySelector<HTMLElement>('#main .unknown-turn p')!; question.scrollIntoView = vi.fn();
    outline().querySelector<HTMLButtonElement>('nav button')!.click();
    expect(question.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(outline().getElementById('total')!.textContent).toBe('1');
    expect(outline().getElementById('empty')!.hidden).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not reread saved questions when an interactive answer changes repeatedly', async () => {
    actions.destroy(); vi.useFakeTimers();
    try {
      document.querySelector('main')!.innerHTML = '<section>第一個問題</section><section id="interactive-answer">模擬器：0</section>';
      actions = new PageActions(TargetSite.CHATGPT);
      await vi.advanceTimersByTimeAsync(1500);
      expect(fetch).toHaveBeenCalledTimes(2);
      for (let index = 1; index <= 3; index++) {
        document.getElementById('interactive-answer')!.textContent = `模擬器：${index}`;
        window.dispatchEvent(new Event('resize'));
        await vi.advanceTimersByTimeAsync(6000);
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { actions.destroy(); vi.useRealTimers(); }
  });
  it('rereads saved questions on composer submission and coalesces Enter, submit and click events', async () => {
    actions.destroy(); vi.useFakeTimers();
    try {
      document.querySelector('main')!.innerHTML = '<section>第一個問題</section><section>第一則回答</section>';
      document.body.insertAdjacentHTML('beforeend', '<form id="composer-form"><textarea id="prompt-textarea">新問題</textarea><button type="button" data-testid="send-button">送出</button></form><form id="answer-widget"><input></form>');
      actions = new PageActions(TargetSite.CHATGPT);
      await vi.advanceTimersByTimeAsync(1500);
      expect(fetch).toHaveBeenCalledTimes(2);
      const editor = document.getElementById('prompt-textarea')!;
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      document.getElementById('answer-widget')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetch).toHaveBeenCalledTimes(2);
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.getElementById('composer-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!.click();
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetch).toHaveBeenCalledTimes(4);
      // Sending the same text again is a separate question, even when the page
      // has no recognizable role attributes and its text has not changed yet.
      document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!.click();
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetch).toHaveBeenCalledTimes(6);
      actions.destroy();
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetch).toHaveBeenCalledTimes(6);
    } finally { actions.destroy(); vi.useRealTimers(); }
  });
  it('shows a recoverable read error and retries instead of silently remaining at zero questions', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));
    document.querySelector('main')!.innerHTML = '<div class="unknown-turn"><p>第一個問題</p></div>';
    await vi.waitFor(() => expect(outline().getElementById('empty')!.textContent).toContain('登入'), { timeout: 3500 });
    expect(outline().getElementById('total')!.hidden).toBe(true);
    vi.mocked(fetch).mockImplementation(original);
    outline().getElementById('retry')!.click();
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(1), { timeout: 3500 });
  });
  it('shows an image question with line breaks and resolves its location when the page finishes rendering', async () => {
    const text = 'AI都提供不好閱讀的圖表，怎麼跟它說要改可視覺化的\n\nprompt嗎？想要通用一點\n\n(圖表示手機版的';
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith('/api/auth/session') ? { accessToken: 'fixture-only' } : {
      conversation_id: 'questions', current_node: 'u', mapping: {
        u: { parent: null, message: { author: { role: 'user' }, content: { parts: [{ content_type: 'image_asset_pointer' }, text] } } },
      },
    })));
    document.querySelector('main')!.innerHTML = '<section>載入聊天中</section>';
    await vi.waitFor(() => expect(outline().querySelector<HTMLButtonElement>('nav button')?.disabled).toBe(true), { timeout: 3500 });
    expect(outline().getElementById('empty')!.hidden).toBe(true);
    expect(outline().textContent).not.toContain('尚未找到頁面位置');
    expect(outline().querySelector<HTMLButtonElement>('nav button')!.title).not.toContain('展開長訊息');
    expect(outline().querySelectorAll('nav button')).toHaveLength(1);
    expect(outline().querySelector<HTMLButtonElement>('nav button')!.disabled).toBe(true);
    expect(outline().querySelector('nav')!.textContent).toContain('AI都提供不好閱讀的圖表');
    document.querySelector('main')!.innerHTML = '<section><button>chart.png</button><img alt="圖表"><div id="question">AI都提供不好閱讀的圖表，怎麼跟它說要改可視覺化的<br><br>prompt嗎？想要通用一點<br><br>(圖表示手機版的<button>編輯</button></div></section>';
    await vi.waitFor(() => expect(outline().querySelector<HTMLButtonElement>('nav button')!.disabled).toBe(false));
    expect(outline().getElementById('empty')!.hidden).toBe(true);
    const question = document.getElementById('question')!; question.scrollIntoView = vi.fn();
    outline().querySelector<HTMLButtonElement>('nav button')!.click();
    expect(question.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('navigates a collapsed article question while preserving its collapsed state and the original conversation styles', async () => {
    const prefix = '請提供文章，整理成 markdown語法\n\n# Telegram Gemini 記帳機器人：Render 部署與架構優化指南';
    const text = `${prefix}\n\n${'文章其餘內容。'.repeat(100)}`;
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith('/api/auth/session') ? { accessToken: 'fixture-only' } : {
      conversation_id: 'questions', current_node: 'u', mapping: {
        u: { parent: null, message: { author: { role: 'user' }, content: { parts: [text] } } },
      },
    })));
    const main = document.querySelector<HTMLElement>('main')!;
    main.style.cssText = 'max-width: 800px; margin: auto; padding: 0 24px;';
    const original = main.style.cssText;
    main.innerHTML = `<section id="collapsed-question"><div id="question-preview">${prefix}<span>...</span></div><button aria-expanded="false">顯示較多</button></section><div class="markdown">回答</div>`;
    await vi.waitFor(() => expect(outline().querySelectorAll('nav button')).toHaveLength(1), { timeout: 3500 });
    const jump = outline().querySelector<HTMLButtonElement>('nav button')!;
    expect(jump.disabled).toBe(false); expect(jump.textContent).toContain('請提供文章');
    const question = document.getElementById('question-preview')!; question.scrollIntoView = vi.fn();
    jump.click(); expect(question.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(document.querySelector('#collapsed-question button')!.getAttribute('aria-expanded')).toBe('false');
    expect(main.style.cssText).toBe(original);
    expect(outline().getElementById('empty')!.hidden).toBe(true);
  });
});
