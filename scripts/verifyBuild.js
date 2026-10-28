import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Window } from 'happy-dom';

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
for (const file of ['background.js', 'contentScript.js', 'options.js', 'options.html']) assert.ok(existsSync(`dist/${file}`), `Missing ${file}`);
// Build an import fixture from the original avatars; no personal pack is needed.
const states = ['idle', 'idle2', 'idle3', 'thinking', 'happy', 'sad', 'excited', 'confused', 'angry', 'surprised', 'worried', 'neutral'];
const pack = { format: 'ai-avatar-pack', version: 1, name: 'Fixture avatar pack', images: Object.fromEntries(states.map(state => [state, 'data:image/svg+xml;base64,' + readFileSync(`dist/assets/avatar/${state}.svg`).toString('base64')])) };
const packText = JSON.stringify(pack);
assert.equal(manifest.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
assert.equal(manifest.options_page, 'options.html');
assert.ok(manifest.action?.default_title && !manifest.action.default_popup);
for (const icon of Object.values(manifest.action.default_icon)) assert.ok(existsSync(`dist/${icon}`));
console.log('PASS: packaged entry points, matching version, original avatar assets');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (test()) return; await pause(20); }
  throw new Error('Built extension did not reach the expected state.');
}

for (const site of ['chatgpt', 'gemini']) {
  const window = new Window({ url: site === 'chatgpt' ? 'https://chatgpt.com/c/current' : 'https://gemini.google.com/app/current', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const windows = [window];
  const changes = [];
  const listeners = [];
  const actionListeners = [];
  let optionsOpenCount = 0;
  const local = {};
  const sync = {};
  const downloads = [];
  const blobs = new Map();
  const area = (store, name) => ({
    get(_keys, callback) { if (callback) callback({ ...store }); else return Promise.resolve({ ...store }); },
    async set(values) {
      const event = {};
      for (const [key, value] of Object.entries(values)) { event[key] = { oldValue: store[key], newValue: value }; store[key] = value; }
      changes.forEach(listener => listener(event, name));
    },
    async remove(keys) {
      const event = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) { event[key] = { oldValue: store[key] }; delete store[key]; }
      changes.forEach(listener => listener(event, name));
    },
  });
  const chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      lastError: null,
      onMessage: { addListener: listener => listeners.push(listener) },
      sendMessage(message, callback) { listeners[0](message, {}, callback ?? (() => {})); },
      openOptionsPage: async () => { optionsOpenCount++; },
    },
    action: { onClicked: { addListener: listener => actionListeners.push(listener) } },
    storage: {
      sync: area(sync, 'sync'), local: area(local, 'local'),
      onChanged: { addListener: listener => changes.push(listener), removeListener() {} },
    },
  };
  window.chrome = chrome;
  window.URL.createObjectURL = blob => { const id = `blob:test-${blobs.size}`; blobs.set(id, blob); return id; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); };
  const response = (role, text) => {
    const element = window.document.createElement('div');
    if (site === 'chatgpt') element.setAttribute('data-message-author-role', role);
    else element.className = role === 'user' ? 'user-query' : 'model-response-text';
    element.textContent = text;
    return element;
  };
  try {
    window.document.body.append(response('user', '問題'), response('assistant', 'Hello there'));
    window.document.body.insertAdjacentHTML('beforeend', site === 'chatgpt'
      ? '<div class="new-composer"><div><div id="prompt-textarea" contenteditable="true"></div></div><div><button type="button" aria-label="Send prompt">傳送</button></div></div>'
      : '<form><div id="prompt-textarea" contenteditable="true"></div><button type="button" data-testid="composer-speech-button">語音</button></form>');
    if (site === 'gemini') window.document.querySelector('#prompt-textarea').className = 'ql-editor';
    if (site === 'chatgpt') window.document.body.insertAdjacentHTML('afterbegin', '<header><button type="button" data-testid="share-chat-button">分享</button></header><nav><h2>最近項目</h2><div><a href="/c/current">目前對話</a></div><div><a href="/c/older">較舊對話</a></div></nav>');
    window.eval(readFileSync('dist/background.js', 'utf8'));
    assert.equal(listeners.length, 1);
    // A click must work immediately, before asynchronous configuration loading completes.
    assert.equal(actionListeners.length, 1); actionListeners[0]();
    assert.equal(optionsOpenCount, 1);
    await until(() => listeners.length === 1);
    console.log('PASS: toolbar action registered synchronously and opens the declared options page');
    window.eval(readFileSync('dist/contentScript.js', 'utf8'));
    await until(() => !!window.document.querySelector('#ai-avatar-img')?.src);
    await pause(150);
    const overlay = window.document.getElementById('ai-avatar-overlay');
    const avatar = window.document.getElementById('ai-avatar-img');
    const tools = overlay.lastElementChild.shadowRoot;

    await until(() => !!window.document.getElementById('ai-avatar-onboarding'));
    const firstGuide = window.document.getElementById('ai-avatar-onboarding').shadowRoot;
    assert.ok(avatar.src.endsWith('/happy.svg'));
    assert.equal(firstGuide.querySelector('img, [role=dialog]'), null);
    assert.ok(firstGuide.querySelector('[role=region]'));
    firstGuide.getElementById('skip').click(); assert.equal(window.document.getElementById('ai-avatar-onboarding'), null);
    assert.equal(tools.querySelector('.help'), null);
    assert.equal(tools.querySelectorAll('.handle').length, 4);
    assert.match(avatar.src, /assets\/avatar\/idle[23]?\.svg$/);
    overlay.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    const replayGuide = window.document.getElementById('ai-avatar-onboarding').shadowRoot;
    replayGuide.getElementById('next').click();
    if (site === 'chatgpt') replayGuide.getElementById('next').click();
    replayGuide.getElementById('action').click();
    const tourMenu = window.document.getElementById('ai-avatar-page-menu').shadowRoot.querySelector('.menu');
    assert.equal(tourMenu.hidden, false); assert.equal(downloads.length, 0);
    tourMenu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    for (let step = 0; step < 6 && window.document.getElementById('ai-avatar-onboarding'); step++) replayGuide.getElementById('next').click();
    assert.equal(window.document.getElementById('ai-avatar-onboarding'), null);
    await until(() => local.avatarOnboardingV1?.completed === true);
    console.log(`PASS: ${site} first-use expression guide -> skip -> double-click avatar bubble replay -> real format menu without downloading -> completion persisted`);
    assert.equal(tools.querySelector('.toggle, #tools-panel, #avatar-menu'), null);
    assert.equal(window.document.getElementById('ai-avatar-composer-export').style.display, 'inline-flex');
    overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(window.document.getElementById('ai-avatar-composer-export').style.display, 'inline-flex');
    if (site === 'chatgpt') {
      const host = window.document.getElementById('ai-avatar-composer-export');
      assert.equal(host.nextElementSibling.getAttribute('data-testid'), 'share-chat-button');
      assert.equal(window.document.getElementById('ai-avatar-date-delete').parentElement, window.document.body);
      assert.equal(window.document.querySelector('nav h2').style.cssText, '');
      const outline = window.document.getElementById('ai-avatar-question-outline');
      assert.equal(outline.parentElement, window.document.body);
      assert.equal(window.document.querySelector('nav #ai-avatar-question-outline'), null);
      assert.equal(outline.shadowRoot.querySelectorAll('nav button').length, 1);
      assert.ok(outline.shadowRoot.querySelector('summary').textContent.includes('問題'));
      window.document.querySelector('header').remove();
      await until(() => !!window.document.querySelector('[data-fallback]'));
      const fallback = window.document.getElementById('ai-avatar-composer-export');
      assert.equal(fallback.parentElement, window.document.body); assert.equal(fallback.style.display, 'inline-flex');
      assert.equal(fallback.querySelector('button').textContent, '下載');
      window.document.body.insertAdjacentHTML('beforeend', '<header id="thread-header"><button type="button" data-testid="share-chat-button">分享</button></header>');
      await until(() => fallback.parentElement?.id === 'thread-header');
      assert.equal(window.document.getElementById('ai-avatar-composer-export'), fallback);
      assert.equal(fallback.hasAttribute('data-fallback'), false);
      console.log('PASS: export before Share -> header replacement -> top-right fallback -> remount; deletion outside native hover row');
    }
    overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(window.document.getElementById('ai-avatar-composer-export').style.display, 'inline-flex');
    overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    tools.querySelector('.se').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(overlay.style.width, '136px'); assert.equal(local.avatarDisplay.size, 136);
    // Separate the navigation fixture from a later reply (the response watcher throttles mutations for 300 ms).
    await pause(350);
    window.document.body.append(response('assistant', 'excellent wonderful fantastic'));
    await until(() => avatar.src.endsWith('/happy.svg'));
    const exportButton = window.document.getElementById('ai-avatar-composer-export').querySelector('button');
    const formatMenu = window.document.getElementById('ai-avatar-page-menu').shadowRoot.querySelector('.menu');
    const download = (format, button = exportButton) => { button.click(); formatMenu.querySelector(`[data-format="${format}"]`).click(); };
    if (site === 'chatgpt') window.fetch = async url => ({ ok: true, json: async () => String(url).endsWith('/api/auth/session') ? { accessToken: 'fixture-complete-token' } : {
      conversation_id: 'current', title: '完整對話下載測試', current_node: 'a2', mapping: {
        old: { parent: null, message: { author: { role: 'user' }, content: { parts: ['頁面未顯示的早期問題'] } } },
        u: { parent: 'old', message: { author: { role: 'user' }, content: { parts: ['問題'] } } },
        a1: { parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['Hello there'] } } },
        a2: { parent: 'a1', message: { author: { role: 'assistant' }, content: { parts: ['excellent wonderful fantastic'] } } },
      },
    } });
    exportButton.click();
    assert.equal(downloads.length, 0); assert.equal(formatMenu.hidden, false);
    formatMenu.querySelector('[data-format="markdown"]').click();
    assert.equal(window.document.getElementById('ai-avatar-export-dialog'), null);
    await until(() => downloads.length === 1);
    assert.equal(downloads.length, 1);
    const exported = await downloads[0].blob.text();
    assert.ok(exported.includes('問題') && exported.includes('excellent wonderful fantastic'));
    if (site === 'chatgpt') {
      assert.ok(exported.includes('頁面未顯示的早期問題'));
      assert.ok(exported.includes('4 則訊息（目前聊天完整分支）'));
      assert.equal(window.document.body.textContent.includes('頁面未顯示的早期問題'), false);
      assert.ok(!JSON.stringify(local).includes('fixture-complete-token'));
      console.log('PASS: complete ChatGPT download includes earlier messages absent from the page, without scrolling');
    }
    await until(() => window.document.querySelectorAll('[data-ai-avatar-answer-download]').length === 2);
    const answerButtons = window.document.querySelectorAll('[data-ai-avatar-answer-download]');
    download('html', answerButtons[1].shadowRoot.querySelector('button'));
    assert.equal(downloads.length, 2);
    const selectedHtml = await downloads[1].blob.text();
    assert.ok(selectedHtml.startsWith('<!doctype html>') && selectedHtml.includes('excellent wonderful fantastic') && !selectedHtml.includes('Hello there'));
    assert.ok(downloads[1].filename.endsWith('.html'));
    assert.equal(window.document.getElementById('ai-avatar-message-picker'), null);
    console.log('PASS: Download text button -> click-only format menu -> complete chat / selected answer download');
    const printWindow = new Window({ url: 'https://export.test/', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } }); windows.push(printWindow);
    // Supply the native properties missing or read-only in Happy DOM's popup mock.
    Object.defineProperty(printWindow.document, 'fonts', { get: () => ({ ready: Promise.resolve() }) });
    Object.defineProperty(printWindow, 'opener', { value: null, writable: true });
    let printed = false; printWindow.print = () => { printed = true; }; printWindow.focus = () => {}; window.open = () => printWindow;
    download('pdf');
    await until(() => printed); assert.ok(printWindow.document.body.textContent.includes('問題'));
    assert.ok(!printWindow.document.getElementById('ai-avatar-overlay'));
    assert.equal(!!window.document.getElementById('ai-avatar-date-delete'), site === 'chatgpt');

    if (site === 'chatgpt') {
      const beforeFailure = downloads.length;
      window.fetch = async () => ({ ok: false, status: 401 });
      download('markdown'); await until(() => !exportButton.disabled);
      assert.equal(downloads.length, beforeFailure);
      assert.ok(window.document.getElementById('ai-avatar-page-menu').shadowRoot.querySelector('.notice').textContent.includes('未下載檔案'));
      console.log('PASS: failed complete read does not silently download the partial on-page conversation');
      window.document.querySelectorAll('[data-message-author-role]').forEach(element => element.remove());
      window.document.body.insertAdjacentHTML('beforeend', '<main><div class="unrecognized-user"><p>網站讀取問題</p></div></main>');
      window.fetch = async url => ({ ok: true, json: async () => String(url).endsWith('/api/auth/session') ? { accessToken: 'fixture-read-token' } : {
        conversation_id: 'current', title: '網站資料讀取', current_node: 'a', mapping: {
          u: { parent: null, message: { author: { role: 'user' }, content: { parts: ['網站讀取問題'] } } },
          a: { parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['網站讀取回答'] } } },
        },
      } });
      download('markdown');
      await until(() => !exportButton.disabled);
      assert.ok((await downloads[downloads.length - 1].blob.text()).includes('網站讀取回答'));
      assert.ok(!JSON.stringify(local).includes('fixture-read-token'));
      console.log('PASS: unrecognized message DOM -> same-chat authenticated read -> selected branch Markdown export');
      const outlineRoot = window.document.getElementById('ai-avatar-question-outline').shadowRoot;
      await until(() => outlineRoot.querySelectorAll('nav button').length === 1 && outlineRoot.querySelector('nav').textContent.includes('網站讀取問題'));
      assert.ok(outlineRoot.querySelector('nav').textContent.includes('網站讀取問題'));
      let jumped = false; window.document.querySelector('.unrecognized-user p').scrollIntoView = () => { jumped = true; };
      outlineRoot.querySelector('nav button').click(); assert.equal(jumped, true);
      console.log('PASS: role-free message DOM -> saved questions -> real-text anchor -> question navigation, no zero-count placeholder');
      const main = window.document.querySelector('main');
      main.style.cssText = 'max-width:800px;margin:auto;padding:0 24px';
      const originalStyle = main.style.cssText;
      const prefix = '請提供文章，整理成 markdown語法\n\n# Telegram Gemini 記帳機器人：Render 部署與架構優化指南';
      window.fetch = async url => ({ ok: true, json: async () => String(url).endsWith('/api/auth/session') ? { accessToken: 'fixture-collapse-token' } : {
        conversation_id: 'current', current_node: 'u', mapping: {
          u: { parent: 'old', message: { author: { role: 'user' }, content: { parts: [`${prefix}\n\n${'尚未顯示的文章內容。'.repeat(100)}`] } } },
          old: { parent: null, message: { author: { role: 'user' }, content: { parts: ['頁面尚未載入的另一個問題'] } } },
        },
      } });
      main.innerHTML = `<section id="collapsed-question"><div>${prefix}<span>...</span></div><button aria-expanded="false">顯示較多</button></section><div class="markdown">回答</div>`;
      const box = (left, width) => ({ left, right: left + width, top: 100, bottom: 900, width, height: 800 });
      const collapsed = main.querySelector('section');
      const sidebar = window.document.querySelector('nav');
      const mainRect = main.getBoundingClientRect; const sidebarRect = sidebar.getBoundingClientRect;
      main.getBoundingClientRect = () => box(300, 980);
      sidebar.getBoundingClientRect = () => ({ ...box(0, 300), top: 0, height: window.innerHeight });
      collapsed.getBoundingClientRect = () => box(340, 700);
      outlineRoot.getElementById('retry').click();
      await until(() => outlineRoot.querySelectorAll('nav button').length === 2 && outlineRoot.querySelector('nav').textContent.includes('請提供文章'));
      const questionButtons = outlineRoot.querySelectorAll('nav button');
      assert.equal(questionButtons[0].disabled, true); assert.equal(questionButtons[1].disabled, false);
      let collapsedJump = false; collapsed.firstElementChild.scrollIntoView = () => { collapsedJump = true; };
      questionButtons[1].click(); assert.equal(collapsedJump, true);
      assert.equal(collapsed.querySelector('button').getAttribute('aria-expanded'), 'false');
      assert.equal(main.style.cssText, originalStyle);
      assert.equal(window.document.getElementById('ai-avatar-question-outline').hasAttribute('data-compact'), true);
      outlineRoot.querySelector('details').open = true; window.dispatchEvent(new window.Event('resize')); await pause(100);
      assert.equal(main.style.cssText, originalStyle);
      main.getBoundingClientRect = mainRect; sidebar.getBoundingClientRect = sidebarRect;
      console.log('PASS: collapsed long question -> unique prefix jump; unresolved questions stay listed; native conversation styles unchanged');
      await until(() => main.querySelectorAll('[data-ai-avatar-answer-download]').length === 1);
      const singleDownloads = downloads.length;
      download('markdown', main.querySelector('[data-ai-avatar-answer-download]').shadowRoot.querySelector('button'));
      assert.equal(downloads.length, singleDownloads + 1);
      const roleFreeAnswer = await downloads[downloads.length - 1].blob.text();
      assert.ok(roleFreeAnswer.includes('## AI 回答') && !roleFreeAnswer.includes('請提供文章'));
      console.log('PASS: role-free answer body -> individual download button -> selected answer only');
      main.innerHTML = '<div><div id="toolbar-answer"><p>沒有角色標記的完整回答</p><p>第二段也要匯出</p></div><div role="toolbar"><button data-testid="copy-turn-action-button">複製</button><button aria-label="分享">分享</button><button>更多</button></div></div>';
      await until(() => !!main.querySelector('[role="toolbar"] [data-ai-avatar-answer-download]'));
      assert.equal(main.querySelectorAll('[data-ai-avatar-answer-download]').length, 1);
      const answerDownload = main.querySelector('[role="toolbar"] [data-ai-avatar-answer-download]');
      assert.equal(answerDownload.nextElementSibling.getAttribute('aria-label'), '分享');
      assert.equal(answerDownload.shadowRoot.querySelector('button').textContent, '');
      download('html', main.querySelector('[role="toolbar"] [data-ai-avatar-answer-download]').shadowRoot.querySelector('button'));
      const toolbarExport = await downloads[downloads.length - 1].blob.text();
      assert.ok(toolbarExport.includes('沒有角色標記的完整回答') && toolbarExport.includes('第二段也要匯出') && !toolbarExport.includes('更多'));
      console.log('PASS: native copy toolbar -> marker-free answer -> visible download after native actions -> complete single-answer export');
      let removedId = '';
      let finishDeletion;
      const pendingDeletion = new Promise(resolve => { finishDeletion = resolve; });
      let deletionRequested = false;
      const dated = id => ({ id, title: id === 'older' ? '較舊對話' : '目前對話', create_time: new Date(2026, 9, 2, 12).toISOString(), update_time: new Date(2026, 9, 5, 12).toISOString() });
      window.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        if (init?.method === 'PATCH') { deletionRequested = true; await pendingDeletion; }
        const result = path === '/api/auth/session' ? { accessToken: 'fixture-only-token', user: { email: 'fixture@example.test' } }
          : path === '/backend-api/conversations' ? { items: [dated('current'), dated('older')], total: 2 }
          : init?.method === 'PATCH' ? (removedId = path.split('/').pop(), { success: true }) : { ...dated('older'), title: '自動更新的標題', update_time: new Date(2026, 9, 6, 12).getTime() / 1000 };
        return { ok: true, json: async () => result };
      };
      window.document.getElementById('ai-avatar-date-delete').querySelector('button').click();
      const history = window.document.getElementById('ai-avatar-date-history').shadowRoot;
      history.getElementById('start').value = '2026-10-01'; history.getElementById('end').value = '2026-10-10';
      history.getElementById('preview').click();
      await until(() => history.querySelectorAll('#list input').length === 2);
      assert.equal(history.querySelector('#list input[value=current]').disabled, true);
      const selected = history.querySelector('#list input[value=older]'); assert.equal(selected.value, 'older');
      selected.checked = true; selected.dispatchEvent(new window.Event('change'));
      assert.equal(history.getElementById('check'), null);
      assert.equal(history.getElementById('account'), null);
      assert.equal(history.getElementById('delete').textContent, '刪除 1 筆');
      window.confirm = () => { throw new Error('Deletion must use the styled confirmation'); };
      history.getElementById('delete').click();
      assert.equal(history.getElementById('confirm-view').hidden, false);
      assert.ok(history.getElementById('confirm-title').textContent.includes('刪除 1 筆'));
      assert.ok(history.getElementById('confirm-titles').textContent.includes('較舊對話'));
      assert.equal(removedId, '');
      const nativeSidebar = window.document.querySelector('nav').innerHTML;
      history.getElementById('confirm-delete').click();
      assert.equal(history.getElementById('deleting-view').hidden, false);
      assert.equal(history.getElementById('history-view').hidden, true);
      assert.equal(history.getElementById('deleting-status').textContent, '已完成 0／1 筆，正在刪除…');
      await until(() => deletionRequested);
      assert.equal(history.getElementById('deleting-view').hidden, false);
      assert.equal(history.getElementById('result-view').hidden, true);
      finishDeletion(); await until(() => !history.getElementById('result-view').hidden);
      assert.equal(history.getElementById('deleting-view').hidden, true);
      assert.equal(removedId, 'older');
      assert.equal(history.getElementById('result-title').textContent, '刪除成功');
      assert.equal(history.getElementById('result-description').textContent, '已刪除 1 筆對話。');
      assert.equal(window.document.querySelector('nav').innerHTML, nativeSidebar);
      history.getElementById('result-continue').click(); history.getElementById('close').click();
      assert.ok(!JSON.stringify(local).includes('fixture-only-token'));
      console.log('PASS: bundled history deletion -> immediate progress during delayed request -> explicit success -> native sidebar preserved');
      const options = new Window({ url: 'https://extension.test/options.html', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
      windows.push(options);
      options.chrome = chrome;
      options.TextEncoder = TextEncoder;
      options.Blob = Blob;
      options.URL.createObjectURL = window.URL.createObjectURL;
      options.URL.revokeObjectURL = () => {};
      options.HTMLAnchorElement.prototype.click = window.HTMLAnchorElement.prototype.click;
      options.fetch = async () => ({ ok: true, text: async () => packText });
      options.document.write(readFileSync('dist/options.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, ''));
      Object.defineProperty(options.document, 'readyState', { get: () => 'complete' });
      options.eval(readFileSync('dist/options.js', 'utf8'));
      const saveOptions = async () => {
        options.document.getElementById('saveBtn').click();
        await until(() => !options.document.getElementById('saveBtn').disabled);
      };
      await until(() => !!options.document.querySelector('#preview-happy img'));
      options.document.getElementById('showTourBtn').click();
      assert.ok(options.document.getElementById('ai-avatar-onboarding'));
      options.document.getElementById('ai-avatar-onboarding').shadowRoot.getElementById('skip').click();
      assert.equal(options.document.getElementById('exportPackBtn').textContent, '匯出目前表情包');
      const packInput = options.document.getElementById('packFiles');
      Object.defineProperty(packInput, 'files', { value: [new options.File([packText], 'custom.avatar-pack.json', { type: 'application/json' })] });
      packInput.dispatchEvent(new options.Event('change'));
      await until(() => options.document.getElementById('importSummary').textContent.includes('12／12'));
      assert.equal(local.customAvatars, undefined);
      options.document.getElementById('exportPackBtn').click();
      await until(() => downloads.at(-1)?.filename === 'avatar-images.zip');
      const imageZip = Buffer.from(await downloads.at(-1).blob.arrayBuffer());
      assert.equal(imageZip.readUInt32LE(imageZip.length - 22), 0x06054b50);
      assert.equal(imageZip.readUInt16LE(imageZip.length - 12), 12);
      let entry = 0;
      for (const state of Object.keys(pack.images)) {
        assert.equal(imageZip.readUInt32LE(entry), 0x04034b50);
        const nameLength = imageZip.readUInt16LE(entry + 26);
        const filename = imageZip.subarray(entry + 30, entry + 30 + nameLength).toString();
        assert.equal(filename, `${state}.svg`);
        const start = entry + 30 + nameLength;
        const size = imageZip.readUInt32LE(entry + 18);
        assert.deepEqual(imageZip.subarray(start, start + size), readFileSync(`dist/assets/avatar/${state}.svg`));
        entry = start + size;
      }
      console.log('PASS: bundled pack export downloads one ZIP containing all 12 original SVG images, no JSON');
      await saveOptions();
      await until(() => avatar.src.startsWith('data:image/svg+xml;base64,'));
      assert.equal(Object.keys(local.customAvatars).length, 12);
      options.document.getElementById('clearAvatarsBtn').click();
      await saveOptions();
      await until(() => avatar.src.endsWith('/happy.svg'));
      options.document.getElementById('enabled').checked = false;
      await saveOptions();
      await until(() => overlay.style.opacity === '0');
      assert.equal(window.document.getElementById('ai-avatar-composer-export').style.display, 'inline-flex');
      assert.equal(window.document.getElementById('ai-avatar-date-delete').style.display, 'inline-flex');
      options.document.getElementById('enabled').checked = true;
      await saveOptions();
      await until(() => overlay.style.opacity === '1');
      console.log('PASS: bundled options -> 12-state import preview -> save -> live custom avatars -> restore original -> enable/disable');
      const featureIds = ['questionOutline', 'conversationExport', 'answerExport', 'historyDelete'];
      const featureControls = '#ai-avatar-question-outline,#ai-avatar-composer-export,#ai-avatar-date-delete,[data-ai-avatar-answer-download]';
      const saveFeatures = async () => {
        options.document.getElementById('saveFeaturesBtn').click();
        await until(() => !options.document.getElementById('saveFeaturesBtn').disabled);
      };
      featureIds.forEach(id => { assert.equal(options.document.getElementById(id).checked, true); options.document.getElementById(id).checked = false; });
      await saveFeatures();
      assert.equal(window.document.querySelectorAll(featureControls).length, 0);
      assert.equal(overlay.style.opacity, '1');
      assert.ok(Object.values(sync.extensionConfig.pageFeatures).every(value => value === false));
      main.innerHTML = '<article data-turn="user">功能開關測試</article><article data-turn="assistant">此回答不應有下載圖示</article>';
      await pause(200); assert.equal(window.document.querySelectorAll(featureControls).length, 0);
      const disabledPage = new Window({ url: window.location.href, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } }); windows.push(disabledPage);
      disabledPage.chrome = chrome;
      disabledPage.document.body.innerHTML = '<div data-message-author-role="user">重新載入</div><div data-message-author-role="assistant">保持停用</div>';
      disabledPage.eval(readFileSync('dist/contentScript.js', 'utf8'));
      await until(() => !!disabledPage.document.querySelector('#ai-avatar-img')?.src);
      await pause(100); assert.equal(disabledPage.document.querySelectorAll(featureControls).length, 0);
      options.document.getElementById('answerExport').checked = true; await saveFeatures();
      assert.equal(window.document.querySelectorAll('[data-ai-avatar-answer-download]').length, 1);
      assert.equal(window.document.querySelectorAll('#ai-avatar-question-outline,#ai-avatar-composer-export,#ai-avatar-date-delete').length, 0);
      featureIds.forEach(id => { options.document.getElementById(id).checked = true; }); await saveFeatures();
      assert.ok(window.document.getElementById('ai-avatar-question-outline'));
      assert.ok(window.document.getElementById('ai-avatar-composer-export'));
      assert.ok(window.document.getElementById('ai-avatar-date-delete'));
      assert.equal(window.document.querySelectorAll('[data-ai-avatar-answer-download]').length, 1);
      console.log('PASS: settings feature switches -> independent live removal/restoration -> off after mutation and fresh page; avatar remains independent');
    }
    overlay.getBoundingClientRect = () => ({ left: 100, top: 100, width: 136, height: 136, right: 236, bottom: 236 });
    overlay.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 20, clientX: 150, clientY: 150, button: 0, bubbles: true }));
    window.document.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 20, clientX: 220, clientY: 190 }));
    window.document.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 20 }));
    await until(() => local[`avatarPosition:${site}`]?.x === 170);
    assert.equal(local[`avatarPosition:${site}`].y, 140);
    const refreshed = new Window({ url: window.location.href, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } }); windows.push(refreshed);
    refreshed.chrome = chrome;
    refreshed.document.body.innerHTML = site === 'chatgpt' ? '<div data-message-author-role="assistant">重新載入測試</div>' : '<div class="model-response-text">重新載入測試</div>';
    refreshed.eval(readFileSync('dist/contentScript.js', 'utf8'));
    await until(() => refreshed.document.getElementById('ai-avatar-overlay')?.style.left === '170px');
    await pause(50); assert.equal(refreshed.document.getElementById('ai-avatar-onboarding'), null);
    assert.equal(refreshed.document.getElementById('ai-avatar-overlay').style.top, '140px');
    assert.equal(refreshed.document.getElementById('ai-avatar-overlay').style.width, '136px');
    console.log(`PASS: ${site} persisted drag restored in a fresh page; default SVG, always-visible actions, resize, Markdown / HTML / PDF exports`);
    if (site === 'chatgpt') {
      const newChat = new Window({ url: 'https://chatgpt.com/', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } }); windows.push(newChat);
      newChat.chrome = chrome;
      newChat.document.body.innerHTML = '<main><h1>今天想聊些什麼？</h1><div contenteditable="true">尚未送出</div></main>';
      const logs = []; newChat.console.log = (...items) => logs.push(items.join(' '));
      let reads = 0; newChat.fetch = async () => { reads++; throw new Error('Empty chats must not read questions'); };
      newChat.eval(readFileSync('dist/contentScript.js', 'utf8'));
      await until(() => logs.some(line => line.includes('Observer started and monitoring')));
      assert.equal(newChat.document.getElementById('ai-avatar-question-outline'), null);
      assert.equal(newChat.document.getElementById('ai-avatar-composer-export'), null);
      assert.ok(!logs.some(line => line.includes('retrying'))); assert.equal(reads, 0);
      newChat.document.querySelector('main').insertAdjacentHTML('beforeend', '<article data-turn="user">第一個問題</article><article data-turn="assistant">excellent wonderful fantastic</article>');
      await until(() => newChat.document.querySelector('#ai-avatar-img')?.src.endsWith('/happy.svg'));
      assert.ok(newChat.document.getElementById('ai-avatar-question-outline').shadowRoot.querySelector('nav').textContent.includes('第一個問題'));
      assert.ok(newChat.document.getElementById('ai-avatar-composer-export'));
      assert.equal(reads, 0);
      console.log('PASS: blank new chat -> no download/outline/read/retry -> first question shows download and wakes monitoring without reloading');
    }
    const failedSettings = new Window({ url: window.location.href, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } }); windows.push(failedSettings);
    failedSettings.chrome = { ...chrome, storage: {
      ...chrome.storage,
      local: { ...chrome.storage.local, get: async () => { throw new Error('fixture storage unavailable'); } },
      sync: { ...chrome.storage.sync, get: async () => { throw new Error('fixture storage unavailable'); } },
    } };
    failedSettings.fetch = async () => { throw new Error('No live requests in fixtures'); };
    failedSettings.document.body.innerHTML = '<main></main>';
    failedSettings.eval(readFileSync('dist/contentScript.js', 'utf8'));
    await until(() => /\/idle[23]?\.svg$/.test(failedSettings.document.getElementById('ai-avatar-img')?.src || ''));
    failedSettings.document.querySelector('main').innerHTML = site === 'chatgpt'
      ? '<article data-turn="user">測試</article><article data-turn="assistant">excellent wonderful fantastic</article>'
      : '<div class="user-query">測試</div><div class="model-response-text">excellent wonderful fantastic</div>';
    await until(() => failedSettings.document.getElementById('ai-avatar-img')?.src.endsWith('/happy.svg'));
    const originalAvatar = failedSettings.document.getElementById('ai-avatar-overlay');
    originalAvatar.getBoundingClientRect = () => ({ left: 100, top: 100, width: 128, height: 128, right: 228, bottom: 228 });
    originalAvatar.dispatchEvent(new failedSettings.PointerEvent('pointerdown', { pointerId: 99, clientX: 150, clientY: 150, button: 0, bubbles: true }));
    failedSettings.document.dispatchEvent(new failedSettings.PointerEvent('pointermove', { pointerId: 99, clientX: 180, clientY: 180 }));
    failedSettings.document.dispatchEvent(new failedSettings.PointerEvent('pointerup', { pointerId: 99 }));
    assert.equal(originalAvatar.style.left, '130px'); assert.equal(originalAvatar.style.top, '130px');
    console.log(`PASS: ${site} unavailable page settings preserve default avatar, emotion monitoring, and dragging`);
  } finally {
    for (const item of windows) { await item.happyDOM.abort(); item.close(); }
  }
}
