import { STORAGE_KEY_ONBOARDING } from '@/common/constants';

interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

/** Serialize claims so opening several chat tabs only shows one first-use guide. */
export class OnboardingState {
  private pending: Promise<void> = Promise.resolve();
  constructor(private storage: Storage = chrome.storage.local) {}

  public claim(): Promise<boolean> {
    const result = this.pending.then(async () => {
      const saved = await this.storage.get(STORAGE_KEY_ONBOARDING);
      if ((saved[STORAGE_KEY_ONBOARDING] as { seen?: boolean } | undefined)?.seen) return false;
      await this.storage.set({ [STORAGE_KEY_ONBOARDING]: { seen: true, completed: false } });
      return true;
    });
    this.pending = result.then(() => {}, () => {});
    return result;
  }
}
