import { actionStyles, applyTheme } from '@/common/actionUi';
import { DatedHistoryClient, filterDatedChats, dateBounds, currentChatId, type DatedChat, type HistoryRange } from './DatedHistory';

function localDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

export class DateHistoryDialog {
  private root: ShadowRoot;
  private dialog: HTMLDialogElement;
  private client = new DatedHistoryClient();
  private all: DatedChat[] = [];
  private matched: DatedChat[] = [];
  private controller: AbortController | null = null;
  private anchor: HTMLElement | null = null;
  private busy = false;
  private deleting = false;
  private loaded = false;
  private cacheIdentity = '';
  private defaultEnd = true;
  private pendingDeletion: { selected: DatedChat[]; range: HistoryRange; url: string } | null = null;

  constructor(private host: HTMLElement) {
    host.dataset.aiAvatarUi = '';
    this.root = host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${actionStyles}
      dialog{width:min(540px,calc(100vw - 28px));max-height:calc(100dvh - 32px);overflow:auto;margin:auto;padding:24px;background:var(--surface);color:var(--fg);border:0;border-radius:12px;box-shadow:0 12px 45px #0005}dialog::backdrop{background:#0007}
      header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}h2{font-size:18px;margin:0}p{margin:10px 0}.muted{color:var(--muted);font-size:12px}.dates{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block}input[type=date],select{width:100%;min-width:0;min-height:38px;padding:6px;margin:5px 0 10px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--fg)}input[type=checkbox]{accent-color:var(--accent);width:17px;height:17px;flex:none}
      .row{display:flex;align-items:center;gap:8px}.row label{flex:1}.list{max-height:230px;overflow:auto;border-block:1px solid var(--line);margin:12px 0}.chat{display:flex;align-items:start;gap:8px;padding:9px 0}.chat span{min-width:0;overflow-wrap:anywhere}.chat small{display:block;color:var(--muted);font-size:12px}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}.actions #count{flex:1;margin:0}.danger{color:var(--danger);border-color:var(--danger)}#status{overflow-wrap:anywhere;font-size:13px}#status.error{color:var(--danger)}summary{cursor:pointer;color:var(--muted);font-size:13px;padding:8px 0}summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}details label{margin-top:8px}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:8px}
      #result-title,#deleting-title{font-size:20px;margin:0 0 12px}#result-description{margin:0 0 12px}#result-view .actions,#deleting-view .actions{justify-content:flex-end;margin-top:24px}#result-refresh{background:var(--accent);color:var(--surface);border-color:var(--accent)}#deleting-progress{width:100%;height:8px;accent-color:var(--accent)}#deleting-status{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      @media(max-width:420px){dialog{padding:18px}.dates{grid-template-columns:1fr;gap:0}}
      dialog[data-confirm]{width:min(440px,calc(100vw - 28px));border-radius:16px}#confirm-title{font-size:20px;font-weight:600;line-height:1.4;margin:0 0 12px}#confirm-description{font-size:14px;color:var(--muted);margin:0 0 20px}#confirm-titles{list-style:none;margin:0;padding:12px 0;max-height:200px;overflow:auto;border-block:1px solid var(--line);scrollbar-color:var(--line) transparent}#confirm-titles li{padding:5px 0;overflow-wrap:anywhere}#confirm-range{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;margin:12px 0 24px}.confirm-actions{display:flex;justify-content:flex-end;gap:8px}.confirm-actions button{min-height:40px;padding:8px 16px;border-radius:8px;font-weight:500}#confirm-delete{background:#d92d20;color:#fff;border:0}#confirm-delete:hover{background:#b42318}#confirm-delete:focus-visible{outline-color:#d92d20}
    </style><dialog aria-labelledby="history-title"><div id="history-view">
      <header><h2 id="history-title">刪除對話</h2><button type="button" id="close" aria-label="關閉日期刪除視窗">關閉</button></header>
      <p class="muted">選日期、勾選對話，再確認刪除。日期預設依最後更新時間，包含起迄當日。</p>
      <div class="dates"><label>開始日期<input type="date" id="start" required></label><label>結束日期<input type="date" id="end" required></label></div>
      <div class="toolbar"><details><summary>更多選項</summary><label for="basis">日期依據</label><select id="basis"><option value="updatedAt">最後更新日期</option><option value="createdAt">建立日期</option></select><button type="button" id="full">完整更新清單</button></details><div class="row"><button type="button" id="preview">載入對話</button><button type="button" id="stop" hidden>停止</button></div></div>
      <p id="status" role="status" aria-live="polite"></p>
      <button type="button" id="refresh-history" hidden>重新整理左側對話清單</button>
      <div id="results" hidden><label class="row"><input type="checkbox" id="all"><span>全選符合日期的對話</span></label><div class="list" id="list"></div><p class="muted">目前開啟的對話無法勾選；封存對話不列入。</p>
      <div class="actions"><p class="muted" id="count"></p><button type="button" class="danger" id="delete" disabled>刪除對話</button></div></div>
    </div><section id="confirm-view" hidden>
      <h2 id="confirm-title"></h2><p id="confirm-description">刪除後將無法復原。請確認以下對話。</p>
      <ul id="confirm-titles" aria-label="即將刪除的對話"></ul><p id="confirm-range"></p>
      <div class="confirm-actions"><button type="button" id="confirm-cancel">取消</button><button type="button" id="confirm-delete">確認刪除</button></div>
    </section><section id="deleting-view" hidden>
      <h2 id="deleting-title" tabindex="-1">刪除中…</h2><p id="deleting-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <progress id="deleting-progress" value="0" max="1" aria-label="已完成刪除的對話筆數"></progress>
      <p class="muted">請保持頁面開啟。停止後，已送出的刪除仍會完成，其餘對話會保留。</p>
      <div class="actions"><button type="button" id="deleting-stop">停止後續刪除</button></div>
    </section><section id="result-view" hidden>
      <h2 id="result-title" tabindex="-1">刪除成功</h2><p id="result-description" role="status" aria-live="polite"></p>
      <p class="muted">重新整理頁面後，左側對話清單才會同步更新，目前開啟的對話會保留。</p>
      <div class="actions"><button type="button" id="result-continue">繼續整理</button><button type="button" id="result-refresh">完成並重新整理</button></div>
    </section></dialog>`;
    this.dialog = this.root.querySelector('dialog')!;
    const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    this.element<HTMLInputElement>('start').value = localDate(start); this.element<HTMLInputElement>('end').value = localDate(today);
    this.element('close').addEventListener('click', () => this.close());
    // ChatGPT owns its sidebar state and layout. Reload on request instead of hiding native rows.
    for (const id of ['result-refresh', 'refresh-history']) this.element(id).addEventListener('click', () => { if (!this.busy) location.reload(); });
    this.element('result-continue').addEventListener('click', () => { this.dismissResult(); this.element('start').focus(); });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); if (this.deleting) return; if (this.pendingDeletion) this.dismissConfirmation(); else this.close(); });
    this.element('preview').addEventListener('click', () => { void (this.loaded ? this.loadRecent() : this.load()); });
    this.element('full').addEventListener('click', () => { void this.load(); });
    this.element('end').addEventListener('change', () => { this.defaultEnd = false; });
    for (const id of ['stop', 'deleting-stop']) this.element(id).addEventListener('click', () => {
      this.controller?.abort();
      if (this.deleting) {
        this.element('deleting-title').textContent = '正在停止…';
        this.element('deleting-status').textContent = '等待目前已送出的刪除完成，其餘對話會保留。';
        this.element<HTMLButtonElement>('deleting-stop').disabled = true;
      } else this.status('正在停止讀取…');
    });
    for (const id of ['start','end','basis']) this.element(id).addEventListener('change', () => { if (!this.deleting) this.render(); });
    this.element('all').addEventListener('change', () => {
      this.root.querySelectorAll<HTMLInputElement>('#list input').forEach(input => { input.checked = !input.disabled && input.value !== currentChatId() && this.element<HTMLInputElement>('all').checked; });
      this.selectionChanged();
    });
    this.element('delete').addEventListener('click', () => {
      if (this.busy) return;
      const selected = this.selected().map(item => ({ ...item })); if (!selected.length) return;
      this.pendingDeletion = { selected, range: { ...this.range() }, url: location.href };
      this.element('confirm-title').textContent = `刪除 ${selected.length} 筆對話？`;
      const titles = this.element('confirm-titles'); titles.replaceChildren();
      selected.forEach(item => { const title = document.createElement('li'); title.textContent = item.title; titles.append(title); });
      const range = this.pendingDeletion.range;
      this.element('confirm-range').textContent = `${range.basis === 'createdAt' ? '建立日期' : '最後更新日期'}：${range.start} 至 ${range.end}`;
      this.element('confirm-delete').textContent = `刪除 ${selected.length} 筆`;
      this.element('history-view').hidden = true; this.element('confirm-view').hidden = false;
      this.dialog.setAttribute('data-confirm', ''); this.dialog.setAttribute('aria-labelledby', 'confirm-title'); this.dialog.setAttribute('aria-describedby', 'confirm-description');
      this.element('confirm-cancel').focus();
    });
    this.element('confirm-cancel').addEventListener('click', () => this.dismissConfirmation());
    this.element('confirm-delete').addEventListener('click', () => {
      const pending = this.pendingDeletion; if (!pending || this.busy) return;
      void this.remove(pending.selected, pending.range, pending.url);
    });
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')).filter(element => !element.closest('[hidden]') && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && this.root.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && this.root.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }
  private element<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.getElementById(id) as T; }
  private dismissResult(): void {
    this.element('result-view').hidden = true; this.element('history-view').hidden = false;
    this.dialog.setAttribute('aria-labelledby', 'history-title'); this.dialog.removeAttribute('aria-describedby');
  }
  private dismissConfirmation(focus = true): void {
    this.pendingDeletion = null;
    this.element('confirm-view').hidden = true; this.element('history-view').hidden = false;
    this.dialog.removeAttribute('data-confirm'); this.dialog.setAttribute('aria-labelledby', 'history-title'); this.dialog.removeAttribute('aria-describedby');
    this.element('confirm-titles').replaceChildren();
    if (focus) this.element('delete').focus();
  }
  private range(): HistoryRange { return { start: this.element<HTMLInputElement>('start').value, end: this.element<HTMLInputElement>('end').value, basis: this.element<HTMLSelectElement>('basis').value as HistoryRange['basis'] }; }
  private status(message: string, error = false): void { this.element('status').textContent = message; this.element('status').classList.toggle('error', error); }
  private selected(): DatedChat[] {
    const ids = new Set(Array.from(this.root.querySelectorAll<HTMLInputElement>('#list input:checked'), input => input.value));
    return this.matched.filter(item => item.id !== currentChatId() && ids.has(item.id));
  }
  private selectionChanged(): void {
    const count = this.selected().length;
    const selectable = this.matched.filter(item => item.id !== currentChatId()).length;
    this.element('count').textContent = `符合 ${this.matched.length} 筆，已勾選 ${count} 筆。`;
    this.element<HTMLButtonElement>('delete').disabled = this.busy || count === 0;
    this.element('delete').textContent = count ? `刪除 ${count} 筆` : '刪除對話';
    this.element<HTMLInputElement>('all').checked = count > 0 && count === selectable;
    this.element<HTMLInputElement>('all').indeterminate = count > 0 && count < selectable;
  }
  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,select,button').forEach(element => {
      if (!['close', 'stop', 'deleting-stop'].includes(element.id)) element.disabled = busy && (this.deleting || !['start', 'end', 'basis'].includes(element.id));
    });
    this.element('stop').hidden = !busy;
    if (!busy) {
      this.root.querySelectorAll<HTMLInputElement>('#list input').forEach(input => { input.disabled = input.value === currentChatId(); });
      this.selectionChanged();
    }
  }
  private render(): void {
    this.element('list').replaceChildren(); this.matched = [];
    try { this.matched = filterDatedChats(this.all, this.range(), null); }
    catch (error) { this.status((error as Error).message, true); }
    const basis = this.range().basis;
    for (const item of this.matched) {
      const label = document.createElement('label'); label.className = 'chat';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id;
      input.disabled = this.busy || item.id === currentChatId();
      input.addEventListener('change', () => this.selectionChanged());
      const text = document.createElement('span'); text.textContent = `${item.title}${item.id === currentChatId() ? '（目前開啟，無法勾選）' : ''}`;
      const date = document.createElement('small'); date.textContent = new Date(item[basis]!).toLocaleString();
      text.append(date); label.append(input, text); this.element('list').append(label);
    }
    if (this.loaded && !this.matched.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '這段日期沒有對話，請調整日期。'; this.element('list').append(empty); }
    this.element('results').hidden = !this.loaded;
    this.element('preview').textContent = this.loaded ? '更新清單' : '載入對話'; this.selectionChanged();
  }
  private async load(): Promise<void> {
    if (this.busy) return;
    try { dateBounds(this.range()); } catch (error) { this.status((error as Error).message, true); return; }
    const controller = new AbortController(); this.controller = controller; this.setBusy(true); this.status('正在讀取對話日期…');
    this.all = []; this.loaded = false; this.render();
    try {
      this.all = await this.client.list(controller.signal, count => this.status(`已讀取 ${count} 筆對話…`));
      this.loaded = true; this.cacheIdentity = this.client.identity;
      if (!this.dialog.open) return;
      this.render();
      const unknown = this.all.filter(item => item[this.range().basis] === null).length;
      this.status(`已讀取 ${this.all.length} 筆，符合區間 ${this.matched.length} 筆。${unknown ? `其中 ${unknown} 筆缺少日期，已排除。` : ''}`);
    } catch (error) { if (this.dialog.open) this.status(controller.signal.aborted ? '已停止讀取。' : (error as Error).message, true); }
    finally { this.controller = null; this.setBusy(false); if (!this.dialog.open) this.client.clear(); }
  }
  private async loadRecent(): Promise<void> {
    if (this.busy || !this.loaded) return;
    const controller = new AbortController(); this.controller = controller; this.setBusy(true);
    this.status('正在更新最新對話…');
    try {
      const identity = await this.client.connect(controller.signal);
      if (!identity || identity !== this.cacheIdentity) {
        this.all = []; this.loaded = false; this.render();
        this.all = await this.client.list(controller.signal, count => this.status(`正在更新清單，已讀取 ${count} 筆…`));
        this.loaded = true; this.cacheIdentity = this.client.identity;
      } else {
        const recent = await this.client.recent(controller.signal);
        const merged = new Map((recent.complete ? [] : this.all).map(item => [item.id, item]));
        recent.removed.forEach(id => merged.delete(id)); recent.items.forEach(item => merged.set(item.id, item));
        this.all = Array.from(merged.values());
      }
      if (!this.dialog.open || controller.signal.aborted) return;
      this.render();
      this.status(`最新對話已更新，共 ${this.all.length} 筆。`);
    } catch (error) { if (this.dialog.open) this.status(controller.signal.aborted ? '已停止更新。' : (error as Error).message, true); }
    finally { this.controller = null; this.setBusy(false); if (!this.dialog.open) this.client.clear(); }
  }
  private async remove(selected: DatedChat[], range: HistoryRange, url: string): Promise<void> {
    if (this.busy) return;
    if (url !== location.href) { this.dismissConfirmation(); this.status('目前對話已切換，請重新確認刪除項目。', true); return; }
    this.dismissConfirmation(false);
    const controller = new AbortController(); this.controller = controller; this.deleting = true; this.setBusy(true);
    this.element('history-view').hidden = true; this.element('deleting-view').hidden = false;
    this.element('deleting-title').textContent = '刪除中…';
    this.element('deleting-status').textContent = `已完成 0／${selected.length} 筆，正在刪除…`;
    const progress = this.element<HTMLProgressElement>('deleting-progress'); progress.max = selected.length; progress.value = 0;
    this.element<HTMLButtonElement>('deleting-stop').disabled = false;
    this.dialog.setAttribute('aria-labelledby', 'deleting-title'); this.dialog.setAttribute('aria-describedby', 'deleting-status');
    this.element('deleting-title').focus();
    this.element('refresh-history').hidden = true;
    const removed: string[] = [];
    try {
      await this.client.remove(selected, range, controller.signal, count => {
        removed.push(selected[count - 1].id);
        this.status(`已刪除 ${count}／${selected.length} 筆。`);
        progress.value = count;
        if (!controller.signal.aborted) this.element('deleting-status').textContent = `已完成 ${count}／${selected.length} 筆，正在刪除…`;
      });
      this.status(`已刪除 ${removed.length} 筆對話。`);
      if (this.dialog.open) {
        this.element('result-description').textContent = `已刪除 ${removed.length} 筆對話。`;
        this.element('history-view').hidden = true; this.element('result-view').hidden = false;
        this.dialog.setAttribute('aria-labelledby', 'result-title'); this.dialog.setAttribute('aria-describedby', 'result-description');
        this.element('result-title').focus();
      }
    } catch (error) {
      this.dismissResult();
      this.status(`${removed.length ? `已刪除 ${removed.length} 筆。` : ''}${(error as Error).message}`, true);
    }
    finally {
      this.element('deleting-view').hidden = true;
      this.all = this.all.filter(item => !removed.includes(item.id));
      this.element('refresh-history').hidden = removed.length === 0;
      this.controller = null; this.deleting = false; this.setBusy(false); this.render();
      if (this.dialog.open && !this.element('history-view').hidden) this.element('start').focus();
      if (!this.dialog.open) this.client.clear();
    }
  }
  public open(anchor: HTMLElement): void {
    if (this.deleting) return;
    this.anchor = anchor; applyTheme(this.host);
    this.dismissResult();
    this.element('deleting-view').hidden = true;
    if (this.defaultEnd) this.element<HTMLInputElement>('end').value = localDate(new Date());
    if (!this.dialog.open) this.dialog.showModal();
    if (this.loaded) void this.loadRecent(); else void this.load();
    this.element('start').focus();
  }
  public close(): void {
    this.dismissConfirmation(false);
    this.dismissResult();
    this.controller?.abort(); this.dialog.close(); this.client.clear();
    this.anchor?.focus();
    if (!this.busy) { this.render(); this.element('results').hidden = true; this.status(''); }
  }
  public destroy(): void { this.pendingDeletion = null; this.controller?.abort(); this.client.clear(); this.dialog.close(); this.host.remove(); }
}
