/**
 * SiteAdapterFactory - Factory for creating site-specific adapters
 * Follows Factory and Strategy patterns for extensibility
 */

import type { ISiteAdapter, ISiteAdapterFactory } from '@/common/interfaces';
import { TargetSite } from '@/common/types';

/**
 * Base adapter implementation with common functionality
 */
abstract class BaseSiteAdapter implements ISiteAdapter {
  abstract getResponseSelector(): string;
  abstract getUserInputSelector(): string;
  abstract isAiResponseElement(element: Element): boolean;

  public extractTextFromElement(element: Element): string {
    return element.textContent?.trim() || '';
  }
}

/**
 * ChatGPT-specific adapter
 */
class ChatGptAdapter extends BaseSiteAdapter {
  public getResponseSelector(): string {
    return '[data-message-author-role="assistant"], article[data-turn="assistant"]';
  }

  public getUserInputSelector(): string {
    return '[data-message-author-role="user"]';
  }

  public isAiResponseElement(element: Element): boolean {
    return element.matches(this.getResponseSelector());
  }

  public extractTextFromElement(element: Element): string {
    // Try multiple selectors for ChatGPT's changing DOM structure
    const markdown = element.querySelector('.markdown');
    if (markdown?.textContent?.trim()) {
      return markdown.textContent.trim();
    }

    // Try direct text content
    const directText = element.textContent?.trim();
    if (directText) {
      return directText;
    }

    // Fallback to base implementation
    return super.extractTextFromElement(element);
  }
}

/**
 * Gemini-specific adapter
 */
class GeminiAdapter extends BaseSiteAdapter {
  public getResponseSelector(): string {
    return '.model-response-text';
  }

  public getUserInputSelector(): string {
    return '.user-query';
  }

  public isAiResponseElement(element: Element): boolean {
    return element.classList.contains('model-response-text');
  }

  public extractTextFromElement(element: Element): string {
    const content = element.querySelector('.message-content');
    return content?.textContent?.trim() || super.extractTextFromElement(element);
  }
}

/**
 * Factory implementation
 */
export class SiteAdapterFactory implements ISiteAdapterFactory {
  private adapters: Map<string, ISiteAdapter> = new Map();

  constructor() {
    // Pre-initialize supported adapters
    this.adapters.set(TargetSite.CHATGPT, new ChatGptAdapter());
    this.adapters.set(TargetSite.GEMINI, new GeminiAdapter());
  }

  public create(site: string): ISiteAdapter {
    const adapter = this.adapters.get(site);
    if (!adapter) {
      throw new Error(`Unsupported site: ${site}`);
    }
    return adapter;
  }

  /**
   * Register a custom adapter for extensibility
   */
  public register(site: string, adapter: ISiteAdapter): void {
    this.adapters.set(site, adapter);
  }
}
