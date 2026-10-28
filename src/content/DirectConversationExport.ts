import { TargetSite } from '@/common/types';
import { captureConversation, exportSnapshot, getMessageElement, type ExportFormat } from './ConversationExport';
import { readCurrentConversation } from './ConversationReader';

export const EXPORT_FORMAT_KEY = 'conversationExportFormat';
interface FullExport {
  controller: AbortController; url: string; button: HTMLButtonElement;
  printWindow?: Window; title: string;
}

/** Download from the current page without opening selection or format dialogs. */
export class DirectConversationExport {
  private active: FullExport | null = null;
  constructor(private site: TargetSite, private format: () => ExportFormat, private notify: (message: string, pending?: boolean) => void) {}

  public answer(element: HTMLElement): void {
    try {
      const snapshot = captureConversation(this.site);
      const answers = snapshot.messages.filter(message => message.role === 'assistant');
      const message = answers.find(item => getMessageElement(item) === element && element.isConnected);
      if (!message) throw new Error('這則回答已更新或聊天已切換，請使用目前回答下方的下載按鈕。');
      if (element.closest('[data-is-streaming="true"]') || element.querySelector('[data-is-streaming="true"]')) throw new Error('回答仍在產生，請等完成後再下載。');
      exportSnapshot({ ...snapshot, messages: [message] }, this.format(), `回答-${answers.indexOf(message) + 1}`);
      this.success();
    } catch (error) { this.notify((error as Error).message); }
  }

  public async all(button: HTMLButtonElement): Promise<void> {
    this.cancelIfNavigated();
    if (button.disabled || this.active) return;
    const format = this.format();
    if (this.site !== TargetSite.CHATGPT) {
      try { exportSnapshot(captureConversation(this.site), format); this.success(format); }
      catch (error) { this.notify((error as Error).message); }
      return;
    }
    if (!/\/c\/[\w-]+\/?$/.test(location.pathname)) {
      this.notify('這個聊天尚未儲存，請等聊天網址出現後再下載完整對話。'); return;
    }
    if (document.querySelector('[data-is-streaming="true"]')) {
      this.notify('回答仍在產生，請等完成後再下載完整對話。'); return;
    }
    const controller = new AbortController();
    const operation: FullExport = { controller, url: location.href, button, title: button.title };
    this.active = operation;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    button.title = '正在取得完整對話…';
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      // Reserve the native print window during the click, before reading the full chat.
      if (format === 'pdf') {
        operation.printWindow = window.open('', '_blank', 'popup,width=960,height=800') || undefined;
        if (!operation.printWindow) throw new Error('列印視窗被封鎖，請允許後重試，或改用 Markdown／HTML。');
        operation.printWindow.opener = null;
      }
      this.notify('正在取得完整對話，完成後會自動下載，不需要往上捲動…', true);
      const conversation = await readCurrentConversation(operation.url, controller.signal);
      if (this.active !== operation || controller.signal.aborted) return;
      exportSnapshot({ ...conversation, scope: 'full' }, format, '對話', operation.printWindow);
      operation.printWindow = undefined;
      this.success(format, conversation.messages.length);
    } catch (error) {
      operation.printWindow?.close();
      if (this.active === operation) this.notify(controller.signal.aborted ? '完整對話讀取逾時，未下載檔案，請稍後重試。' : `無法匯出完整對話，未下載檔案：${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
      if (this.active === operation) { this.restoreButton(operation); this.active = null; }
    }
  }

  public cancelIfNavigated(): void {
    if (this.active && this.active.url !== location.href) {
      this.destroy(); this.notify('聊天已切換，已取消完整對話匯出。');
    }
  }
  private restoreButton(operation: FullExport): void {
    operation.button.disabled = false; operation.button.removeAttribute('aria-busy'); operation.button.title = operation.title;
  }
  private success(format = this.format(), count?: number): void {
    const complete = count === undefined ? '' : `完整對話（${count} 則訊息）`;
    this.notify(format === 'pdf' ? `已取得${complete || '內容'}並開啟列印視窗，請選「另存為 PDF」。` : `已開始下載${complete} ${format === 'html' ? 'HTML' : 'Markdown'}。`);
  }
  public destroy(): void {
    if (!this.active) return;
    const operation = this.active; this.active = null;
    operation.controller.abort(); operation.printWindow?.close(); this.restoreButton(operation);
  }
}
