import { actionStyles, applyTheme } from '@/common/actionUi';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/** Avatar controls; conversation actions stay visible independently. */
export class AvatarTools {
  private root: ShadowRoot;

  constructor(
    public readonly host: HTMLElement,
    onResize: (corner: ResizeCorner, event: PointerEvent) => void,
    onKeyboardResize: (delta: number) => void
  ) {
    host.dataset.aiAvatarUi = '';
    this.root = host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${actionStyles}
      :host{position:absolute;inset:0;pointer-events:none;cursor:auto;--resize-line:rgba(128,128,128,.18);--resize-handle:rgba(128,128,128,.5);--resize-focus:#767676}
      :host([data-theme=dark]){--resize-line:rgba(200,200,200,.16);--resize-handle:rgba(184,184,184,.5);--resize-focus:#b0b0b0}
      .frame{position:absolute;inset:0;border:1px solid var(--resize-line);border-radius:9px;opacity:0;pointer-events:none}
      :host([data-hover]) .frame,:host(:focus-within) .frame{opacity:1}
      .handle{position:absolute;display:grid;place-items:center;width:20px;height:20px;min-height:20px;border:0;border-radius:50%;background:transparent;padding:0;pointer-events:none;opacity:0}
      .handle::after{content:'';width:6px;height:6px;border:1px solid var(--resize-handle);border-radius:50%;background:var(--surface)}
      .handle:hover{background:transparent}.handle:hover::after,.handle:focus-visible::after{background:var(--resize-focus)}
      .handle:focus-visible{outline:2px solid var(--resize-focus);outline-offset:2px}
      :host([data-hover]) .handle,:host(:focus-within) .handle{pointer-events:auto;opacity:1}
      .nw{left:-10px;top:-10px;cursor:nwse-resize}.ne{right:-10px;top:-10px;cursor:nesw-resize}.sw{left:-10px;bottom:-10px;cursor:nesw-resize}.se{right:-10px;bottom:-10px;cursor:nwse-resize}
      .resize-error{position:absolute;bottom:100%;right:0;width:220px;background:var(--surface);color:var(--danger);font-size:12px;padding:6px}
    </style><div class="frame" aria-hidden="true"></div>
    ${(['nw','ne','sw','se'] as ResizeCorner[]).map((corner, index) => `<button type="button" class="handle ${corner}" data-corner="${corner}" aria-label="拖曳${['左上','右上','左下','右下'][index]}角調整角色大小" title="拖曳縮放；方向鍵每次調整 8 px"></button>`).join('')}
    <p class="resize-error" id="error" role="status" hidden></p>`;
    applyTheme(host);
    this.root.querySelectorAll<HTMLButtonElement>('.handle').forEach(button => {
      button.addEventListener('pointerdown', event => { event.stopPropagation(); event.preventDefault(); onResize(button.dataset.corner as ResizeCorner, event); });
      button.addEventListener('keydown', event => {
        if (['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          onKeyboardResize(['ArrowUp','ArrowRight'].includes(event.key) ? 8 : -8);
        }
      });
    });
  }

  public setHover(hover: boolean): void { if (hover) applyTheme(this.host); this.host.toggleAttribute('data-hover', hover); }
  public showError(message: string): void {
    const error = this.root.getElementById('error')!;
    error.textContent = message; error.hidden = !message;
  }
  public setSize(size: number): void {
    this.root.querySelectorAll('.handle').forEach(button => button.setAttribute('aria-description', `目前 ${size} px，方向鍵可調整大小`));
  }
  public destroy(): void { this.host.remove(); }
}
