import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmProvider, MessageType, AvatarState, TargetSite } from '@/common/types';
import { STORAGE_KEY_CONFIG } from '@/common/constants';

describe('original emotion providers on cold worker startup', () => {
  beforeEach(() => { vi.resetModules(); vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([LlmProvider.NONE, LlmProvider.GEMINI, LlmProvider.OPENAI])('waits for saved %s configuration before handling the first response', async provider => {
    let loadConfig: ((result: Record<string, unknown>) => void) | undefined;
    let receive: ((message: unknown, sender: object, reply: (result: unknown) => void) => boolean) | undefined;
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async (): Promise<unknown> => provider === LlmProvider.GEMINI
      ? { candidates: [{ content: { parts: [{ text: 'happy' }] } }] }
      : { choices: [{ message: { content: 'happy' } }] } }));
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('chrome', {
      action: { onClicked: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: (listener: typeof receive): void => { receive = listener; } } },
      storage: { sync: { get: (_key: string, callback: typeof loadConfig): void => { loadConfig = callback; } }, onChanged: { addListener: vi.fn() } },
    });
    await import('@/background/background');
    const reply = vi.fn();
    expect(receive!({ type: MessageType.ANALYZE_EMOTION, payload: { text: 'excellent wonderful fantastic', timestamp: 0, site: TargetSite.CHATGPT } }, {}, reply)).toBe(true);
    await Promise.resolve(); expect(reply).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    loadConfig!({ [STORAGE_KEY_CONFIG]: { enabled: true, llmProvider: provider, apiKey: 'fixture-only', modelName: 'fixture-model' } });
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ emotion: AvatarState.HAPPY })));
    if (provider === LlmProvider.NONE) expect(request).not.toHaveBeenCalled();
    else {
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0][0]).toContain(provider === LlmProvider.GEMINI ? 'generativelanguage.googleapis.com/v1beta/models/fixture-model' : 'api.openai.com/v1/chat/completions');
    }
  });
});
