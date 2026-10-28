export const actionStyles = `
  :host{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252525;color-scheme:light;--surface:#fff;--fg:#252525;--muted:#5b5b5b;--line:#d5d5d5;--hover:#efefef;--accent:#23713b;--danger:#b52b2b}
  :host([data-theme=dark]){color-scheme:dark;--surface:#242424;--fg:#f1f1f1;--muted:#bbb;--line:#555;--hover:#383838;--accent:#81ce9a;--danger:#ff9595}
  *{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}button{cursor:pointer;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:7px 10px;min-height:36px}button:hover{background:var(--hover)}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  .icon{display:inline-grid;place-items:center;width:34px;height:34px;min-height:34px;padding:7px;border:0;border-radius:8px;background:transparent;color:var(--fg)}svg{display:block;width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .menu{position:fixed;z-index:2147483646;width:260px;max-width:calc(100vw - 24px);max-height:min(360px,calc(100dvh - 24px));overflow:auto;padding:5px;background:var(--surface);color:var(--fg);box-shadow:0 5px 25px #0004;border-radius:9px;user-select:none;text-align:left}.menu button{display:block;border:0;text-align:left;width:100%;background:transparent;overflow-wrap:anywhere}.menu button:hover,.menu button:focus-visible{background:var(--hover)}.menu small{display:block;color:var(--muted);padding:7px;font-size:12px}
  .notice{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:10px 16px;z-index:2147483646;background:var(--surface);color:var(--fg);box-shadow:0 4px 20px #0003;border-radius:8px}
`;

export const exportIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></svg>';
export const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/></svg>';

export function applyTheme(host: HTMLElement): void {
  const dark = document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark' || document.documentElement.style.colorScheme === 'dark';
  host.dataset.theme = dark ? 'dark' : 'light';
}

export function placeMenu(menu: HTMLElement, anchor: HTMLElement): void {
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(rect.right - box.width, window.innerWidth - box.width - 12))}px`;
  const top = rect.top >= box.height + 20 ? rect.top - box.height - 8 : rect.bottom + 8;
  menu.style.top = `${Math.max(12, Math.min(top, window.innerHeight - box.height - 12))}px`;
}

export function wireMenu(menu: HTMLElement, close: () => void): void {
  menu.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current = buttons.indexOf((event.target as HTMLButtonElement));
    if (key === 'Escape') { event.preventDefault(); close(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key) && buttons.length) {
      event.preventDefault();
      const next = key === 'Home' ? 0 : key === 'End' ? buttons.length - 1 : (current + (key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  });
}
