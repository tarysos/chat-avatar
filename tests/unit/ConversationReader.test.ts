import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConversation, readCurrentConversation } from '@/content/ConversationReader';

const payload = (): Record<string, unknown> => ({
  conversation_id: 'current', title: '目前測試對話', current_node: 'answer',
  mapping: {
    root: { parent: null, message: { author: { role: 'system' }, content: { parts: ['系統私有內容'] } } },
    user: { parent: 'root', message: { id: 'user-id', author: { role: 'user' }, content: { parts: ['測試成功回應'] } } },
    analysis: { parent: 'user', message: { author: { role: 'assistant' }, channel: 'analysis', content: { parts: ['不可匯出的推理'] } } },
    answer: { parent: 'analysis', message: { id: 'answer-id', author: { role: 'assistant' }, channel: 'final', content: { parts: ['## 測試成功\n\n```js\nconst a = "<script>";\n```'] } } },
    other: { parent: 'user', message: { author: { role: 'assistant' }, content: { parts: ['其他分支不應匯出'] } } },
  },
});
const response = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status });

describe('current conversation fallback', () => {
  beforeEach(() => { window.location.href = 'https://chatgpt.com/c/current'; document.body.replaceChildren(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('reads only user-facing messages on the selected branch in chronological order', () => {
    const snapshot = parseConversation(payload(), 'current', location.href);
    expect(snapshot.source).toBe('conversation'); expect(snapshot.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(snapshot)).not.toMatch(/系統私有|不可匯出|其他分支/);
    expect(snapshot.messages[1].html).toContain('<h2>測試成功</h2>');
    expect(snapshot.messages[1].html).toContain('&lt;script&gt;');
  });
  it('rejects mismatched conversations and broken or cyclic branch graphs', () => {
    expect(() => parseConversation(payload(), 'wrong', location.href)).toThrow('不同');
    const broken = payload(); broken.current_node = 'missing';
    expect(() => parseConversation(broken, 'current', location.href)).toThrow('目前分支');
    const cycle = payload(); (cycle.mapping as Record<string, { parent: string }>).user.parent = 'answer';
    expect(() => parseConversation(cycle, 'current', location.href)).toThrow('不完整');
    const truncated = payload(); delete (truncated.mapping as Record<string, { parent?: string }>).user.parent;
    expect(() => parseConversation(truncated, 'current', location.href)).toThrow('不完整');
  });
  it('preserves image and attachment references and rejects unfinished saved answers', () => {
    const data = payload();
    const mapping = data.mapping as Record<string, { message: Record<string, unknown> }>;
    mapping.user.message.content = { parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'hidden-image-id' }] };
    mapping.user.message.metadata = { attachments: [{ name: '需求文件.pdf', id: 'hidden-file-id' }] };
    const snapshot = parseConversation(data, 'current', location.href);
    expect(snapshot.messages[0].markdown).toContain('[圖片]');
    expect(snapshot.messages[0].markdown).toContain('[附件：需求文件.pdf]');
    expect(JSON.stringify(snapshot)).not.toContain('hidden-file-id');
    mapping.answer.message.status = 'in_progress';
    expect(() => parseConversation(data, 'current', location.href)).toThrow('仍在產生');
    const outline = parseConversation(data, 'current', location.href, true);
    expect(outline.messages.map(message => message.role)).toEqual(['user']);
  });
  it('makes only same-origin GET requests, keeps credentials out of the snapshot and rejects navigation', async () => {
    const request = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url).endsWith('/api/auth/session') ? response({ accessToken: 'fixture-secret' }) : response(payload()));
    const snapshot = await readCurrentConversation(location.href, new AbortController().signal, request);
    expect(request.mock.calls.map(([url]) => url)).toEqual(['https://chatgpt.com/api/auth/session', 'https://chatgpt.com/backend-api/conversation/current']);
    expect(request.mock.calls.every(([, init]) => init?.method === 'GET' && init.credentials === 'include' && init.cache === 'no-store')).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('fixture-secret');
    expect(request.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer fixture-secret' });
    await expect(readCurrentConversation('https://example.test/c/current', new AbortController().signal, request)).rejects.toThrow('識別碼');
    request.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/auth/session')) return response({ accessToken: 'fixture-secret' });
      window.location.href = 'https://chatgpt.com/c/other'; return response(payload());
    });
    await expect(readCurrentConversation(location.href, new AbortController().signal, request)).rejects.toThrow('切換');
  });
});
