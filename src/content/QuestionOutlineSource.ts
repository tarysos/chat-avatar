import { getMessageElement, type ConversationMessage, type ConversationSnapshot } from './ConversationExport';

export interface OutlineQuestion { message: ConversationMessage; element: HTMLElement }
// Line breaks can be represented by BRs, blocks or CSS whitespace on the page.
// Match all actual characters, ignoring only whitespace and zero-width separators.
const normalize = (text: string): string => text.replace(/[\s\u200b\ufeff]+/g, '');
const questionText = (message: ConversationMessage): string => normalize(message.markdown.replace(/\[(?:圖片|附件|非文字內容)[^\]]*\]/g, ''));
const excluded = '[data-ai-avatar-ui],nav,aside,header,button,[role="button"],textarea,input,[contenteditable="true"],[role="textbox"],[hidden],[aria-hidden="true"],script,style,svg,.sr-only,[data-message-author],[data-message-author-role="assistant"],[data-turn="assistant"],[data-turn-role="assistant"],[data-role="assistant"],[data-testid="assistant-message"]';
const user = '[data-message-author-role="user"],[data-turn="user"],[data-turn-role="user"],[data-role="user"],.user-message-bubble-color,[data-testid="user-message"]';

/** Resolve saved questions to real page locations without relying on ChatGPT's class names. */
export function resolveOutlineQuestions(snapshot: ConversationSnapshot): OutlineQuestion[] {
  const questions = snapshot.messages.filter(message => message.role === 'user');
  const visibility = new Map<HTMLElement, boolean>();
  const visible = (element: HTMLElement): boolean => {
    const cached = visibility.get(element); if (cached !== undefined) return cached;
    const style = getComputedStyle(element);
    const result = !element.matches(excluded) && (!element.matches('.markdown') || !!element.closest(user))
      && style.display !== 'none' && style.visibility !== 'hidden'
      && (!element.parentElement || visible(element.parentElement));
    visibility.set(element, result); return result;
  };
  const textCache = new Map<Node, string>();
  const pageText = (node: Node): string => {
    const cached = textCache.get(node); if (cached !== undefined) return cached;
    // Ignore controls, hidden text and assistant subtrees even inside a candidate wrapper.
    const text = node.nodeType === Node.TEXT_NODE ? node.textContent || '' : node instanceof HTMLElement && visible(node)
      ? Array.from(node.childNodes).map(pageText).join('') : '';
    textCache.set(node, text); return text;
  };
  const roots = Array.from(document.querySelectorAll<HTMLElement>('main,[role="main"],#main,#thread,[data-testid="conversation"]')).filter(visible);
  const elements = Array.from(new Set((roots.length ? roots : [document.body]).flatMap(root =>
    Array.from(root.querySelectorAll<HTMLElement>('div,p,span,article,section,[data-message-id],[data-turn-id]'))
  ))).filter(element => visible(element) && (!element.closest('pre,code') || !!element.closest(user)));
  const byId = new Map<string, HTMLElement>(); const byText = new Map<string, HTMLElement[]>();
  const byPrefix = new Map<string, HTMLElement[]>();
  const keys = questions.map(questionText);
  const wanted = new Set(keys.filter(Boolean));
  const addMatch = (map: Map<string, HTMLElement[]>, key: string, element: HTMLElement): void => {
    const matches = map.get(key) || [];
    // Prefer the innermost matching text block, rather than a wrapper with the same text.
    if (matches.length && matches[matches.length - 1].contains(element)) matches[matches.length - 1] = element;
    else matches.push(element);
    map.set(key, matches);
  };
  for (const element of elements) {
    for (const id of [element.dataset.messageId, element.dataset.turnId, element.id]) if (id) byId.set(id, element);
    const text = normalize(pageText(element));
    if (wanted.has(text)) addMatch(byText, text, element);
    else {
      // Only the beginning is needed to anchor a collapsed question. Start with
      // a short prefix, then use more visible text if several questions share it.
      const prefix = text.replace(/(?:\.{3,}|…+)$/, '');
      if (prefix.length < 12) continue;
      let length = Math.min(24, prefix.length);
      let matching = keys.filter(key => key.startsWith(prefix.slice(0, length)));
      while (matching.length > 1 && length < prefix.length) {
        length = Math.min(length + 24, prefix.length);
        matching = matching.filter(key => key.startsWith(prefix.slice(0, length)));
      }
      if (matching.length === 1) addMatch(byPrefix, matching[0], element);
    }
  }
  const result: OutlineQuestion[] = []; const used = new Set<HTMLElement>();
  // Recent rendered messages match the end of a long conversation, including repeated questions.
  for (const message of [...questions].reverse()) {
    const key = questionText(message);
    const known = getMessageElement(message);
    let element = known?.isConnected ? known : byId.get(message.key);
    const available = (candidate: HTMLElement): boolean => !Array.from(used).some(previous => previous.contains(candidate) || candidate.contains(previous));
    if (!element || !available(element)) {
      const matches = byText.get(key);
      do { element = matches?.pop(); } while (element && !available(element));
      if (!element) {
        const prefixes = byPrefix.get(key);
        do { element = prefixes?.pop(); } while (element && !available(element));
      }
    }
    if (element && available(element)) { used.add(element); result.push({ message, element }); }
  }
  return result.reverse();
}
