import { TargetSite, type PageFeatureSettings } from '@/common/types';
import { resolvePageFeatures } from '@/common/constants';
import { actionStyles, applyTheme, exportIcon, trashIcon, placeMenu, wireMenu } from '@/common/actionUi';
import { DateHistoryDialog } from './DateHistoryDialog';
import { captureConversation, type ExportFormat } from './ConversationExport';
import { DirectConversationExport, EXPORT_FORMAT_KEY } from './DirectConversationExport';
import { ConversationPageTools } from './ConversationPageTools';

const SIDEBARS = 'nav, aside, #history, #stage-sidebar, [data-testid="history"], [data-testid="sidebar"]';
const RECENT_LABELS = /^(?:最近項目|最近项目|最近|近期對話|近期对话|聊天紀錄|聊天记录|對話紀錄|对话记录|你的聊天|您的聊天|你的對話|你的对话|Recents|Recent chats|Chats|Your chats)$/i;
const COMPOSERS = 'form, [data-type="unified-composer"], [data-testid="composer"], #composer-background, #thread-bottom-container, #thread-bottom, .input-area-container';
const COMPOSER_ACTIONS = '[data-testid="send-button"], [data-testid="composer-speech-button"], button[aria-label*="voice" i], button[aria-label*="語音"], button[aria-label*="语音"], button[aria-label*="送出"], button[aria-label*="傳送"], button[aria-label*="Send" i]';

/** Header export and a separately positioned history action, outside native hover layouts. */
export class PageActions {
  private menuHost: HTMLElement;
  private menuRoot: ShadowRoot;
  private history: DateHistoryDialog;
  private exporter: DirectConversationExport;
  private conversationTools: ConversationPageTools;
  private features: PageFeatureSettings;
  private format: ExportFormat = 'markdown';
  private formatChanged = false;
  private menu: HTMLElement;
  private menuAnchor: HTMLButtonElement | null = null;
  private menuAction: (() => void) | null = null;
  private menuUrl = '';
  private outside = (event: Event): void => {
    if (!event.composedPath().includes(this.menuHost) && (!this.menuAnchor || !event.composedPath().includes(this.menuAnchor))) this.closeMenu(false);
  };
  private observer: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private mounts = new Set<HTMLElement>();
  private controls = new WeakMap<HTMLElement, HTMLButtonElement>();
  private historyHeading: HTMLElement | null = null;
  private onLayout = (): void => {
    const host = document.getElementById('ai-avatar-date-delete');
    if (host) this.placeHistory(host);
    if (!this.menu.hidden && this.menuAnchor?.isConnected) placeMenu(this.menu, this.menuAnchor);
  };

