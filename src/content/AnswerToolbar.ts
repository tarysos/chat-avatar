const roots = 'main,[role="main"],#main,#thread,[data-testid="conversation"]';
const user = '[data-message-author-role="user"],[data-turn="user"],[data-turn-role="user"],[data-role="user"],.user-message-bubble-color,[data-testid="user-message"]';
const copyButtons = 'button[data-testid="copy-turn-action-button"],button[aria-label="Copy"],button[aria-label="Copy response"],button[aria-label="複製"],button[aria-label="复制"],button[aria-label="複製回覆"],button[aria-label="複製回答"]';
const excluded = `[data-ai-avatar-ui],nav,aside,header,pre,code,[contenteditable="true"],[role="textbox"],[hidden],[aria-hidden="true"],${user}`;

export interface AnswerToolbar { content: HTMLElement; toolbar: HTMLElement }

/** Native answer actions also identify replies in layouts without role/Markdown markers. */
export function findAnswerToolbars(): AnswerToolbar[] {
  const result: AnswerToolbar[] = []; const used = new Set<HTMLElement>();
  const rendered = (element: HTMLElement): boolean => {
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  for (const button of Array.from(document.querySelectorAll<HTMLElement>(copyButtons))) {
    if (button.closest(excluded) || !button.closest(roots)) continue;
    const toolbar = button.closest<HTMLElement>('[role="toolbar"]') || button.parentElement?.closest('div') || button.parentElement;
    if (!toolbar || toolbar.matches(roots) || used.has(toolbar) || !rendered(toolbar)) continue;
    let branch: HTMLElement | null = toolbar; let content: HTMLElement | null = null;
    // The action row may sit inside one or more footer wrappers after the body.
    for (let depth = 0; branch && !branch.matches(roots) && depth < 6 && !content; depth++, branch = branch.parentElement) {
      for (let previous = branch.previousElementSibling as HTMLElement | null; previous; previous = previous.previousElementSibling as HTMLElement | null) {
        if (previous.matches('script,style,button,[data-ai-avatar-ui],[hidden],[aria-hidden="true"]') || !previous.textContent?.trim() || !rendered(previous)) continue;
        if (previous.closest(user) || previous.querySelector(`${user},${copyButtons}`)) break;
        content = previous; break;
      }
    }
    if (content) { result.push({ content, toolbar }); used.add(toolbar); }
  }
  return result;
}
