/**
 * Options Page - Settings UI logic
 */

import type { ExtensionConfig, CustomAvatarImages, PageFeatureSettings } from '@/common/types';
import { LlmProvider, AvatarState, TargetSite } from '@/common/types';
import { DEFAULT_CONFIG, DEFAULT_PAGE_FEATURES, resolvePageFeatures, STORAGE_KEY_CONFIG, STORAGE_KEY_CUSTOM_AVATARS, AVATAR_IMAGES, STORAGE_KEY_DISPLAY, clampAvatarSize, avatarPositionKey } from '@/common/constants';
import { importAvatarFiles, readFile } from '@/common/avatarPack';
import { exportAvatarImages } from '@/common/avatarImageExport';
import { downloadBlob } from '@/common/download';
import { OnboardingTour } from '@/content/OnboardingTour';

class OptionsPage {
  private elements: {
    enabled: HTMLInputElement;
    pageFeatures: Record<keyof PageFeatureSettings, HTMLInputElement>;
    saveFeaturesBtn: HTMLButtonElement;
    featuresStatus: HTMLElement;
    showTourBtn: HTMLButtonElement;
    avatarStyle: HTMLSelectElement;
    avatarGrid: HTMLElement;
    llmProvider: HTMLSelectElement;
    llmConfig: HTMLElement;
    apiKey: HTMLInputElement;
    modelName: HTMLInputElement;
    saveBtn: HTMLButtonElement;
    resetBtn: HTMLButtonElement;
    statusMessage: HTMLElement;
    avatarSize: HTMLInputElement;
    avatarSizeValue: HTMLElement;
    packFiles: HTMLInputElement;
    importPackBtn: HTMLButtonElement;
    exportPackBtn: HTMLButtonElement;
    clearAvatarsBtn: HTMLButtonElement;
    importSummary: HTMLElement;
    savePackBtn: HTMLButtonElement;
  };

  private customAvatars: CustomAvatarImages = {};
  private importing = false;
  private exporting = false;
  private onboarding: OnboardingTour | null = null;

  constructor() {
    this.elements = this.getElements();
    this.initialize();
  }

  private getElements(): typeof this.elements {
    return {
      enabled: document.getElementById('enabled') as HTMLInputElement,
      pageFeatures: Object.fromEntries(Object.keys(DEFAULT_PAGE_FEATURES).map(key => [key, document.getElementById(key) as HTMLInputElement])) as Record<keyof PageFeatureSettings, HTMLInputElement>,
      saveFeaturesBtn: document.getElementById('saveFeaturesBtn') as HTMLButtonElement,
      featuresStatus: document.getElementById('featuresStatus') as HTMLElement,
      showTourBtn: document.getElementById('showTourBtn') as HTMLButtonElement,
      avatarStyle: document.getElementById('avatarStyle') as HTMLSelectElement,
      avatarGrid: document.getElementById('avatarGrid') as HTMLElement,
      llmProvider: document.getElementById('llmProvider') as HTMLSelectElement,
      llmConfig: document.getElementById('llmConfig') as HTMLElement,
      apiKey: document.getElementById('apiKey') as HTMLInputElement,
      modelName: document.getElementById('modelName') as HTMLInputElement,
      saveBtn: document.getElementById('saveBtn') as HTMLButtonElement,
      resetBtn: document.getElementById('resetBtn') as HTMLButtonElement,
      statusMessage: document.getElementById('statusMessage') as HTMLElement,
      avatarSize: document.getElementById('avatarSize') as HTMLInputElement,
      avatarSizeValue: document.getElementById('avatarSizeValue') as HTMLElement,
      packFiles: document.getElementById('packFiles') as HTMLInputElement,
      importPackBtn: document.getElementById('importPackBtn') as HTMLButtonElement,
      exportPackBtn: document.getElementById('exportPackBtn') as HTMLButtonElement,
      clearAvatarsBtn: document.getElementById('clearAvatarsBtn') as HTMLButtonElement,
      importSummary: document.getElementById('importSummary') as HTMLElement,
      savePackBtn: document.getElementById('savePackBtn') as HTMLButtonElement,
    };
  }

  private async initialize(): Promise<void> {
    this.renderAvatarGrid();
    await this.loadSettings();
    this.attachEventListeners();
  }

