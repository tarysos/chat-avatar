import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMessages, captureConversation, exportSnapshot } from '@/content/ConversationExport';
import { TargetSite } from '@/common/types';
import { downloadText } from '@/common/download';

vi.mock('@/common/download', () => ({ downloadText: vi.fn() }));
describe('conversation export', () => {
  beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); document.title = '測試對話 - ChatGPT'; });
  it('exports roles, paragraphs, code fences, links and tables without UI button labels', () => {
    document.body.innerHTML = `<div data-message-author-role="user">請給範例</div>
      <div data-message-author-role="assistant" data-message-id="one"><div class="markdown"><p>第一段</p><p><strong>重點</strong></p><pre><code class="language-ts">const value = 1;\nconsole.log(value);</code></pre><a href="https://example.com">來源</a><table><tr><th>欄位</th></tr><tr><td>內容</td></tr></table><button>複製</button></div></div>`;
    exportSnapshot(captureConversation(TargetSite.CHATGPT), 'markdown');
    const [result, filename] = vi.mocked(downloadText).mock.calls[0];
    expect(result).toContain('## 使用者'); expect(result).toContain('## AI 回答');
    expect(result).toContain('第一段\n\n**重點**');
    expect(result).toContain('```ts\nconst value = 1;\nconsole.log(value);\n```');
    expect(result).toContain('[來源](<https://example.com/>)');
    expect(result).toContain('| 欄位 |\n| --- |\n| 內容 |');
    expect(result).not.toContain('複製'); expect(filename).toBe('測試對話-對話.md');
  });
  it('collects Gemini user and model turns and uses a longer fence for embedded backticks', () => {
    document.body.innerHTML = '<div class="user-query"><div class="query-text">問題</div></div><div class="model-response-text"><div class="message-content"><pre><code>```nested```</code></pre></div></div>';
    const turns = collectMessages(TargetSite.GEMINI);
    expect(turns.map(turn => turn.role)).toEqual(['user', 'assistant']);
    expect(turns[1].markdown).toContain('````\n```nested```\n````');
  });
  it('recognizes article-based ChatGPT turns without duplicating nested messages', () => {
    document.body.innerHTML = '<article data-turn="user" data-testid="conversation-turn-1"><div data-message-author-role="user">問題</div></article><article data-turn="assistant" data-testid="conversation-turn-2"><div class="markdown">新格式回答</div><span data-ai-avatar-ui>不應匯出的按鈕</span></article>';
    const messages = collectMessages(TargetSite.CHATGPT);
    expect(messages.map(item => item.role)).toEqual(['user', 'assistant']);
    expect(messages[1].markdown).toBe('新格式回答');
  });
  it('recognizes translated role headings at any heading level and preserves multiple answer blocks', () => {
    document.body.innerHTML = '<main><section data-testid="conversation-turn-0"><h2 class="sr-only">你說了：</h2><div class="user-message-bubble-color">測試問題</div></section><section data-testid="conversation-turn-1"><h3 class="sr-only">ChatGPT說：</h3><div class="markdown"><p>回答第一段</p></div><div class="markdown"><p>回答第二段</p></div></section><section hidden data-testid="conversation-turn-2"><h4>You said:</h4>隱藏的舊內容</section></main>';
    const messages = collectMessages(TargetSite.CHATGPT);
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0].markdown).toBe('測試問題');
    expect(messages[1].markdown).toBe('回答第一段\n\n回答第二段');
    expect(messages[1].html).not.toContain('ChatGPT說');
  });
  it('recognizes role markers on sections and avoids exporting surrounding UI or duplicate wrappers', () => {
    document.body.innerHTML = '<nav><section data-turn-role="assistant">側邊欄</section></nav><main><article data-testid="conversation-turn-0"><section data-turn-role="user">問題</section></article><article data-testid="conversation-turn-1"><section data-turn-role="assistant"><div class="markdown">回答</div></section></article></main>';
    expect(collectMessages(TargetSite.CHATGPT).map(message => message.markdown)).toEqual(['問題', '回答']);
  });
  it('recognizes standalone user bubbles and exact conversation-turn markers without duplicating nested questions', () => {
    document.body.innerHTML = '<nav><div class="user-message-bubble-color">歷史側邊欄</div></nav><main><div class="user-message-bubble-color">請搜尋 Reddit 國外都建議怎麼命名</div><section data-testid="conversation-turn"><div data-testid="user-message">第二個提問</div></section><section data-testid="conversation-turn" aria-label="ChatGPT said:"><div class="markdown">回答內容</div></section></main>';
    const messages = collectMessages(TargetSite.CHATGPT);
    expect(messages.map(message => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(messages[0].markdown).toBe('請搜尋 Reddit 國外都建議怎麼命名');
    expect(messages[1].markdown).toBe('第二個提問');
    expect(messages).toHaveLength(3);
  });
  it('does not discard a real question because it contains an empty nested placeholder or lives in a form', () => {
    document.body.innerHTML = '<main><form><article data-turn="user">真實提問<div data-testid="user-message"></div></article><div contenteditable="true"><article data-turn="user">尚未送出的輸入</article></div></form></main>';
    const messages = collectMessages(TargetSite.CHATGPT);
    expect(messages).toHaveLength(1); expect(messages[0].markdown).toBe('真實提問');
  });
  it('collects standalone answer content when ChatGPT omits role and turn attributes', () => {
    document.body.innerHTML = '<nav><div class="markdown">側邊欄</div></nav><main><div data-role="user"><div class="markdown">第一個問題</div></div><div class="markdown">第一則回答</div><div data-role="user">第二個問題</div><div data-testid="assistant-message">第二則回答</div></main>';
    expect(collectMessages(TargetSite.CHATGPT).map(message => [message.role, message.markdown])).toEqual([
      ['user', '第一個問題'], ['assistant', '第一則回答'], ['user', '第二個問題'], ['assistant', '第二則回答'],
    ]);
  });
  it('keeps multiple answer blocks together and skips nested Markdown, hidden answers and composer previews', () => {
    document.body.innerHTML = '<div id="main"><section data-message-id="answer"><div class="markdown">第一段<div class="markdown">巢狀內容</div></div><div class="markdown">第二段</div></section><div style="display:none"><div class="markdown">隱藏的回答</div></div><div contenteditable="true"><div class="markdown">輸入預覽</div></div></div>';
    const messages = collectMessages(TargetSite.CHATGPT);
    expect(messages).toHaveLength(1); expect(messages[0].key).toBe('answer');
    expect(messages[0].markdown).toContain('第一段'); expect(messages[0].markdown).toContain('巢狀內容'); expect(messages[0].markdown).toContain('第二段');
  });
  it('does not infer answers from code-copy controls or hidden toolbar remnants', () => {
    document.body.innerHTML = '<main><pre><code>範例</code><button aria-label="Copy">複製程式碼</button></pre><div><p>隱藏版面的文字</p><div role="toolbar" style="display:none"><button data-testid="copy-turn-action-button">複製</button></div></div></main>';
    expect(collectMessages(TargetSite.CHATGPT)).toHaveLength(0);
  });
});
