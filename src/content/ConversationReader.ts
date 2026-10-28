import { escapeHtml, type ConversationMessage, type ConversationSnapshot } from './ConversationExport';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

/** A safe readable HTML fallback for stored Markdown; no raw HTML is executed. */
function storedHtml(text: string): string {
  const lines = text.split('\n'); const output: string[] = [];
  let fence = ''; let code: string[] = [];
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length))) {
      if (fence) { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; fence = ''; }
      else fence = marker[1];
    } else if (fence) code.push(line);
    else {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      output.push(heading ? `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>` : line ? `<p>${escapeHtml(line)}</p>` : '');
    }
  }
  if (fence) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return output.join('\n');
}

/** Follow only the currently selected branch, excluding tools, system and hidden reasoning. */
export function parseConversation(data: unknown, id: string, url: string, questionsOnly = false): ConversationSnapshot {
  const payload = object(data);
  if ((payload.conversation_id || payload.id) && (payload.conversation_id || payload.id) !== id) throw new Error('回傳的聊天與目前頁面不同，請重新開啟匯出。');
  const mapping = object(payload.mapping);
  let current = typeof payload.current_node === 'string' ? payload.current_node : '';
  if (!current || !mapping[current]) throw new Error('ChatGPT 對話資料格式已變更，無法辨識目前分支。');
  const visited = new Set<string>(); const messages: ConversationMessage[] = [];
  while (current) {
    if (visited.has(current) || !mapping[current]) throw new Error('對話分支資料不完整，請重新讀取。');
    visited.add(current);
    const node = object(mapping[current]); const message = object(node.message);
    const role = object(message.author).role;
    if ((role === 'user' || (role === 'assistant' && !questionsOnly)) && !object(message.metadata).is_visually_hidden_from_conversation && (!message.channel || message.channel === 'final') && (!message.recipient || message.recipient === 'all')) {
      if (message.status === 'in_progress') throw new Error('回答仍在產生，請等完成後再下載完整對話。');
      const content = object(message.content);
      const parts = Array.isArray(content.parts) ? content.parts : typeof content.text === 'string' ? [content.text] : [];
      const attachments = object(message.metadata).attachments;
      const files = Array.isArray(attachments) ? attachments.map(file => `[附件${typeof object(file).name === 'string' ? `：${object(file).name}` : ''}]`) : [];
      const text = [...parts.map(part => typeof part === 'string' ? part : typeof object(part).text === 'string' ? object(part).text as string : object(part).content_type === 'image_asset_pointer' ? '[圖片]' : '[非文字內容]'), ...files].filter(Boolean).join('\n\n').trim();
      if (text) messages.push({ key: typeof message.id === 'string' ? message.id : current, role, markdown: text, html: storedHtml(text), preview: text.replace(/\s+/g, ' ').slice(0, 120) });
    }
    if (node.parent !== null && (typeof node.parent !== 'string' || !node.parent)) throw new Error('對話分支資料不完整，請重新讀取。');
    current = typeof node.parent === 'string' ? node.parent : '';
  }
  if (!messages.length) throw new Error(questionsOnly ? '目前聊天尚無提問。' : '目前聊天尚無可匯出的文字訊息。');
  return { title: typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'AI 對話', url, source: 'conversation', messages: messages.reverse() };
}

/** Read this chat's entire selected branch through the existing website session. */
export async function readCurrentConversation(url: string, signal: AbortSignal, request: typeof fetch = (...args) => fetch(...args), questionsOnly = false): Promise<ConversationSnapshot> {
  const page = new URL(url); const id = page.pathname.match(/\/c\/([\w-]{1,128})\/?$/)?.[1];
  if (page.origin !== location.origin || !id) throw new Error('此頁沒有已儲存的聊天識別碼，請等訊息載入後重試。');
  const get = async (path: string, token?: string): Promise<unknown> => {
    const response = await request(new URL(path, page.origin).href, { method: 'GET', credentials: 'include', cache: 'no-store', signal, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
    if (signal.aborted) throw new Error('已停止讀取。');
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '登入狀態已過期或無權讀取，請重新登入 ChatGPT 後重試。' : `ChatGPT 無法讀取這個聊天（${response.status}），請稍後重新讀取。`);
    try { return await response.json(); } catch { throw new Error('ChatGPT 回應格式無法辨識，請重新讀取。'); }
  };
  const session = object(await get('/api/auth/session'));
  if (typeof session.accessToken !== 'string' || !session.accessToken) throw new Error('無法讀取登入狀態，請重新登入 ChatGPT 後重試。');
  const data = await get(`/backend-api/conversation/${encodeURIComponent(id)}`, session.accessToken);
  if (url !== location.href || signal.aborted) throw new Error('聊天已切換或讀取已停止，請重新開啟匯出。');
  return parseConversation(data, id, url, questionsOnly);
}

/** Outline data can be read while a public answer is still streaming. */
export function readCurrentQuestions(url: string, signal: AbortSignal): Promise<ConversationSnapshot> {
  return readCurrentConversation(url, signal, undefined, true);
}
