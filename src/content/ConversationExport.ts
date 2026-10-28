import { TargetSite } from '@/common/types';
import { downloadText } from '@/common/download';
import { findAnswerToolbars } from './AnswerToolbar';

export interface ConversationMessage {
  key: string;
  role: 'user' | 'assistant';
  markdown: string;
  html: string;
  preview: string;
}

const messageElements = new WeakMap<ConversationMessage, HTMLElement>();
export function getMessageElement(message: ConversationMessage): HTMLElement | undefined { return messageElements.get(message); }

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** Export only semantic content; never copy scripts, handlers, styling or remote media. */
function safeHtml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
  if (!(node instanceof HTMLElement) || node.hasAttribute('data-ai-avatar-ui') || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
  const tag = node.tagName.toLowerCase();
  if (['script', 'style', 'button', 'svg', 'noscript', 'iframe', 'object', 'embed', 'input', 'textarea', 'select'].includes(tag)) return '';
  if (tag === 'img') return escapeHtml(`[圖片${node.getAttribute('alt') ? `：${node.getAttribute('alt')}` : ''}]`);
  const body = Array.from(node.childNodes).map(safeHtml).join('');
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    if (!/^(https?:|\/|#)/i.test(href)) return body;
    const url = new URL(href, location.href);
    return /^https?:$/.test(url.protocol) ? `<a href="${escapeHtml(url.href)}" rel="noreferrer noopener">${body}</a>` : body;
  }
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  if (!/^(p|div|section|h[1-6]|pre|code|strong|b|em|i|s|del|blockquote|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|caption|sup|sub)$/.test(tag)) return body;
  return `<${tag}>${body}</${tag}>`;
}

function markdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/[\t\n ]+/g, ' ');
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.tagName.toLowerCase();
  if (node.hasAttribute('data-ai-avatar-ui')) return '';
  if (['script', 'style', 'button', 'svg', 'noscript'].includes(tag) || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
  const body = (): string => Array.from(node.childNodes).map(markdown).join('');
  if (tag === 'pre') {
    const code = node.querySelector('code');
    const text = (code || node).textContent || '';
    const language = code?.className.match(/language-([\w+-]+)/)?.[1] || '';
    const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
    return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
  }
  if (tag === 'code') {
    const text = node.textContent || '';
    const fence = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
    return `${fence} ${text} ${fence}`;
  }
  if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${body().trim()}\n\n`;
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    if (!/^(https?:|\/|#)/i.test(href)) return body();
    return `[${body().trim()}](<${new URL(href, location.href).href.replace(/>/g, '%3E')}>)`;
  }
  if (tag === 'img') return node.getAttribute('alt') ? `[圖片：${node.getAttribute('alt')}]` : '[圖片]';
  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') return `**${body()}**`;
  if (tag === 'em' || tag === 'i') return `*${body()}*`;
  if (tag === 'blockquote') return `\n\n${body().trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
  if (tag === 'li') return `\n${node.parentElement?.tagName === 'OL' ? `${Array.from(node.parentElement.children).indexOf(node) + 1}.` : '-'} ${body().trim()}`;
  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('th,td')).map(cell => markdown(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')));
    if (!rows.length) return '';
    return `\n\n| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n')}\n\n`;
  }
  if (['p', 'div', 'section', 'ul', 'ol'].includes(tag)) return `\n\n${body().trim()}\n\n`;
  return body();
}

function messageRole(element: HTMLElement): ConversationMessage['role'] | null {
  const explicit = element.getAttribute('data-message-author-role') || element.getAttribute('data-turn-role') || element.getAttribute('data-turn') || element.getAttribute('data-role');
  if (explicit === 'user' || explicit === 'assistant') return explicit;
  const labels = [element.getAttribute('aria-label') || '', ...Array.from(element.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,[data-message-author],.sr-only')).filter(node => !node.closest('.markdown,.message-content,[data-message-content],pre,code')).map(node => node.textContent || '')];
  for (const label of labels) {
    const text = label.replace(/\s/g, '').trim();
    if (/^(?:Yousaid|You|你說了?|你说了?|您說了?|您说了?|使用者|用戶|用户)[:：]?$/i.test(text)) return 'user';
    if (/^(?:ChatGPT(?:said|說了?|说了?|回答)?|Assistant|助理|助手)[:：]?$/i.test(text)) return 'assistant';
  }
  if (element.matches('.user-message-bubble-color,[data-testid="user-message"]') || element.querySelector('.user-message-bubble-color,[data-testid="user-message"]')) return 'user';
  if (element.querySelector('.markdown,[data-testid="assistant-message"]')) return 'assistant';
  return null;
}

export function collectMessages(site: TargetSite): ConversationMessage[] {
  const selector = site === TargetSite.CHATGPT
    ? '[data-message-author-role="user"], [data-message-author-role="assistant"], [data-turn="user"], [data-turn="assistant"], [data-turn-role="user"], [data-turn-role="assistant"], [data-role="user"], [data-role="assistant"], [data-testid^="conversation-turn-"], [data-testid="conversation-turn"], .user-message-bubble-color, [data-testid="user-message"], main article, [role="main"] article'
    : '.user-query, .model-response-text';
  const visibility = new Map<HTMLElement, boolean>();
  const visible = (element: HTMLElement): boolean => {
    const cached = visibility.get(element); if (cached !== undefined) return cached;
    const style = getComputedStyle(element);
    const result = !element.matches('#ai-avatar-overlay,[data-ai-avatar-ui],nav,aside,[contenteditable="true"],[role="textbox"],textarea,#composer-background,[data-testid="composer"],[hidden],[aria-hidden="true"]')
      && style.display !== 'none' && style.visibility !== 'hidden' && (!element.parentElement || visible(element.parentElement));
    visibility.set(element, result); return result;
  };
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap(element => {
    if (!visible(element)) return [];
    const role = site === TargetSite.GEMINI ? (element.matches('.user-query') ? 'user' : 'assistant') : messageRole(element);
    return role ? [{ element, role }] : [];
  });
  if (site === TargetSite.CHATGPT) {
    const user = '[data-message-author-role="user"],[data-turn-role="user"],[data-turn="user"],[data-role="user"],.user-message-bubble-color,[data-testid="user-message"]';
    const fallback = new Set<HTMLElement>();
    for (const block of Array.from(document.querySelectorAll<HTMLElement>('.markdown,[data-testid="assistant-message"]'))) {
      if (!visible(block) || !block.closest('main,[role="main"],#main,#thread,[data-testid="conversation"]') || block.closest(user)) continue;
      if (candidates.some(candidate => candidate.element.contains(block))) continue;
      if (block.parentElement?.closest('.markdown,[data-testid="assistant-message"]')) continue;
      // Some layouts expose only the answer body. Keep sibling Markdown blocks
      // in the same message together, and preserve native wrappers when present.
      const boundary = block.closest<HTMLElement>('[data-message-id],[data-turn-id],[data-testid="assistant-message"],article,section') || block;
      const containsOtherMessage = !!boundary.querySelector(user) || candidates.some(candidate => boundary.contains(candidate.element));
      const element = containsOtherMessage ? block : boundary;
      if (visible(element)) fallback.add(element);
    }
    for (const { content } of findAnswerToolbars()) {
      if (!visible(content) || candidates.some(candidate => candidate.element.contains(content) || content.contains(candidate.element))) continue;
      if (Array.from(fallback).some(element => element.contains(content) || content.contains(element))) continue;
      fallback.add(content);
    }
    fallback.forEach(element => candidates.push({ element, role: 'assistant' }));
    candidates.sort((a, b) => a.element === b.element ? 0 : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  const parsed = candidates.flatMap(({ element, role }, index) => {
    const blocks = Array.from(element.querySelectorAll<HTMLElement>('.markdown,.message-content,.query-text,[data-message-content],.user-message-bubble-color')).filter(node => !node.parentElement?.closest('.markdown,.message-content,.query-text,[data-message-content],.user-message-bubble-color'));
    const content = document.createElement('div');
    if (blocks.length) blocks.forEach(block => content.append(block.cloneNode(true)));
    else {
      content.append(element.cloneNode(true));
      content.querySelectorAll('h1.sr-only,h2.sr-only,h3.sr-only,h4.sr-only,h5.sr-only,h6.sr-only,[data-message-author]').forEach(node => node.remove());
    }
    content.querySelectorAll('[data-ai-avatar-ui]').forEach(node => node.remove());
    const text = markdown(content).replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return [];
    const id = element.getAttribute('data-message-id');
    // Include text in fallback keys so a stale selection cannot export a different answer after navigation.
    const key = id || `${location.pathname}:${index}:${text}`;
    const message: ConversationMessage = { key, role, markdown: text, html: safeHtml(content), preview: (content.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
    messageElements.set(message, element);
    return [message];
  });
  // Empty nested placeholders must not suppress a valid outer message.
  return parsed.filter(message => {
    const element = getMessageElement(message)!;
    return !parsed.some(other => other !== message && element.contains(getMessageElement(other)!));
  });
}

export interface ConversationSnapshot { title: string; url: string; messages: ConversationMessage[]; source?: 'page' | 'conversation'; scope?: 'full' }
export type ExportFormat = 'markdown' | 'html' | 'pdf';

export function captureConversation(site: TargetSite): ConversationSnapshot {
  return { title: document.title.replace(/\s*[-–|]\s*(ChatGPT|Gemini).*$/i, '').trim() || 'AI 對話', url: location.href, messages: collectMessages(site) };
}

export function renderConversationHtml(snapshot: ConversationSnapshot): string {
  const { title, url, messages } = snapshot;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:40px auto;padding:0 24px;max-width:850px;color:#242424;background:#fff;font:15px/1.75 system-ui,"Microsoft JhengHei",sans-serif;overflow-wrap:anywhere}h1{font-size:26px;line-height:1.4}h2{font-size:19px}h3{font-size:17px}header{margin-bottom:32px}header p{color:#555;font-size:12px}section{margin:28px 0;padding-top:12px;border-top:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f4f4f4;font:12px/1.6 Consolas,monospace}code{font-family:Consolas,monospace}table{border-collapse:collapse;max-width:100%;table-layout:fixed}td,th{border:1px solid #bbb;padding:7px 10px;overflow-wrap:anywhere}blockquote{margin-left:0;padding-left:16px;border-left:1px solid #aaa;color:#555}a{color:#155f91;text-decoration:underline}h1,h2,h3,h4{break-after:avoid}tr{break-inside:avoid}@page{size:A4;margin:16mm}@media print{body{margin:0;padding:0;max-width:none}pre{border:1px solid #ddd}a{color:inherit}}
  </style></head><body><header><h1>${escapeHtml(title)}</h1><p>來源：${escapeHtml(url)}<br>匯出範圍：${exportScope(snapshot)}</p></header>${messages.map(message => `<section><h2>${message.role === 'user' ? '使用者' : 'AI 回答'}</h2>${message.html}</section>`).join('')}</body></html>`;
}

function exportScope(snapshot: ConversationSnapshot): string {
  return `${snapshot.messages.length} 則${snapshot.scope === 'full' ? '訊息（目前聊天完整分支）' : '已載入訊息'}`;
}

export function exportSnapshot(snapshot: ConversationSnapshot, format: ExportFormat, suffix = '對話', reservedPrintWindow?: Window): void {
  const { title, url, messages } = snapshot;
  if (!messages.length) throw new Error('請至少勾選一則訊息。');
  // Control characters are invalid in downloadable filenames.
  // eslint-disable-next-line no-control-regex
  const filename = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70)}-${suffix}`;
  if (format === 'markdown') {
    const body = messages.map(message => `## ${message.role === 'user' ? '使用者' : 'AI 回答'}\n\n${message.markdown}`).join('\n\n---\n\n');
    downloadText(`# ${title}\n\n來源：${url}\n\n匯出範圍：${exportScope(snapshot)}\n\n${body}\n`, `${filename}.md`);
  } else if (format === 'html') downloadText(renderConversationHtml(snapshot), `${filename}.html`, 'text/html;charset=utf-8');
  else {
    // Open synchronously from the format button so popup blockers can report a recoverable error.
    const printWindow = reservedPrintWindow || window.open('', '_blank', 'popup,width=960,height=800');
    if (!printWindow) throw new Error('列印視窗被封鎖，請允許此網站開啟彈出式視窗後重試，或改用 HTML。');
    printWindow.opener = null;
    printWindow.document.open(); printWindow.document.write(renderConversationHtml(snapshot)); printWindow.document.close();
    // Native printing keeps local CJK fonts and paginates selectable text, code and tables.
    void Promise.resolve(printWindow.document.fonts?.ready).then(() => {
      if (!printWindow.closed) { printWindow.focus(); printWindow.print(); }
    });
  }
}