  private renderAvatarGrid(): void {
    const avatarStates = Object.values(AvatarState);
    const stateLabels: Record<AvatarState, string> = {
      [AvatarState.IDLE]: 'Idle (閒置)',
      [AvatarState.IDLE2]: 'Idle 2 (閒置變體2)',
      [AvatarState.IDLE3]: 'Idle 3 (閒置變體3)',
      [AvatarState.THINKING]: 'Thinking (思考中)',
      [AvatarState.HAPPY]: 'Happy (開心)',
      [AvatarState.SAD]: 'Sad (難過)',
      [AvatarState.EXCITED]: 'Excited (興奮)',
      [AvatarState.CONFUSED]: 'Confused (困惑)',
      [AvatarState.ANGRY]: 'Angry (生氣)',
      [AvatarState.SURPRISED]: 'Surprised (驚訝)',
      [AvatarState.WORRIED]: 'Worried (擔心)',
      [AvatarState.NEUTRAL]: 'Neutral (中性)',
    };

    this.elements.avatarGrid.innerHTML = avatarStates
      .map(
        (state) => `
        <div class="avatar-item" data-state="${state}">
          <div class="avatar-item-header">
            <span class="avatar-item-title">${stateLabels[state]}</span>
          </div>
          <div class="avatar-preview" id="preview-${state}">
            <div class="avatar-preview-placeholder">No custom image</div>
          </div>
          <div class="file-input-wrapper">
            <input type="file" id="file-${state}" accept="image/*" data-state="${state}">
            <label for="file-${state}" class="file-input-label">Choose Image</label>
          </div>
          <button class="btn-reset-avatar" data-state="${state}">Reset to Default</button>
        </div>
      `
      )
      .join('');

    // Attach event listeners for file inputs and reset buttons
    avatarStates.forEach((state) => {
      const fileInput = document.getElementById(`file-${state}`) as HTMLInputElement;
      const resetBtn = this.elements.avatarGrid.querySelector(
        `.btn-reset-avatar[data-state="${state}"]`
      ) as HTMLButtonElement;

      fileInput.addEventListener('change', (e) => this.handleFileUpload(e, state));
      resetBtn.addEventListener('click', () => this.resetAvatar(state));
    });
  }

  private async loadSettings(): Promise<void> {
    try {
      // Load config from sync storage
      const configResult = await chrome.storage.sync.get(STORAGE_KEY_CONFIG);
      const config: ExtensionConfig = { ...DEFAULT_CONFIG, ...configResult[STORAGE_KEY_CONFIG] };

      this.elements.enabled.checked = config.enabled;
      const pageFeatures = resolvePageFeatures(config.pageFeatures);
      (Object.keys(pageFeatures) as (keyof PageFeatureSettings)[]).forEach(key => { this.elements.pageFeatures[key].checked = pageFeatures[key]; });
      this.elements.avatarStyle.value = config.avatarStyle;
      this.elements.llmProvider.value = config.llmProvider;
      this.elements.apiKey.value = config.apiKey || '';
      this.elements.modelName.value = config.modelName || '';

      // Load custom avatars from local storage (larger quota)
      const avatarsResult = await chrome.storage.local.get([STORAGE_KEY_CUSTOM_AVATARS, STORAGE_KEY_DISPLAY]);
      this.customAvatars = avatarsResult[STORAGE_KEY_CUSTOM_AVATARS] || {};
      const size = clampAvatarSize(avatarsResult[STORAGE_KEY_DISPLAY]?.size);
      this.elements.avatarSize.value = String(size);
      this.elements.avatarSizeValue.textContent = `${size} px`;

      // Update avatar previews
      this.updateAvatarPreviews();
      this.updateLlmConfigVisibility();
    } catch (error) {
      this.showStatus('Failed to load settings', 'error');
      console.error('Load settings error:', error);
    }
  }