  constructor(private site: TargetSite, features?: Partial<PageFeatureSettings>) {
    this.features = resolvePageFeatures(features);
    this.menuHost = document.createElement('div'); this.menuHost.id = 'ai-avatar-page-menu'; this.menuHost.dataset.aiAvatarUi = '';
    this.menuRoot = this.menuHost.attachShadow({ mode: 'open' });
    this.menuRoot.innerHTML = `<style>${actionStyles}</style><div class="menu" role="menu" aria-label="下載格式" hidden></div><p class="notice" role="status" aria-live="polite" hidden></p>`;
    this.menu = this.menuRoot.querySelector('.menu')!;
    wireMenu(this.menu, () => this.closeMenu());
    this.menu.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Tab') this.closeMenu(false); });
    document.addEventListener('pointerdown', this.outside);
    const historyHost = document.createElement('div'); historyHost.id = 'ai-avatar-date-history';
    this.history = new DateHistoryDialog(historyHost);
    this.exporter = new DirectConversationExport(site, () => this.format, (message, pending) => this.notice(message, pending));
    this.conversationTools = this.createConversationTools();
    document.body.append(this.menuHost, historyHost);
    window.addEventListener('resize', this.onLayout); document.addEventListener('scroll', this.onLayout, true);
    this.observer = new MutationObserver(records => {
      if (records.every(record => (record.target as Element).closest?.('[data-ai-avatar-ui]'))) return;
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = null; this.mount(); }, 150);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['id', 'data-testid', 'contenteditable', 'hidden', 'aria-hidden', 'class', 'data-is-streaming', 'data-message-author-role', 'data-turn-role', 'data-turn', 'data-role', 'aria-label'] });
    this.mount();
    if (chrome.storage.local) void chrome.storage.local.get(EXPORT_FORMAT_KEY).then(result => {
      if (this.formatChanged || !['markdown', 'html', 'pdf'].includes(result[EXPORT_FORMAT_KEY])) return;
      this.format = result[EXPORT_FORMAT_KEY];
    }).catch(() => {});
  }

  private createConversationTools(): ConversationPageTools {
    return new ConversationPageTools((element, button) => this.openMenu(button, () => this.exporter.answer(element)), this.site === TargetSite.CHATGPT && this.features.questionOutline, this.features.answerExport);
  }

  public setFeatures(settings?: Partial<PageFeatureSettings>): void {
    const next = resolvePageFeatures(settings);
    if ((Object.keys(next) as (keyof PageFeatureSettings)[]).every(key => next[key] === this.features[key])) return;
    const rebuildTools = next.questionOutline !== this.features.questionOutline || next.answerExport !== this.features.answerExport;
    this.features = next; this.closeMenu(false);
    if (!next.conversationExport) {
      this.exporter.destroy(); this.menuRoot.querySelector<HTMLElement>('.notice')!.hidden = true;
      if (this.noticeTimer) clearTimeout(this.noticeTimer); this.noticeTimer = null;
    }
    if (!next.historyDelete) this.history.close();
    if (rebuildTools) { this.conversationTools.destroy(); this.conversationTools = this.createConversationTools(); }
    this.mount();
  }

  private removeControl(id: string): void {
    const host = document.getElementById(id);
    if (host) { host.remove(); this.mounts.delete(host); }
  }

  private control(id: string, label: string, icon: string, click: (button: HTMLButtonElement) => void): HTMLElement {
    const host = document.createElement('span'); host.id = id; host.dataset.aiAvatarUi = '';
    host.style.cssText = 'display:inline-flex;align-items:center;flex:none;vertical-align:middle;';
    host.style.setProperty('display', 'inline-flex', 'important');
    Object.assign(host.style, { width: '34px', minWidth: '34px', height: '34px', flexShrink: '0', pointerEvents: 'auto' });
    applyTheme(host);
    // Keep toolbar buttons in the page tree so the site's hover, focus and
    // responsive utility classes apply. Dialogs and menus stay isolated.
    host.innerHTML = `<style>
      #${id}:not([data-native])>button{display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;width:34px;height:34px;padding:7px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
      #${id}:not([data-native])>button:hover{background:var(--hover)}
      #${id}:not([data-native])>button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      #${id}:not([data-native])>button svg{display:block;width:20px;height:20px}
      #${id}:not([data-native])>button.header-download{width:auto;padding:0 12px;white-space:nowrap}
      #ai-avatar-date-delete:not([data-native])>button{padding:5px}
      #ai-avatar-date-delete:not([data-native])>button svg{width:24px;height:24px;flex-shrink:0}
    </style><button type="button" class="icon" aria-label="${label}" title="${label}">${icon}</button>`;
    const button = host.querySelector('button')!;
    // The trash drawing occupies less of its canvas than the site's toolbar
    // icons. Trim that empty margin so equal SVG sizes also look equal.
    if (id === 'ai-avatar-date-delete') button.querySelector('svg')!.setAttribute('viewBox', '2 2 20 20');
    button.querySelector('svg')!.setAttribute('fill', 'none');
    button.querySelector('svg')!.setAttribute('stroke', 'currentColor');
    button.querySelector('svg')!.setAttribute('stroke-width', '1.5');
    button.querySelector('svg')!.setAttribute('stroke-linecap', 'round');
    button.querySelector('svg')!.setAttribute('stroke-linejoin', 'round');
    this.controls.set(host, button);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); applyTheme(host); click(button); });
    this.mounts.add(host); return host;
  }

  private mount(): void {
    this.exporter.cancelIfNavigated();
    const snapshot = captureConversation(this.site);
    const blankNewChat = this.site === TargetSite.CHATGPT && !/\/c\/[\w-]+\/?$/.test(new URL(snapshot.url).pathname) && !snapshot.messages.length;
    if (this.menuAnchor && (!this.menuAnchor.isConnected || this.menuUrl !== location.href)) this.closeMenu(false);
    window.dispatchEvent(new Event('ai-avatar-composer-layout'));
    for (const mount of this.mounts) { if (!mount.isConnected) this.mounts.delete(mount); else applyTheme(mount); }
    if (!this.features.conversationExport || blankNewChat) {
      this.removeControl('ai-avatar-composer-export');
      if (this.menuAnchor && !this.menuAnchor.isConnected) this.closeMenu(false);
    }
    else {
      let exportHost = document.getElementById('ai-avatar-composer-export');
      if (!exportHost) {
        exportHost = this.control('ai-avatar-composer-export', '下載', exportIcon, button => this.openMenu(button, () => { void this.exporter.all(button); }));
        exportHost.style.width = 'auto'; exportHost.style.height = '36px';
        const button = this.controls.get(exportHost)!; button.className = 'header-download';
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.title = '選擇格式並下載完整對話';
        const text = document.createElement('span'); text.textContent = '下載'; button.append(text);
      }
      if (this.site === TargetSite.CHATGPT) this.placeHeaderExport(exportHost); else this.placeExport(exportHost);
      exportHost.style.setProperty('display', 'inline-flex', 'important');
    }
    if (this.site !== TargetSite.CHATGPT || !this.features.historyDelete) {
      this.removeControl('ai-avatar-date-delete'); this.removeControl('ai-avatar-history-heading'); this.historyHeading = null;
      this.conversationTools.refresh(snapshot); return;
    }
    const roots = Array.from(document.querySelectorAll<HTMLElement>(SIDEBARS));
    let heading: HTMLElement | null = null;
    for (const root of roots) {
      if (!this.rendered(root)) continue;
      const candidates = root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,span,div,p,strong,[role="heading"]');
      for (const candidate of Array.from(candidates)) {
        if (candidate.closest('a,[data-ai-avatar-ui]') || !this.rendered(candidate)) continue;
        if (!Array.from(candidate.childNodes).some(node => node.nodeType === Node.TEXT_NODE && RECENT_LABELS.test((node.textContent || '').trim()))) continue;
        heading = candidate;
        if (heading) break;
      }
      if (heading) break;
    }
    if (!heading) {
      const history = document.querySelector<HTMLElement>('#history, [data-testid="history"]');
      if (history) {
        heading = history.querySelector('#ai-avatar-history-heading');
        if (!heading) { heading = document.createElement('div'); heading.id = 'ai-avatar-history-heading'; heading.dataset.aiAvatarUi = ''; heading.textContent = '對話紀錄'; history.prepend(heading); this.mounts.add(heading); }
      }
    }
    this.historyHeading = heading;
    let historyHost = document.getElementById('ai-avatar-date-delete');
    if (!historyHost && heading) {
      historyHost = this.control('ai-avatar-date-delete', '依日期刪除對話', trashIcon, button => { this.closeMenu(false); this.history.open(button); });
      document.body.append(historyHost);
    }
    if (historyHost) this.placeHistory(historyHost);
    this.conversationTools.refresh(snapshot);
  }

  private placeHeaderExport(host: HTMLElement): void {
    const share = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="share-chat-button"],header button,#conversation-header button,#thread-header button,[data-testid="conversation-header"] button,button[aria-label="分享"],button[aria-label="Share"],button[aria-label="分享對話"],button[aria-label="分享聊天"]')).find(button => {
      if (button.closest('dialog,[role="dialog"],nav,aside,[data-ai-avatar-ui]') || !this.rendered(button)) return false;
      return button.dataset.testid === 'share-chat-button' || [button.getAttribute('aria-label'), button.textContent].some(label => /^(?:分享(?:對話|聊天)?|Share(?: chat| conversation)?)$/i.test((label || '').trim()));
    });
    if (share?.parentElement) {
      if (host.parentElement !== share.parentElement || host.nextElementSibling !== share) share.before(host);
      delete host.dataset.fallback;
      for (const property of ['position', 'top', 'right', 'bottom', 'left', 'z-index', 'background', 'border-radius', 'box-shadow']) host.style.removeProperty(property);
      host.style.marginRight = '0';
      this.matchNativeControl(host, share);
    } else {
      this.matchNativeControl(host, null);
      if (host.parentElement !== document.body) document.body.append(host);
      host.dataset.fallback = ''; host.style.marginRight = '0';
      Object.assign(host.style, { position: 'fixed', top: '16px', right: '20px', zIndex: '2147483645', borderRadius: '8px' });
      host.style.background = host.dataset.theme === 'dark' ? '#242424' : '#fff';
    }
  }

  private matchNativeControl(host: HTMLElement, native: HTMLElement | null): void {
    const button = this.controls.get(host)!;
    const icon = button.querySelector('svg')!;
    const label = button.querySelector('span');
    host.toggleAttribute('data-native', !!native);
    button.className = native?.className || (label ? 'header-download' : 'icon');
    button.style.cssText = native?.style.cssText || '';
    icon.removeAttribute('class'); icon.style.cssText = '';
    if (label) label.className = '';
    host.style.width = label ? 'auto' : '34px';
    host.style.minWidth = '0'; host.style.height = 'auto';
    host.style.color = host.dataset.theme === 'dark' ? '#f1f1f1' : '#252525';
    host.style.font = '';
    host.style.setProperty('--hover', host.dataset.theme === 'dark' ? '#383838' : '#efefef');
    if (!native) return;
    const style = getComputedStyle(native);
    // The delete control is positioned outside the sidebar's hover layout,
    // so carry inherited typography and color across that boundary as well.
    host.style.color = style.color;
    host.style.font = style.font;
    const nativeIcon = native.querySelector('svg');
    if (nativeIcon) {
      icon.setAttribute('class', nativeIcon.getAttribute('class') || '');
      const iconStyle = getComputedStyle(nativeIcon);
      const iconRect = nativeIcon.getBoundingClientRect();
      icon.style.width = iconRect.width ? `${iconRect.width}px` : iconStyle.width || '24px';
      icon.style.height = iconRect.height ? `${iconRect.height}px` : iconStyle.height || '24px';
      icon.style.flexShrink = '0';
      if (nativeIcon.parentElement !== native) {
        const contentStyle = getComputedStyle(nativeIcon.parentElement!);
        button.style.display = 'inline-flex'; button.style.alignItems = 'center'; button.style.justifyContent = 'center';
        button.style.gap = contentStyle.gap === 'normal' || !contentStyle.gap ? '6px' : contentStyle.gap;
      }
    }
    if (label) {
      const nativeLabel = Array.from(native.querySelectorAll('span')).find(span => span.textContent?.trim() && !span.querySelector('svg'));
      label.className = nativeLabel?.className || '';
    } else {
      const rect = native.getBoundingClientRect();
      const size = rect.height || parseFloat(style.height) || 34;
      const width = `${rect.width || parseFloat(style.width) || size}px`; const height = `${size}px`;
      host.style.width = width; host.style.height = height;
      // Sidebar sizing may depend on ancestor selectors or variables. This
      // control lives on body, so preserve the measured hit area explicitly.
      Object.assign(button.style, { width, height, minWidth: width, minHeight: height, boxSizing: 'border-box', flexShrink: '0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
    }
  }

  private newChatControl(): HTMLElement | null {
    const sidebar = this.historyHeading?.closest(SIDEBARS);
    if (!sidebar) return null;
    return Array.from(sidebar.querySelectorAll<HTMLElement>('button,a[role="button"],a[href]')).find(control => {
      if (control.closest('[data-ai-avatar-ui]') || !this.rendered(control) || !control.querySelector('svg')) return false;
      const label = [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent].filter(Boolean).join(' ');
      // A full-width navigation entry is not a toolbar icon button.
      const visibleText = Array.from(control.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) ||
        Array.from(control.querySelectorAll('span')).some(span => span.textContent?.trim() && !span.matches('.sr-only') && getComputedStyle(span).display !== 'none');
      return !visibleText && (/(?:new chat|new conversation|新對話|新增對話|新聊天|新建聊天|发起新对话|開始新對話|创建新对话)/i.test(label) || /(?:create|new)-.*chat/.test(control.dataset.testid || ''));
    }) || null;
  }

  private openMenu(anchor: HTMLButtonElement, action: () => void): void {
    if (!this.menu.hidden && this.menuAnchor === anchor) { this.closeMenu(); return; }
    this.closeMenu(false); this.menuAnchor = anchor; this.menuAction = action; this.menuUrl = location.href;
    applyTheme(this.menuHost); this.menu.replaceChildren();
    for (const [format, label] of [['markdown', 'Markdown (.md)'], ['html', 'HTML (.html)'], ['pdf', 'PDF（另存為 PDF）']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.dataset.format = format; button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(this.format === format));
      button.addEventListener('click', () => {
        const download = this.menuAction; const url = this.menuUrl; this.closeMenu();
        if (url !== location.href) { this.notice('聊天已切換，請重新點選下載。'); return; }
        this.format = format; this.formatChanged = true;
        if (chrome.storage.local) void chrome.storage.local.set({ [EXPORT_FORMAT_KEY]: format }).catch(() => {});
        download?.();
      });
      this.menu.append(button);
    }
    anchor.setAttribute('aria-haspopup', 'menu'); anchor.setAttribute('aria-expanded', 'true');
    placeMenu(this.menu, anchor); this.menu.querySelector<HTMLButtonElement>(`[data-format="${this.format}"]`)?.focus();
  }

  private closeMenu(focus = true): void {
    const anchor = this.menuAnchor; const wasOpen = !this.menu.hidden;
    this.menu.hidden = true; anchor?.setAttribute('aria-expanded', 'false'); this.menuAnchor = null; this.menuAction = null;
    if (focus && wasOpen && anchor?.isConnected) anchor.focus();
  }

  private placeHistory(host: HTMLElement): void {
    const heading = this.historyHeading;
    if (!heading?.isConnected || !this.rendered(heading)) { host.style.setProperty('display', 'none', 'important'); return; }
    this.matchNativeControl(host, this.newChatControl());
    const node = Array.from(heading.childNodes).find(item => item.nodeType === Node.TEXT_NODE && RECENT_LABELS.test((item.textContent || '').trim()));
    const range = document.createRange();
    if (node) range.selectNodeContents(node);
    const rect = node && typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : heading.getBoundingClientRect();
    if (rect.height > 0 && (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth)) { host.style.setProperty('display', 'none', 'important'); return; }
    // Follow the label text, leaving room for its chevron; hover actions cannot move this control.
    const left = Math.max(8, Math.min(rect.right + 22, window.innerWidth - 42));
    const height = parseFloat(host.style.height) || 34;
    const top = Math.max(8, Math.min(rect.top + (rect.height - height) / 2, window.innerHeight - height - 8));
    Object.assign(host.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, zIndex: '2147483645' });
    host.style.setProperty('display', 'inline-flex', 'important');
  }

  private rendered(element: HTMLElement): boolean {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  private placeExport(host: HTMLElement): void {
    this.matchNativeControl(host, null);
    const selector = this.site === TargetSite.CHATGPT
      ? '#prompt-textarea, [data-testid="composer"] [contenteditable="true"], #thread-bottom-container [contenteditable="true"], textarea[data-id="root"], textarea[name="prompt-textarea"], [contenteditable="true"][role="textbox"]'
      : 'rich-textarea [contenteditable="true"], textarea, .ql-editor[contenteditable="true"]';
    const input = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => this.rendered(element));
    let composer = input?.closest<HTMLElement>(COMPOSERS) || null;
    // Some layouts use an unnamed wrapper instead of a form or composer ID.
    if (input && !composer) {
      for (let parent = input.parentElement, depth = 0; parent && parent !== document.body && !parent.matches('main') && depth < 5; parent = parent.parentElement, depth++) {
        if (parent.querySelector(COMPOSER_ACTIONS)) { composer = parent; break; }
      }
    }
    const action = composer ? Array.from(composer.querySelectorAll<HTMLElement>(COMPOSER_ACTIONS)).find(element => this.rendered(element)) : undefined;
    const row = composer?.querySelector<HTMLElement>('[data-testid="composer-footer-actions"], .input-buttons-wrapper');
    const target = action?.parentElement || row || composer;
    if (target) {
      if (host.parentElement !== target || (action && host.nextElementSibling !== action)) {
        if (action) action.before(host); else target.append(host);
      }
      delete host.dataset.fallback;
      for (const property of ['position', 'right', 'bottom', 'z-index', 'background', 'border-radius', 'box-shadow']) host.style.removeProperty(property);
    } else {
      // Keep export reachable while the composer hydrates, is hidden, or changes structure.
      if (host.parentElement !== document.body) document.body.append(host);
      host.dataset.fallback = '';
      const avatar = document.getElementById('ai-avatar-overlay')?.getBoundingClientRect();
      // Put the fallback next to the avatar when both occupy the bottom-right corner.
      const overlaps = avatar && avatar.right > window.innerWidth - 54 && avatar.bottom > window.innerHeight - 54 && avatar.top < window.innerHeight - 20;
      const right = overlaps ? Math.min(window.innerWidth - 54, Math.max(20, window.innerWidth - avatar.left + 12)) : 20;
      Object.assign(host.style, { position: 'fixed', right: `${Math.max(12, right)}px`, bottom: '20px', zIndex: '2147483645', borderRadius: '8px', boxShadow: '0 3px 14px #0003' });
      applyTheme(host);
      host.style.background = host.dataset.theme === 'dark' ? '#242424' : '#fff';
    }
  }

  private notice(message: string, pending = false): void {
    applyTheme(this.menuHost);
    const notice = this.menuRoot.querySelector<HTMLElement>('.notice')!;
    notice.textContent = message; notice.hidden = false;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = pending ? null : setTimeout(() => { notice.hidden = true; }, 6000);
  }
  public destroy(): void {
    this.observer.disconnect(); if (this.timer) clearTimeout(this.timer); if (this.noticeTimer) clearTimeout(this.noticeTimer);
    window.removeEventListener('resize', this.onLayout); document.removeEventListener('scroll', this.onLayout, true);
    document.removeEventListener('pointerdown', this.outside); this.closeMenu(false);
    this.history.destroy(); this.exporter.destroy(); this.conversationTools.destroy(); this.menuHost.remove(); this.mounts.forEach(host => host.remove());
  }
}
