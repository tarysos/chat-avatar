import { actionStyles, applyTheme, exportIcon } from '@/common/actionUi';
import { getMessageElement, type ConversationSnapshot } from './ConversationExport';
import { readCurrentQuestions } from './ConversationReader';
import { resolveOutlineQuestions } from './QuestionOutlineSource';
import { findAnswerToolbars } from './AnswerToolbar';

interface AnswerAction { host: HTMLElement; button: HTMLButtonElement }

/** A Word-style outline beside the conversation and a download action under each answer. */
export class ConversationPageTools {
  private host: HTMLElement;
  private root: ShadowRoot;
  private details: HTMLDetailsElement;
  private questions: { element: HTMLElement | null; button: HTMLButtonElement }[] = [];
  private answers = new Map<HTMLElement, AnswerAction>();
  private signature = '';
  private frame = 0;
  private needsLayout = false;
  private compact: boolean | null = null;
  private main: HTMLElement | null = null;
  private sidebar: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private observed: Element[] = [];
  private latestSnapshot: ConversationSnapshot | null = null;
  private sourceUrl = '';
  private source: ConversationSnapshot | null = null;
  private sourceController: AbortController | null = null;
  private sourceTimer: ReturnType<typeof setTimeout> | null = null;
  private sourceReadAt = 0;
  private sourceRevision = 0;
  private sourceReadRevision = -1;
  private sourceError = '';
  private scheduledRevision = -1;
  private schedule = (layout: boolean): void => {
    if (layout) this.needsLayout = true;
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.needsLayout) { this.needsLayout = false; this.updateLayout(); }
      this.updateCurrent();
    });
  };
  private onScroll = (): void => this.schedule(false);
  private onResize = (): void => this.schedule(true);
  private onQuestionSubmit = (event: Event): void => {
    if (!this.outline || !(event.target instanceof Element)) return;
    const target = event.target;
    const editor = '#prompt-textarea,[data-testid="composer"],[data-type="unified-composer"],#composer-background';
    if (event.type === 'keydown') {
      const key = event as KeyboardEvent;
      if (key.key !== 'Enter' || key.shiftKey || key.ctrlKey || key.altKey || key.metaKey || key.isComposing || !target.closest(editor)) return;
    } else if (event.type === 'submit') {
      if (!target.querySelector(editor)) return;
    } else if (!target.closest('button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="傳送提示"],button[aria-label="发送提示"]')) return;
    // Only a new question invalidates the saved outline; answer widgets and
    // streaming text can change continuously without requiring another read.
    this.sourceRevision++;
    this.sourceError = '';
    if (this.latestSnapshot) this.refresh(this.latestSnapshot);
  };

  constructor(private download: (element: HTMLElement, button: HTMLButtonElement) => void, private outline: boolean, private answerExport = true) {
    this.host = document.createElement('div'); this.host.id = 'ai-avatar-question-outline'; this.host.dataset.aiAvatarUi = '';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${actionStyles}
      :host{display:block;position:fixed;top:64px;left:16px;width:260px;max-width:calc(100vw - 32px);height:calc(100dvh - 176px);z-index:2147483642;color:var(--fg)}details{min-width:0;max-height:100%;padding-right:12px;border-right:1px solid var(--line)}details[open]{display:flex;flex-direction:column}summary{cursor:pointer;display:flex;align-items:center;gap:8px;list-style:none;min-height:40px;flex:none;font-weight:600;font-size:15px}summary::-webkit-details-marker{display:none}summary svg{width:14px;height:14px;transition:none}details[open] summary svg{transform:rotate(90deg)}summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}summary small{margin-left:auto;color:var(--muted);font-size:12px;font-weight:400;font-variant-numeric:tabular-nums}nav{flex:0 1 auto;min-height:0;overflow:auto;scrollbar-color:var(--line) transparent;padding:4px 0}nav button{display:block;width:100%;min-height:36px;padding:8px 10px;text-align:left;background:transparent;border:0;border-radius:6px;font-size:13px;line-height:1.55}nav button span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}nav button[aria-current=true]{background:var(--hover);font-weight:600}p{font-size:12px;color:var(--muted);margin:8px 0}::selection{background:var(--accent);color:var(--surface)}
      :host,details{pointer-events:none}summary,nav,#empty{pointer-events:auto}:host([data-compact]){height:auto;max-height:calc(100dvh - 176px)}:host([data-compact]) details{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:4px 10px}:host([data-compact]) details:not([open]){width:max-content;padding-right:12px}:host([data-compact]) nav{max-height:calc(100dvh - 240px)}:host([data-compact]) summary small{margin-left:12px}
      :host{--outline-current:#1a73e8}:host([data-theme=dark]){--outline-current:#8ab4f8}details{border:0;padding-right:12px}summary{font-weight:500;color:var(--muted);font-size:14px}nav button{color:var(--muted);border:0;border-radius:0;box-shadow:none;padding:7px 10px;background:transparent}nav button:hover,nav button:focus-visible{background:transparent;color:var(--outline-current);text-decoration:underline;text-underline-offset:3px}nav button[aria-current=true]{color:var(--outline-current);background:transparent;font-weight:600}:host([data-compact]) details{border:0;border-radius:0;background:transparent;padding:0 10px}:host([data-compact]) details[open]{background:var(--surface);box-shadow:0 4px 16px #0003}#retry{display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;padding:4px;min-height:28px;width:28px;color:var(--muted)}#retry svg{width:15px;height:15px}#retry:disabled{opacity:.5}
      nav button:disabled{opacity:.6;cursor:default;color:var(--muted);text-decoration:none}
    </style><details open><summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg><span>問題</span><small id="total" hidden></small><button id="retry" type="button" aria-label="重新讀取提問" title="重新讀取提問" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg></button></summary><nav aria-label="目前對話的問題導覽"></nav><p id="empty" role="status">正在辨識提問…</p></details>`;
    this.details = this.root.querySelector('details')!;
    this.details.addEventListener('toggle', this.onResize);
    document.addEventListener('scroll', this.onScroll, true); window.addEventListener('resize', this.onResize);
    if (this.outline) for (const type of ['submit', 'keydown', 'click']) document.addEventListener(type, this.onQuestionSubmit, true);
    if (typeof ResizeObserver !== 'undefined') this.resizeObserver = new ResizeObserver(this.onResize);
    this.root.getElementById('retry')!.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); this.sourceReadAt = 0; this.sourceReadRevision = -1; this.sourceError = '';
      if (this.sourceTimer) clearTimeout(this.sourceTimer); this.sourceTimer = null;
      if (this.latestSnapshot) this.refresh(this.latestSnapshot);
    });
  }

  public refresh(snapshot: ConversationSnapshot): void {
    applyTheme(this.host);
    if (this.outline) {
      this.latestSnapshot = snapshot;
      if (this.sourceUrl !== snapshot.url) {
        this.stopSource(); this.sourceUrl = snapshot.url; this.source = null; this.sourceReadAt = 0; this.sourceRevision = 0; this.sourceReadRevision = -1; this.sourceError = '';
      }
      const native = snapshot.messages.filter(message => message.role === 'user' && getMessageElement(message)?.isConnected).map(message => ({ message, element: getMessageElement(message)! }));
      const savedConversation = /\/c\/[\w-]+\/?$/.test(new URL(snapshot.url).pathname);
      if (!savedConversation && !native.length) { this.host.remove(); this.stopSource(); }
      else if (this.host.parentElement !== document.body) document.body.append(this.host);
      const locations = !native.length && this.source ? new Map(resolveOutlineQuestions(this.source).map(item => [item.message, item.element])) : null;
      const questions = native.length ? native : (this.source?.messages || []).map(message => ({ message, element: locations?.get(message) || null }));
      if (native.length) this.stopSource();
      else this.scheduleSource(snapshot);
      const signature = JSON.stringify([snapshot.url, questions.map(({ message }) => [message.key, message.markdown])]);
      if (signature !== this.signature || questions.some(({ element }, index) => element !== this.questions[index]?.element)) {
        this.signature = signature; this.questions = [];
        const nav = this.root.querySelector('nav')!; nav.replaceChildren();
        questions.forEach(({ message, element }, index) => {
          const button = document.createElement('button'); button.type = 'button';
          const span = document.createElement('span'); span.textContent = message.preview;
          button.title = message.markdown; button.setAttribute('aria-label', `跳到問題 ${index + 1}：${message.preview}`); button.append(span);
          button.disabled = !element;
          button.addEventListener('click', () => {
            if (!element?.isConnected) return;
            element.scrollIntoView({ block: 'center', behavior: 'auto' });
            this.markCurrent(button);
            if (this.compact) this.details.open = false;
          });
          nav.append(button); this.questions.push({ element, button });
        });
      }
      const total = this.root.getElementById('total')!; total.textContent = String(questions.length); total.hidden = !questions.length;
      const empty = this.root.getElementById('empty')!;
      empty.textContent = this.sourceController || this.sourceTimer ? '正在讀取目前聊天的提問…' : this.sourceError;
      empty.hidden = questions.length > 0 || !empty.textContent;
      const retry = this.root.getElementById('retry') as HTMLButtonElement; retry.hidden = !savedConversation || !!native.length; retry.disabled = !!this.sourceController || !!this.sourceTimer;
      this.main = this.questions.find(question => question.element)?.element?.closest('main,[role="main"],#main,#thread,[data-testid="conversation"]') || Array.from(document.querySelectorAll<HTMLElement>('main,[role="main"],#main,#thread,[data-testid="conversation"]')).find(element => !element.closest('[hidden],[aria-hidden="true"],[data-ai-avatar-ui]')) || null;
      this.sidebar = this.findSidebar();
      const observed = [this.main, this.sidebar].filter((element): element is HTMLElement => !!element);
      if (observed.length !== this.observed.length || observed.some((element, index) => element !== this.observed[index])) {
        this.resizeObserver?.disconnect(); this.observed = observed;
        observed.forEach(element => this.resizeObserver?.observe(element));
      }
    }
    const current = new Set<HTMLElement>();
    const toolbars = this.answerExport ? findAnswerToolbars() : [];
    snapshot.messages.filter(message => this.answerExport && message.role === 'assistant').forEach((message, index) => {
      const element = getMessageElement(message); if (!element?.isConnected) return;
      current.add(element);
      let action = this.answers.get(element);
      if (!action || !action.host.isConnected) {
        const host = document.createElement('div'); host.dataset.aiAvatarUi = ''; host.dataset.aiAvatarAnswerDownload = '';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${actionStyles}:host{display:inline-flex!important;flex:none;visibility:visible!important;opacity:1!important}button{display:inline-grid;place-items:center;width:36px;height:36px;min-height:36px;border:0;border-radius:8px;background:transparent;color:var(--muted);padding:8px}svg{width:20px;height:20px}</style><button type="button">${exportIcon}</button>`;
        const button = root.querySelector('button')!;
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.download(element, button); });
        action = { host, button }; this.answers.set(element, action);
      }
      const toolbar = toolbars.find(item => item.content === element || item.content.contains(element) || element.contains(item.content))?.toolbar;
      if (toolbar) {
        action.host.dataset.placement = 'toolbar'; action.host.style.cssText = 'display:inline-flex!important;flex:none;width:36px;height:36px;margin:0;';
        let share = toolbar.querySelector<HTMLElement>('[data-testid="share-turn-action-button"],button[aria-label="分享"],button[aria-label="Share"],button[aria-label="分享回覆"],button[aria-label="Share response"],button[title="分享"],button[title="Share"]');
        while (share && share.parentElement !== toolbar) share = share.parentElement;
        if (share) { if (action.host.nextElementSibling !== share) share.before(action.host); }
        else if (action.host.parentElement !== toolbar) toolbar.append(action.host);
      } else {
        action.host.dataset.placement = 'below'; action.host.style.cssText = 'display:flex!important;justify-content:flex-start;width:100%;margin:8px 0;';
        if (element.nextElementSibling !== action.host) element.after(action.host);
      }
      applyTheme(action.host); action.button.setAttribute('aria-label', `下載第 ${index + 1} 則回答`);
      action.button.disabled = !!(element.closest('[data-is-streaming="true"]') || element.querySelector('[data-is-streaming="true"]'));
      action.button.title = action.button.disabled ? '回答完成後即可下載' : '選擇 Markdown、HTML 或 PDF 下載此回答';
    });
    for (const [element, action] of this.answers) if (!current.has(element)) { action.host.remove(); this.answers.delete(element); }
    if (this.outline) { this.updateLayout(); this.updateCurrent(); }
  }

  private stopSource(): void {
    if (this.sourceTimer) clearTimeout(this.sourceTimer); this.sourceTimer = null;
    this.sourceController?.abort(); this.sourceController = null;
  }

  private scheduleSource(snapshot: ConversationSnapshot): void {
    if (this.sourceController || this.sourceError || !/\/c\/[\w-]+\/?$/.test(location.pathname)) return;
    if (this.source && document.querySelector('[data-is-streaming="true"]')) return;
    const main = document.querySelector('main,[role="main"],#main,#thread,[data-testid="conversation"]');
    if (!(main?.textContent || document.body.innerText || '').trim() || this.sourceReadRevision === this.sourceRevision) return;
    if (this.sourceTimer) {
      if (this.sourceRevision === this.scheduledRevision) return;
      clearTimeout(this.sourceTimer);
    }
    const revision = this.sourceRevision;
    this.scheduledRevision = revision;
    this.sourceTimer = setTimeout(() => { this.sourceTimer = null; void this.readSource(snapshot.url, revision); }, Math.max(1000, this.sourceReadAt + 5000 - Date.now()));
  }

  private async readSource(url: string, revision: number): Promise<void> {
    if (url !== location.href) return;
    const controller = new AbortController(); this.sourceController = controller;
    this.sourceReadAt = Date.now(); this.sourceReadRevision = revision;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const snapshot = await readCurrentQuestions(url, controller.signal);
      if (this.sourceController !== controller || url !== location.href) return;
      this.source = { ...snapshot, messages: snapshot.messages.filter(message => message.role === 'user') }; this.sourceError = '';
    } catch (error) {
      if (this.sourceController !== controller) return;
      this.sourceError = controller.signal.aborted ? '讀取提問逾時，請按重新讀取。' : `無法讀取提問：${(error as Error).message}`;
    } finally {
      clearTimeout(timeout);
      if (this.sourceController === controller) {
        this.sourceController = null;
        if (this.latestSnapshot?.url === location.href) this.refresh(this.latestSnapshot);
      }
    }
  }

  private findSidebar(): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('aside,nav,#history,[data-testid="sidebar"],[data-testid="history"]')).find(element => {
      if (element.closest('main,[data-ai-avatar-ui],[hidden],[aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      // Collapsed sidebars still occupy a narrow icon rail beside the conversation.
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.width < window.innerWidth * .5 && rect.height > window.innerHeight * .55 && rect.left <= 24 && rect.right > 0;
    }) || null;
  }

  private updateLayout(): void {
    if (!this.outline) return;
    this.sidebar = this.findSidebar();
    const edge = this.sidebar?.getBoundingClientRect().right || 0;
    const contentRects = [...this.questions.flatMap(question => question.element ? [question.element] : []), ...this.answers.keys()].map(element => {
      const content = element.querySelector<HTMLElement>('.markdown,.message-content,[data-message-content],.user-message-bubble-color') || element;
      return content.getBoundingClientRect();
    }).filter(rect => rect.width > 0 && rect.right > edge);
    const contentLeft = contentRects.length ? Math.min(...contentRects.map(rect => rect.left)) : this.main?.getBoundingClientRect().left || edge;
    const gutter = contentLeft - edge - 32;
    const room = window.innerWidth - edge;
    // The outline only occupies existing space; never reflow the site's conversation.
    const compact = gutter < 200;
    if (this.compact !== compact) { this.compact = compact; this.details.open = !compact; }
    this.host.toggleAttribute('data-compact', compact);
    const width = compact ? Math.min(280, room - 32) : Math.min(280, gutter);
    const left = Math.max(12, Math.min(edge + 16, window.innerWidth - 56));
    this.host.style.left = `${left}px`; this.host.style.width = `${Math.max(160, width)}px`;
  }

  private markCurrent(button: HTMLButtonElement): void {
    this.questions.forEach(question => {
      if (question.button === button) question.button.setAttribute('aria-current', 'true');
      else question.button.removeAttribute('aria-current');
    });
  }
  private updateCurrent(): void {
    const located = this.questions.filter(question => question.element);
    let current = located[0];
    const cutoff = Math.max(160, window.innerHeight / 2);
    for (const question of located) {
      if (question.element!.getBoundingClientRect().top <= cutoff) current = question;
      else break;
    }
    if (current) this.markCurrent(current.button);
  }
  public destroy(): void {
    this.stopSource();
    document.removeEventListener('scroll', this.onScroll, true); window.removeEventListener('resize', this.onResize);
    for (const type of ['submit', 'keydown', 'click']) document.removeEventListener(type, this.onQuestionSubmit, true);
    this.details.removeEventListener('toggle', this.onResize); this.resizeObserver?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.host.remove(); this.answers.forEach(action => action.host.remove()); this.answers.clear();
  }
}