  private attachEventListeners(): void {
    this.elements.showTourBtn.addEventListener('click', () => {
      if (!this.onboarding) {
        this.onboarding = new OnboardingTour(TargetSite.CHATGPT, () => { document.getElementById('pageFeaturesTitle')?.scrollIntoView({ block: 'start' }); this.elements.pageFeatures.questionOutline.focus(); });
        window.addEventListener('pagehide', () => this.onboarding?.destroy(), { once: true });
      }
      const features = Object.fromEntries(Object.entries(this.elements.pageFeatures).map(([key, input]) => [key, input.checked]));
      document.getElementById('preview-happy')?.scrollIntoView({ block: 'center' });
      this.onboarding.configure(features, this.customAvatars); this.onboarding.start();
    });
    this.elements.saveBtn.addEventListener('click', () => this.saveSettings());
    this.elements.savePackBtn.addEventListener('click', () => this.saveSettings());
    this.elements.saveFeaturesBtn.addEventListener('click', async () => {
      this.elements.featuresStatus.textContent = '';
      await this.saveSettings(); this.elements.featuresStatus.textContent = this.elements.statusMessage.textContent;
    });
    Object.values(this.elements.pageFeatures).forEach(input => input.addEventListener('change', () => { this.elements.featuresStatus.textContent = ''; }));
    this.elements.resetBtn.addEventListener('click', () => this.resetSettings());
    this.elements.llmProvider.addEventListener('change', () =>
      this.updateLlmConfigVisibility()
    );
    this.elements.avatarSize.addEventListener('input', () => {
      this.elements.avatarSizeValue.textContent = `${this.elements.avatarSize.value} px`;
    });
    this.elements.importPackBtn.addEventListener('click', () => this.elements.packFiles.click());
    this.elements.packFiles.addEventListener('change', () => { void this.importFiles(); });
    this.elements.exportPackBtn.addEventListener('click', () => { void this.exportImages(); });
    this.elements.clearAvatarsBtn.addEventListener('click', () => {
      this.customAvatars = {};
      this.updateAvatarPreviews();
      this.elements.importSummary.textContent = '已恢復原本角色預覽。請按「Save Settings」套用。';
    });
  }

  private async exportImages(): Promise<void> {
    if (this.importing || this.exporting) return;
    this.exporting = true; this.elements.exportPackBtn.disabled = true;
    try {
      const archive = await exportAvatarImages({ ...this.customAvatars });
      downloadBlob(archive, 'avatar-images.zip');
      this.showStatus('已開始下載全部 12 張表情圖片（ZIP）。解壓後可直接使用，或一次選取圖片重新匯入。', 'success');
    } catch (error) { this.showStatus((error as Error).message, 'error'); }
    finally { this.exporting = false; this.elements.exportPackBtn.disabled = this.importing; }
  }

  private setImporting(importing: boolean): void {
    this.importing = importing;
    this.elements.exportPackBtn.disabled = importing || this.exporting;
    this.elements.importPackBtn.disabled = importing;
    this.elements.clearAvatarsBtn.disabled = importing;
    this.elements.saveBtn.disabled = importing;
    this.elements.savePackBtn.disabled = importing;
    this.elements.saveFeaturesBtn.disabled = importing;
    this.elements.resetBtn.disabled = importing;
    this.elements.avatarGrid.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(element => { element.disabled = importing; });
  }

  private applyImported(images: CustomAvatarImages): void {
    this.customAvatars = images;
    this.updateAvatarPreviews();
    const count = Object.keys(images).length;
    this.elements.importSummary.textContent = `已匯入 ${count}／12 種表情。其餘使用原本角色，請按「Save Settings」套用。`;
    this.showStatus('表情包預覽已更新，尚未套用到聊天頁面。', 'success');
  }

  private async importFiles(): Promise<void> {
    if (this.importing || !this.elements.packFiles.files?.length) return;
    this.setImporting(true);
    try { this.applyImported(await importAvatarFiles(Array.from(this.elements.packFiles.files))); }
    catch (error) { this.showStatus((error as Error).message, 'error'); }
    finally { this.elements.packFiles.value = ''; this.setImporting(false); }
  }

  private updateLlmConfigVisibility(): void {
    const provider = this.elements.llmProvider.value;
    if (provider === LlmProvider.NONE) {
      this.elements.llmConfig.classList.add('hidden');
    } else {
      this.elements.llmConfig.classList.remove('hidden');
    }
  }

