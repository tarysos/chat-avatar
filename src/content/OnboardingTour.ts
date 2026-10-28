import { actionStyles, applyTheme } from '@/common/actionUi';
import { AVATAR_IMAGES, resolvePageFeatures, STORAGE_KEY_ONBOARDING } from '@/common/constants';
import { AvatarState, MessageType, TargetSite, type CustomAvatarImages, type PageFeatureSettings } from '@/common/types';

interface Step {
  id: string; title: string; text: string; emotion: AvatarState;
  target?: string; action?: string; openMenu?: boolean;
}

/** An optional, expression-led guide that leaves the conversation usable. */
export class OnboardingTour {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private steps: Step[] = [];
  private index = 0;
  private images: CustomAvatarImages = {};
  private features = resolvePageFeatures();
  private origin: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private originalImage: { element: HTMLImageElement; src: string } | null = null;
  private frame = 0;
  private destroyed = false;
  private replay = (): void => this.start();
  private layout = (): void => {
    if (!this.host || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.updateTarget(); });
  };

  constructor(private site: TargetSite, private openOptions: () => void, private setEmotion?: (state: AvatarState | null) => void) {
    window.addEventListener('ai-avatar-start-tour', this.replay);
    window.addEventListener('resize', this.layout); document.addEventListener('scroll', this.layout, true);
  }

  public configure(features?: Partial<PageFeatureSettings>, images: CustomAvatarImages = this.images): void {
    const current = this.steps[this.index]?.id;
    this.features = resolvePageFeatures(features); this.images = images; this.steps = this.buildSteps();
    const match = this.steps.findIndex(step => step.id === current);
    this.index = match >= 0 ? match : Math.min(this.index, this.steps.length - 1);
    if (this.host) this.render();
  }

  public setImages(images: CustomAvatarImages): void { this.images = images; if (this.host) this.render(); }

  public maybeStart(): void {
    if (this.destroyed) return;
    try {
      chrome.runtime.sendMessage({ type: MessageType.CLAIM_ONBOARDING, payload: null }, result => {
        if (!this.destroyed && !chrome.runtime.lastError && result?.show) this.start();
      });
    } catch { /* Manual replay remains available when the background is unavailable. */ }
  }

  private buildSteps(): Step[] {
    const steps: Step[] = [{ id: 'welcome', title: '嗨，讓我帶你認識幾個小幫手！', text: '我會用不同表情帶你認識目前開啟的功能。你可以邊看邊操作，也能隨時略過；關閉的功能可到設定重新開啟。', emotion: AvatarState.HAPPY }];
    if (this.site === TargetSite.CHATGPT && this.features.questionOutline) steps.push({ id: 'questions', title: '想回到某個問題？點左側清單', text: '送出問題後，左側會出現「問題」導覽，點文字就能跳回原文。空白新對話會安靜等待，不會反覆尋找。', emotion: AvatarState.THINKING, target: '#ai-avatar-question-outline', action: '顯示導覽位置' });
    if (this.features.conversationExport) steps.push({ id: 'conversation', title: '把整段對話帶走', text: this.site === TargetSite.CHATGPT ? '點右上角、分享左邊的「下載」，再選 Markdown、HTML 或 PDF。會取得目前聊天的完整分支，較早的訊息也會包含。' : '點輸入框旁的「下載」，再選 Markdown、HTML 或 PDF，即可儲存目前已載入的對話。', emotion: AvatarState.EXCITED, target: '#ai-avatar-composer-export', action: '看看下載選單', openMenu: true });
    if (this.features.answerExport) steps.push({ id: 'answer', title: '只要這一則回答，也可以', text: '收到回答後，在回答下方、分享左邊找向下的下載圖示。點一下再選格式，就只會下載那則回答。', emotion: AvatarState.HAPPY, target: '[data-ai-avatar-answer-download]', action: '看看單則下載選單', openMenu: true });
    if (this.site === TargetSite.CHATGPT && this.features.historyDelete) steps.push({ id: 'history', title: '整理聊天前，先選好範圍', text: '「最近項目」旁的垃圾桶可依日期篩選聊天。先選日期、勾選紀錄，再確認刪除；目前聊天不能勾選，需要保留的內容先下載。', emotion: AvatarState.WORRIED, target: '#ai-avatar-date-delete', action: '顯示垃圾桶位置' });
    steps.push({ id: 'avatar', title: '把我放到你喜歡的位置', text: '拖曳角色可移動，拖四個角落可縮放，放開後會記住位置。設定頁可以更換表情包、分別開關功能；之後想重看，雙擊角色或點設定頁的「使用教學」。', emotion: AvatarState.EXCITED, target: '#ai-avatar-overlay', action: '前往設定' });
    return steps;
  }

  public start(): void {
    const avatar = this.avatar();
    if (this.destroyed || !avatar || getComputedStyle(avatar).visibility === 'hidden' || getComputedStyle(avatar).display === 'none') return;
    if (this.host) { this.root?.getElementById('title')?.focus(); return; }
    this.steps = this.buildSteps(); this.index = 0;
    this.origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void this.save(false);
    this.host = document.createElement('div'); this.host.id = 'ai-avatar-onboarding'; this.host.dataset.aiAvatarUi = '';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${actionStyles}
      :host{display:block;position:fixed;width:320px;max-width:calc(100vw - 24px);z-index:2147483646;color:var(--fg);--primary-fg:#fff}:host([data-theme=dark]){--primary-fg:#142219}
      .bubble{position:relative;background:var(--surface);border-radius:16px;box-shadow:0 8px 24px #0003;padding:16px;max-height:var(--available-height,calc(100dvh - 24px));overflow:auto;overflow-wrap:anywhere}
      .tail{position:absolute;width:12px;height:12px;background:var(--surface);transform:rotate(45deg);pointer-events:none}
      :host([data-side=above]) .tail{bottom:-6px;left:var(--tail)}:host([data-side=below]) .tail{top:-6px;left:var(--tail)}
      :host([data-side=left]) .tail{right:-6px;top:var(--tail)}:host([data-side=right]) .tail{left:-6px;top:var(--tail)}
      header,footer{display:flex;align-items:center;gap:8px}header{justify-content:space-between;margin-bottom:12px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}header button{border:0;background:transparent;padding:4px 8px;color:var(--muted)}
      h2{font-size:16px;line-height:1.5;margin:0 0 8px}p{font-size:14px;line-height:1.7;margin:0}#hint{margin-top:8px;font-size:12px;color:var(--muted)}
      #action{margin-top:14px;background:transparent;text-align:left}footer{margin-top:20px}.primary{background:var(--accent);border-color:var(--accent);color:var(--primary-fg);margin-left:auto}.primary:hover,.primary:focus-visible{background:var(--accent);filter:brightness(.95)}.spotlight{position:fixed;pointer-events:none;border:2px solid var(--accent);border-radius:8px;box-shadow:0 3px 12px #0002}
    </style><div id="spotlight" class="spotlight" hidden></div><div class="tail" aria-hidden="true"></div><section class="bubble" role="region" aria-label="角色使用教學">
      <header><span id="progress"></span><button type="button" id="skip" aria-label="略過使用教學">略過</button></header>
      <div aria-live="polite" aria-atomic="true"><h2 id="title" tabindex="-1"></h2><p id="description"></p><p id="hint" hidden></p></div>
      <button type="button" id="action" hidden></button><footer><button type="button" id="back">上一步</button><button type="button" class="primary" id="next"></button></footer>
    </section>`;
    this.root.getElementById('skip')!.addEventListener('click', () => this.finish(false));
    this.root.getElementById('back')!.addEventListener('click', () => { if (this.index > 0) { this.index--; this.render(); this.root?.getElementById('title')?.focus(); } });
    this.root.getElementById('next')!.addEventListener('click', () => {
      if (this.index === this.steps.length - 1) this.finish(true);
      else { this.index++; this.render(); this.root?.getElementById('title')?.focus(); }
    });
    this.root.getElementById('action')!.addEventListener('click', () => this.act());
    this.root.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') { event.preventDefault(); this.finish(false); } });
    document.body.append(this.host); this.render(); this.root.getElementById('title')!.focus();
    this.observer = new MutationObserver(records => { if (records.some(record => !(record.target as Element).closest?.('[data-ai-avatar-ui]'))) this.layout(); });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
    this.resizeObserver = new ResizeObserver(this.layout);
    this.resizeObserver.observe(this.avatar()!); this.resizeObserver.observe(this.host);
  }

  private render(): void {
    if (!this.root || !this.host) return;
    applyTheme(this.host); const step = this.steps[this.index];
    this.root.getElementById('title')!.textContent = step.title;
    this.root.getElementById('description')!.textContent = step.text;
    this.root.getElementById('progress')!.textContent = `使用教學 ${this.index + 1} / ${this.steps.length}`;
    if (this.setEmotion) this.setEmotion(step.emotion);
    else {
      // Settings speaks through its existing preview instead of creating another character.
      const image = this.avatar()?.querySelector<HTMLImageElement>('img');
      if (image) {
        if (!this.originalImage) this.originalImage = { element: image, src: image.src };
        const custom = this.images[step.emotion];
        image.src = typeof custom === 'string' && custom.startsWith('data:image/') ? custom : chrome.runtime.getURL(AVATAR_IMAGES[step.emotion]);
      }
    }
    this.root.getElementById('back')!.hidden = this.index === 0;
    this.root.getElementById('next')!.textContent = this.index === this.steps.length - 1 ? '完成' : this.index === 0 ? '開始教學' : '下一步';
    const action = this.root.getElementById('action')!; action.textContent = step.action || ''; action.hidden = !step.action;
    this.updateTarget();
  }

  private avatar(): HTMLElement | null {
    return document.getElementById('ai-avatar-overlay') || document.getElementById('preview-happy');
  }

  private positionBubble(): void {
    const anchor = this.avatar();
    if (!anchor || !this.host || !this.root) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 14; const margin = 12; const width = Math.min(320, window.innerWidth - margin * 2);
    const leftRoom = rect.left - gap - margin; const rightRoom = window.innerWidth - rect.right - gap - margin;
    const aboveRoom = rect.top - gap - margin; const belowRoom = window.innerHeight - rect.bottom - gap - margin;
    const side = leftRoom >= width ? 'left' : rightRoom >= width ? 'right' : aboveRoom >= belowRoom ? 'above' : 'below';
    const vertical = side === 'above' || side === 'below';
    this.host.style.width = `${width}px`;
    this.host.style.setProperty('--available-height', `${Math.max(48, vertical ? Math.max(aboveRoom, belowRoom) : window.innerHeight - margin * 2)}px`);
    const height = this.root.querySelector<HTMLElement>('.bubble')!.getBoundingClientRect().height;
    const clamp = (value: number, max: number): number => Math.max(margin, Math.min(value, max - margin));
    const centerX = rect.left + rect.width / 2; const centerY = rect.top + rect.height / 2;
    const left = clamp(side === 'left' ? rect.left - gap - width : side === 'right' ? rect.right + gap : centerX - width / 2, window.innerWidth - width);
    const top = clamp(side === 'above' ? rect.top - gap - height : side === 'below' ? rect.bottom + gap : centerY - height / 2, window.innerHeight - height);
    this.host.style.left = `${left}px`; this.host.style.top = `${top}px`;
    this.host.dataset.side = side;
    this.host.style.setProperty('--tail', `${Math.max(18, Math.min(vertical ? centerX - left : centerY - top, (vertical ? width : height) - 24))}px`);
  }

  private target(): HTMLElement | null {
    const selector = this.steps[this.index]?.target;
    if (!selector) return null;
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => {
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (parent.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      return true;
    }) || null;
  }

  private updateTarget(): void {
    if (!this.root) return;
    const avatar = this.avatar();
    if (!avatar || getComputedStyle(avatar).visibility === 'hidden' || getComputedStyle(avatar).display === 'none') { this.close(); return; }
    const target = this.target(); const step = this.steps[this.index]; const rect = target?.getBoundingClientRect();
    if (this.host) { applyTheme(this.host); this.positionBubble(); }
    const spotlight = this.root.getElementById('spotlight')!;
    spotlight.hidden = !rect || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight;
    if (rect) Object.assign(spotlight.style, { left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
    const hint = this.root.getElementById('hint')!;
    hint.hidden = !step.target || !!target || step.id === 'avatar';
    hint.textContent = step.id === 'questions' ? '送出第一個問題後，這裡才會出現導覽。' : step.id === 'answer' ? '收到第一則回答後，就會出現單則下載圖示。' : '開啟聊天並載入相關區域後，就能找到這個按鈕。';
    (this.root.getElementById('action') as HTMLButtonElement).disabled = step.id !== 'avatar' && !target;
  }

  private act(): void {
    const step = this.steps[this.index];
    if (step.id === 'avatar') { this.finish(true); this.openOptions(); return; }
    const target = this.target(); if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    if (step.openMenu) (target.shadowRoot?.querySelector<HTMLButtonElement>('button') || target.querySelector<HTMLButtonElement>('button'))?.click();
    else (target.shadowRoot?.querySelector<HTMLElement>('summary') || target.querySelector<HTMLElement>('button') || target).focus();
    this.updateTarget();
  }

  private async save(completed: boolean): Promise<void> {
    try { await chrome.storage.local.set({ [STORAGE_KEY_ONBOARDING]: { seen: true, completed } }); } catch { /* The guide remains dismissible if storage is unavailable. */ }
  }

  private finish(completed: boolean): void { void this.save(completed); this.close(); this.origin?.isConnected && this.origin.focus(); }
  private close(): void {
    this.observer?.disconnect(); this.observer = null;
    this.resizeObserver?.disconnect(); this.resizeObserver = null;
    if (this.host) this.setEmotion?.(null);
    if (this.originalImage) { this.originalImage.element.src = this.originalImage.src; this.originalImage = null; }
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0;
    this.host?.remove(); this.host = null; this.root = null;
  }
  public destroy(): void {
    this.destroyed = true; this.close(); window.removeEventListener('ai-avatar-start-tour', this.replay);
    window.removeEventListener('resize', this.layout); document.removeEventListener('scroll', this.layout, true);
  }
}
