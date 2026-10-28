import type { IAvatarOverlay } from '@/common/interfaces';
import { AVATAR_OVERLAY_ID, AVATAR_IMAGE_ID, clampAvatarSize, DEFAULT_AVATAR_SIZE, STORAGE_KEY_DISPLAY, avatarPositionKey } from '@/common/constants';
import { TargetSite } from '@/common/types';
import { AvatarTools, type ResizeCorner } from './AvatarTools';

interface PointerOperation {
  kind: 'drag' | 'resize';
  id: number;
  x: number;
  y: number;
  left: number;
  top: number;
  size: number;
  corner?: ResizeCorner;
  moved: boolean;
  positioned: boolean;
}

export class AvatarOverlay implements IAvatarOverlay {
  private container: HTMLDivElement | null = null;
  private image: HTMLImageElement | null = null;
  private tools: AvatarTools | null = null;
  private toolsHost: HTMLElement | null = null;
  private size = DEFAULT_AVATAR_SIZE;
  private pointer: PointerOperation | null = null;
  private suppressDoubleClick = false;

  constructor(private site: TargetSite = TargetSite.CHATGPT) {
    if (document.getElementById(AVATAR_OVERLAY_ID)) return;
    this.container = document.createElement('div');
    this.container.id = AVATAR_OVERLAY_ID;
    this.container.tabIndex = 0;
    this.container.setAttribute('role', 'group');
    this.container.setAttribute('aria-label', '角色：雙擊重看教學；拖曳移動；移到邊框或聚焦角落可調整大小');
    this.container.title = '雙擊角色重看教學；拖曳移動；拖曳角落縮放';
    // The avatar remains draggable over the outline, below action menus and the tour bubble.
    Object.assign(this.container.style, { position: 'fixed', bottom: '20px', right: '20px', width: '128px', height: '128px', zIndex: '2147483643', cursor: 'move', userSelect: 'none', touchAction: 'none', opacity: '1' });
    this.image = document.createElement('img'); this.image.id = AVATAR_IMAGE_ID; this.image.alt = 'AI Avatar'; this.image.draggable = false;
    Object.assign(this.image.style, { width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' });
    this.toolsHost = document.createElement('div');
    this.container.append(this.image, this.toolsHost); document.body.append(this.container);
    this.tools = new AvatarTools(this.toolsHost, (corner, event) => this.beginResize(corner, event), delta => { this.setSize(this.size + delta); void this.persistDisplay(true); });
    this.container.addEventListener('mouseenter', this.handleEnter);
    this.container.addEventListener('mouseleave', this.handleLeave);
    this.container.addEventListener('dblclick', this.handleDoubleClick);
    this.container.addEventListener('keydown', this.handleKey);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('ai-avatar-composer-layout', this.handleResize);
  }

  public show(): void { if (this.container) { this.container.style.opacity = '1'; this.container.style.visibility = 'visible'; this.container.style.pointerEvents = 'auto'; this.container.tabIndex = 0; } }
  public hide(): void { if (this.container) { this.container.style.opacity = '0'; this.container.style.visibility = 'hidden'; this.container.style.pointerEvents = 'none'; this.container.tabIndex = -1; } }
  public setImage(imageUrl: string): void { if (this.image) this.image.src = imageUrl; }
  public setPosition(x: number, y: number): void {
    if (!this.container) return;
    this.container.style.left = `${Math.max(0, Math.min(x, window.innerWidth - this.size))}px`;
    this.container.style.top = `${Math.max(0, Math.min(y, window.innerHeight - this.size))}px`;
    this.container.style.right = 'auto'; this.container.style.bottom = 'auto';
  }
  public restorePosition(value: unknown): void {
    const position = value as { x?: unknown; y?: unknown } | null;
    if (typeof position?.x === 'number' && Number.isFinite(position.x) && position.x >= 0 && typeof position.y === 'number' && Number.isFinite(position.y) && position.y >= 0) {
      this.setPosition(position.x, position.y);
    } else if (this.container) {
      this.container.style.left = ''; this.container.style.top = ''; this.container.style.right = '20px';
      this.setSize(this.size);
    }
  }
  public setSize(value: number): void {
    this.size = Math.min(clampAvatarSize(value), Math.max(64, window.innerWidth - 16), Math.max(64, window.innerHeight - 16));
    if (!this.container) return;
    this.container.style.width = `${this.size}px`; this.container.style.height = `${this.size}px`;
    if (this.container.style.left) this.setPosition(parseFloat(this.container.style.left), parseFloat(this.container.style.top));
    else {
      // Keep the default position clear of the native composer; user-dragged positions stay explicit.
      const input = document.querySelector('#prompt-textarea, rich-textarea, .ql-editor[contenteditable="true"]');
      const composer = input?.closest('form, [data-testid="composer"], #composer-background, .input-area-container')?.getBoundingClientRect();
      const left = window.innerWidth - this.size - 20;
      const overlaps = composer && composer.width > 0 && composer.top > 0 && composer.right > left && composer.left < left + this.size && composer.bottom > window.innerHeight - this.size - 20;
      this.container.style.bottom = `${overlaps ? Math.max(20, window.innerHeight - composer.top + 16) : 20}px`;
    }
    this.tools?.setSize(this.size);
  }

  private handleEnter = (): void => this.tools?.setHover(true);
  private handleLeave = (): void => { if (!this.pointer) this.tools?.setHover(false); };
  private handleResize = (): void => this.setSize(this.size);
  private handleDoubleClick = (event: MouseEvent): void => {
    if (this.suppressDoubleClick || this.pointer?.moved || (this.toolsHost && event.composedPath().includes(this.toolsHost))) return;
    event.preventDefault(); event.stopPropagation();
    window.dispatchEvent(new Event('ai-avatar-start-tour'));
  };
  private handleKey = (event: KeyboardEvent): void => {
    if (event.target !== this.container || event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    window.dispatchEvent(new Event('ai-avatar-start-tour'));
  };

  public enableDragging(): void {
    this.container?.addEventListener('pointerdown', this.handleStart);
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleEnd);
    document.addEventListener('pointercancel', this.handleCancel);
  }
  public disableDragging(): void {
    this.container?.removeEventListener('pointerdown', this.handleStart);
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleEnd);
    document.removeEventListener('pointercancel', this.handleCancel);
    this.pointer = null;
  }
  private operation(kind: 'drag' | 'resize', event: PointerEvent, corner?: ResizeCorner): void {
    if (!this.container || event.button !== 0 || this.pointer) return;
    const rect = this.container.getBoundingClientRect();
    this.pointer = { kind, id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, size: this.size, corner, moved: false, positioned: !!this.container.style.left };
    this.tools?.setHover(true);
    // A click must retain its native mouse/double-click sequence. Capture only after movement.
    if (kind === 'resize') this.capturePointer(event.pointerId);
  }
  private capturePointer(id: number): void { try { this.container?.setPointerCapture(id); } catch { /* Document listeners still handle pointer release. */ } }
  private beginResize(corner: ResizeCorner, event: PointerEvent): void { this.operation('resize', event, corner); }
  private handleStart = (event: PointerEvent): void => {
    if (this.toolsHost && event.composedPath().includes(this.toolsHost)) return;
    this.operation('drag', event);
  };
  private handleMove = (event: PointerEvent): void => {
    const start = this.pointer;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    if (!start.moved) this.capturePointer(event.pointerId);
    start.moved = true;
    if (start.kind === 'drag') { this.setPosition(start.left + dx, start.top + dy); return; }
    const west = start.corner!.includes('w'); const north = start.corner!.includes('n');
    const changeX = dx * (west ? -1 : 1); const changeY = dy * (north ? -1 : 1);
    const delta = Math.abs(changeX) > Math.abs(changeY) ? changeX : changeY;
    const limit = Math.min(west ? start.left + start.size : window.innerWidth - start.left, north ? start.top + start.size : window.innerHeight - start.top);
    this.setSize(Math.min(limit, clampAvatarSize(start.size + delta)));
    this.setPosition(west ? start.left + start.size - this.size : start.left, north ? start.top + start.size - this.size : start.top);
  };
  private handleEnd = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    const save = this.pointer.moved; const resized = this.pointer.kind === 'resize';
    this.suppressDoubleClick = save || resized;
    this.pointer = null;
    this.tools?.setHover(this.container?.matches(':hover') || false);
    if (save) void this.persistDisplay(resized);
  };
  private handleCancel = (event: PointerEvent): void => {
    const start = this.pointer;
    if (!start || start.id !== event.pointerId) return;
    this.pointer = null;
    this.setSize(start.size);
    this.suppressDoubleClick = true;
    if (start.positioned) this.setPosition(start.left, start.top); else this.restorePosition(null);
  };
  private async persistDisplay(saveSize: boolean): Promise<void> {
    const values: Record<string, unknown> = {};
    if (saveSize) values[STORAGE_KEY_DISPLAY] = { size: this.size };
    if (this.container?.style.left) values[avatarPositionKey(this.site)] = { x: parseFloat(this.container.style.left), y: parseFloat(this.container.style.top) };
    try { await chrome.storage.local.set(values); this.tools?.showError(''); }
    catch { this.tools?.showError('角色位置或大小未能儲存，請重新載入擴充功能後重試。'); }
  }
  public destroy(): void {
    this.disableDragging(); window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('ai-avatar-composer-layout', this.handleResize);
    this.tools?.destroy(); this.container?.remove(); this.container = null; this.image = null;
  }
}
