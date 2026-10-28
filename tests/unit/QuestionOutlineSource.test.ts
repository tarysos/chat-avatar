import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOutlineQuestions } from '@/content/QuestionOutlineSource';
import type { ConversationSnapshot } from '@/content/ConversationExport';

const snapshot = (...questions: string[]): ConversationSnapshot => ({ title: '測試', url: location.href, source: 'conversation', messages: questions.map((text, index) => ({ key: `q${index}`, role: 'user', markdown: text, html: `<p>${text}</p>`, preview: text })) });
describe('saved-question page locations', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });
  it('locates questions in an otherwise unrecognized conversation by their text', () => {
    document.body.innerHTML = '<main><div class="new-layout"><p>請搜尋 Reddit 國外都建議怎麼命名</p></div><div class="new-layout"><p>第二個問題</p></div></main>';
    const result = resolveOutlineQuestions(snapshot('尚未載入的舊提問', '請搜尋 Reddit 國外都建議怎麼命名', '第二個問題'));
    expect(result.map(item => item.message.preview)).toEqual(['請搜尋 Reddit 國外都建議怎麼命名', '第二個問題']);
    expect(result[0].element.tagName).toBe('P');
  });
  it('prefers stable message IDs and skips assistant quotations, hidden messages and the composer', () => {
    document.body.innerHTML = '<main><div class="markdown"><p>重複提問</p></div><div hidden><p>重複提問</p></div><div data-message-id="q0">原始提問<img alt="圖片"></div><div contenteditable="true"><p>重複提問</p></div><div role="textbox"><p>重複提問</p></div></main>';
    const result = resolveOutlineQuestions(snapshot('原始提問 [圖片]', '重複提問'));
    expect(result).toHaveLength(1); expect(result[0].element.dataset.messageId).toBe('q0');
  });
  it('maps the newest repeated questions to the visible end of a conversation only once', () => {
    document.body.innerHTML = '<main><div><p>好</p></div><div><p>好</p></div></main>';
    const result = resolveOutlineQuestions(snapshot('好', '好', '好'));
    expect(result.map(item => item.message.key)).toEqual(['q1', 'q2']);
    expect(new Set(result.map(item => item.element)).size).toBe(2);
  });
  it('locates a multiline question beside an image without counting attachment controls or hidden labels', () => {
    const text = 'AI都提供不好閱讀的圖表，怎麼跟它說要改可視覺化的\n\nprompt嗎？想要通用一點\n\n(圖表示手機版的';
    document.body.innerHTML = '<main><section><button>chart.png</button><img alt="圖表"><div id="question">AI都提供不好閱讀的圖表，怎麼跟它說要改可視覺化的<br><br>prompt嗎？想要通用一點<br><br>(圖表示手機版的<span hidden>複製</span><button>編輯訊息</button></div></section><div class="markdown">回答</div></main>';
    const result = resolveOutlineQuestions(snapshot(`[圖片]\n\n${text}\n\n[附件：chart.png]`));
    expect(result).toHaveLength(1);
    expect(result[0].element.id).toBe('question');
  });
  it('preserves inline text while matching paragraph breaks and CSS whitespace', () => {
    document.body.innerHTML = '<main><section id="question"><p>請用 <strong>可讀的圖表</strong></p><p>展示數據</p></section></main>';
    const result = resolveOutlineQuestions(snapshot('請用 可讀的圖表\n\n展示數據'));
    expect(result).toHaveLength(1); expect(result[0].element.id).toBe('question');
    document.querySelector('main')!.innerHTML = '<div id="question">第一行\u200b<br>第二行</div>';
    expect(resolveOutlineQuestions(snapshot('第一行\n第二行'))[0]?.element.id).toBe('question');
  });
  it('searches visible conversation roots when an earlier main is hidden', () => {
    document.body.innerHTML = '<main hidden><p>尚未顯示</p></main><div role="main"><p id="question">目前的提問</p></div>';
    expect(resolveOutlineQuestions(snapshot('目前的提問'))[0]?.element.id).toBe('question');
  });
  it('allows Markdown inside a user message while rejecting assistant quotations in every role variant', () => {
    document.body.innerHTML = '<main><div data-role="user"><div class="markdown" data-message-id="q0">使用者提問</div></div><div data-role="assistant"><p>引述提問</p></div></main>';
    const result = resolveOutlineQuestions(snapshot('使用者提問', '引述提問'));
    expect(result).toHaveLength(1); expect(result[0].element.dataset.messageId).toBe('q0');
  });
  it('does not mistake a wrapper containing an assistant quotation for a question', () => {
    document.body.innerHTML = '<main><section><div data-role="assistant"><p>只有回答引述的提問</p></div></section></main>';
    expect(resolveOutlineQuestions(snapshot('只有回答引述的提問'))).toHaveLength(0);
  });
  it('locates a collapsed long question by its unique visible prefix without expanding it', () => {
    const prefix = '請提供文章，整理成 markdown語法\n\n# Telegram Gemini 記帳機器人：Render 部署與架構優化指南';
    document.body.innerHTML = `<main><section id="collapsed"><div>${prefix}<span>…</span></div><button aria-expanded="false">顯示較多</button></section><div class="markdown">回答</div></main>`;
    const result = resolveOutlineQuestions(snapshot(`${prefix}\n\n${'其餘尚未顯示的長文章。'.repeat(80)}`));
    expect(result).toHaveLength(1); expect(result[0].element.textContent).toContain(prefix);
    expect(document.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });
  it('ignores role-button expand labels when a collapsed question keeps its entire text in the DOM', () => {
    const text = '請整理以下技術文章，並保留部署步驟與設定細節。'.repeat(5);
    document.body.innerHTML = `<main><section id="collapsed">${text}<div role="button">Show more</div></section></main>`;
    expect(resolveOutlineQuestions(snapshot(text))[0]?.element.id).toBe('collapsed');
  });
  it('does not use an arbitrary short fragment or an ambiguous collapsed prefix as a question location', () => {
    document.body.innerHTML = '<main><section>請整理<button>顯示較多</button></section></main>';
    expect(resolveOutlineQuestions(snapshot('請整理這篇文章與相關內容'))).toHaveLength(0);
    const prefix = '請將這篇文章整理成 Markdown 並保留所有重要的技術步驟與注意事項。';
    document.querySelector('section')!.firstChild!.textContent = `${prefix}…`;
    expect(resolveOutlineQuestions(snapshot(`${prefix}版本一`, `${prefix}版本二`))).toHaveLength(0);
    document.body.innerHTML = `<main><p>${prefix}</p></main>`;
    expect(resolveOutlineQuestions(snapshot(`${prefix}其餘文章`))).toHaveLength(1);
  });
  it('uses the beginning of a question without requiring its full text or an expand button', () => {
    const prefix = '請提供文章，整理成 markdown 語法';
    document.body.innerHTML = `<main><p id="preview">${prefix}…</p><div class="markdown">${prefix}</div></main>`;
    expect(resolveOutlineQuestions(snapshot(`${prefix}\n\n${'後續內容'.repeat(100)}`))[0]?.element.id).toBe('preview');
    document.querySelector('p')!.textContent = '後續內容'.repeat(10);
    expect(resolveOutlineQuestions(snapshot(`${prefix}\n\n${'後續內容'.repeat(100)}`))).toHaveLength(0);
  });
  it('compares more visible characters when questions share their first words', () => {
    const common = '請將這篇文章整理成 Markdown，保留部署步驟與注意事項，再整理';
    const first = `${common}第一種方案`; const second = `${common}第二種方案`;
    document.body.innerHTML = `<main><p id="first">${first}…</p><p id="second">${second}…</p></main>`;
    const result = resolveOutlineQuestions(snapshot(`${first}更多內容`, `${second}更多內容`));
    expect(result.map(item => item.element.id)).toEqual(['first', 'second']);
  });
});