  private async handleFileUpload(event: Event, state: AvatarState): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.showStatus('Please select a valid image file', 'error');
      return;
    }

    // Validate file size (max 1MB)
    if (file.size > 1024 * 1024) {
      this.showStatus('Image size must be less than 1MB', 'error');
      return;
    }

    if (this.importing) return;
    this.setImporting(true);
    try {
      const dataUrl = await readFile(file, 'dataURL');
      // Preserve the original per-image upload behavior, including existing formats.
      this.customAvatars[state] = dataUrl;
      this.updateAvatarPreview(state, dataUrl);
      this.showStatus(`${state} 圖片已更新，請按「Save Settings」套用。`, 'success');
    } catch (error) { this.showStatus((error as Error).message, 'error'); }
    finally { input.value = ''; this.setImporting(false); }
  }

  private resetAvatar(state: AvatarState): void {
    delete this.customAvatars[state];
    this.updateAvatarPreview(state, null);
    this.showStatus(`${state} avatar reset to default`, 'success');
  }

  private updateAvatarPreviews(): void {
    Object.values(AvatarState).forEach((state) => {
      const customUrl = this.customAvatars[state];
      this.updateAvatarPreview(state, customUrl || null);
    });
  }

  private updateAvatarPreview(state: AvatarState, imageUrl: string | null): void {
    const preview = document.getElementById(`preview-${state}`);
    if (!preview) return;

    const image = document.createElement('img');
    image.src = imageUrl || chrome.runtime.getURL(AVATAR_IMAGES[state]);
    if (!imageUrl) image.style.opacity = '0.5';
    image.alt = `${state}${imageUrl ? ' 自訂表情' : ' 預設表情'}`;
    preview.replaceChildren(image);
  }

  private async saveSettings(): Promise<void> {
    if (this.importing) return;
    this.elements.saveBtn.disabled = true;
    this.elements.savePackBtn.disabled = true;
    this.elements.saveFeaturesBtn.disabled = true;
    try {
      // Save config to sync storage (without custom avatars)
      const config: ExtensionConfig = {
        enabled: this.elements.enabled.checked,
        avatarStyle: this.elements.avatarStyle.value,
        llmProvider: this.elements.llmProvider.value as LlmProvider,
        apiKey: this.elements.apiKey.value.trim() || undefined,
        modelName: this.elements.modelName.value.trim() || undefined,
        targetSites: DEFAULT_CONFIG.targetSites,
        pageFeatures: {
          questionOutline: this.elements.pageFeatures.questionOutline.checked,
          conversationExport: this.elements.pageFeatures.conversationExport.checked,
          answerExport: this.elements.pageFeatures.answerExport.checked,
          historyDelete: this.elements.pageFeatures.historyDelete.checked,
        },
      };

      // A single local write atomically updates the pack and display settings.
      await chrome.storage.local.set({
        [STORAGE_KEY_CUSTOM_AVATARS]: this.customAvatars,
        [STORAGE_KEY_DISPLAY]: { size: clampAvatarSize(Number(this.elements.avatarSize.value)) },
      });
      await chrome.storage.sync.set({ [STORAGE_KEY_CONFIG]: config });
      this.elements.importSummary.textContent = '';
      this.showStatus('設定已儲存，已開啟的聊天頁面會自動套用。', 'success');
    } catch (error) {
      this.showStatus('無法儲存設定，可能超過 Chrome 儲存空間。請縮小圖片或移除部分表情後重試。', 'error');
      console.error('Save settings error:', error);
    } finally { this.elements.saveBtn.disabled = false; this.elements.savePackBtn.disabled = false; this.elements.saveFeaturesBtn.disabled = false; }
  }

  private async resetSettings(): Promise<void> {
    try {
      await chrome.storage.sync.set({ [STORAGE_KEY_CONFIG]: DEFAULT_CONFIG });
      // Reset configuration/display only; uploaded images have their own reset controls.
      await chrome.storage.local.remove([STORAGE_KEY_DISPLAY, avatarPositionKey(TargetSite.CHATGPT), avatarPositionKey(TargetSite.GEMINI)]);
      await this.loadSettings();
      this.elements.importSummary.textContent = '';
      this.elements.featuresStatus.textContent = '';
      this.showStatus('Settings reset to defaults', 'success');
    } catch (error) {
      this.showStatus('Failed to reset settings', 'error');
      console.error('Reset settings error:', error);
    }
  }

  private showStatus(message: string, type: 'success' | 'error'): void {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type} show`;

    setTimeout(() => {
      this.elements.statusMessage.classList.remove('show');
    }, 3000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new OptionsPage());
} else {
  new OptionsPage();
}
