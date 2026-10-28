import { describe, expect, it, vi } from 'vitest';
import { OnboardingState } from '@/background/OnboardingState';
import { STORAGE_KEY_ONBOARDING } from '@/common/constants';

describe('first-use guide claims', () => {
  it('grants only one concurrent tab and remembers the claim across worker restarts', async () => {
    const saved: Record<string, unknown> = {};
    const storage = { get: vi.fn(async () => ({ ...saved })), set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(saved, values); }) };
    const state = new OnboardingState(storage);
    expect(await Promise.all([state.claim(), state.claim(), state.claim()])).toEqual([true, false, false]);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(saved[STORAGE_KEY_ONBOARDING]).toEqual({ seen: true, completed: false });
    expect(await new OnboardingState(storage).claim()).toBe(false);
  });
  it('does not claim success after a failed write and leaves later claims usable', async () => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn().mockRejectedValueOnce(new Error('storage')).mockResolvedValue(undefined) };
    const state = new OnboardingState(storage);
    await expect(state.claim()).rejects.toThrow('storage');
    expect(await state.claim()).toBe(true);
  });
});
