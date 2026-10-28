/**
 * ResponseWatcher - Observes DOM for new AI responses
 * Uses MutationObserver for efficient DOM monitoring
 */

import type { IResponseWatcher, ISiteAdapter } from '@/common/interfaces';
import type { AiResponse } from '@/common/types';
import { TargetSite } from '@/common/types';

export class ResponseWatcher implements IResponseWatcher {
  private observer: MutationObserver | null = null;
  private callbacks: Array<(response: AiResponse) => void> = [];
  private processedResponses = new Set<string>();
  private isRunning = false;
  private responseCompletionTimers = new Map<Element, NodeJS.Timeout>(); // Track completion timers for each response
  private lastTextLength = new Map<Element, number>(); // Track last text length for each element

  constructor(
    private siteAdapter: ISiteAdapter,
    private site: TargetSite
  ) {}

  public start(): void {
    if (this.isRunning) return;

    console.log('👀 ResponseWatcher: Starting...');

    // Empty chats are normal: observe immediately and let message mutations wake us.
    this.markExistingResponses();
    this.observer = new MutationObserver(this.handleMutations.bind(this));
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-message-author-role', 'data-turn', 'class'],
    });
    this.isRunning = true;
    console.log('✅ ResponseWatcher: Observer started and monitoring');
  }

  private markExistingResponses(): void {
    const selector = this.siteAdapter.getResponseSelector();
    const existingResponses = document.querySelectorAll(selector);

    let lastResponseText: string | null = null;
    let processedCount = 0;

    existingResponses.forEach((element, index) => {
      const text = this.siteAdapter.extractTextFromElement(element);
      if (text && text.length >= 3) {
        const textHash = this.hashText(text);
        this.processedResponses.add(textHash);
        processedCount++;

        // Keep track of the last response
        if (index === existingResponses.length - 1) {
          lastResponseText = text;
        }
      }
    });

    console.log(`📚 Marked ${processedCount} existing responses as processed (found ${existingResponses.length} elements)`);

    // Trigger emotion analysis for the last response to set initial avatar state
    if (lastResponseText) {
      console.log('🎨 Analyzing last response to set initial avatar state...');
      const lastResponse: AiResponse = {
        text: lastResponseText,
        timestamp: Date.now(),
        site: this.site,
      };
      this.notifyCallbacks(lastResponse);
    }

  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Clear all completion timers
    this.responseCompletionTimers.forEach((timer) => clearTimeout(timer));
    this.responseCompletionTimers.clear();
    this.lastTextLength.clear();

    this.isRunning = false;
  }

  public onResponse(callback: (response: AiResponse) => void): void {
    this.callbacks.push(callback);
  }

  private handleMutations(mutations: MutationRecord[]): void {
    if (!this.isRunning) return;
    for (const mutation of mutations) {
      // characterData includes comment markers as well as text. Only elements
      // support the adapter's matches/closest checks.
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target as Element : mutation.target.parentElement;
      if (target?.closest('[data-ai-avatar-ui]')) continue;
      // Handle new nodes being added
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        this.checkForNewResponses(mutation.addedNodes);
      }

      // Handle text content changes (AI typing in existing element)
      if (target && (mutation.type === 'characterData' || mutation.type === 'childList' || mutation.type === 'attributes')) {
        if (this.siteAdapter.isAiResponseElement(target)) {
          this.processResponseElement(target);
        } else {
          // Check if any ancestor is a response element
          const selector = this.siteAdapter.getResponseSelector();
          const responseElement = target.closest(selector);
          if (responseElement) {
            this.processResponseElement(responseElement);
          }
        }
      }
    }
  }

  private checkForNewResponses(nodes: NodeList): void {
    nodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const element = node as Element;

      // Check if this node or its descendants contain AI responses
      if (this.siteAdapter.isAiResponseElement(element)) {
        this.processResponseElement(element);
      }

      // Also check descendants
      const selector = this.siteAdapter.getResponseSelector();
      const responseElements = element.querySelectorAll(selector);
      responseElements.forEach((el) => this.processResponseElement(el));
    });
  }

  private processResponseElement(element: Element): void {
    if (!this.isRunning || !element.isConnected || element.closest('[data-ai-avatar-ui]')) return;
    const text = this.siteAdapter.extractTextFromElement(element);
    // Empty placeholders will emit another mutation when their text arrives.
    if (!text || text.length < 3 || this.processedResponses.has(this.hashText(text))) return;

    // Check if text is still changing (AI is still typing)
    const lastLength = this.lastTextLength.get(element) || 0;
    const currentLength = text.length;

    // If text length changed, AI is still typing
    if (currentLength !== lastLength) {
      this.lastTextLength.set(element, currentLength);

      // Clear existing completion timer
      const existingTimer = this.responseCompletionTimers.get(element);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Use shorter wait time (800ms) to be more responsive
      // This means: if text stops changing for 800ms, we consider it complete
      const completionTimer = setTimeout(() => {
        if (!this.isRunning || !element.isConnected) {
          this.responseCompletionTimers.delete(element); this.lastTextLength.delete(element); return;
        }
        // Double-check the text length hasn't changed
        const finalText = this.siteAdapter.extractTextFromElement(element);
        const finalLength = finalText.length;

        if (finalLength === this.lastTextLength.get(element)) {
          console.log('✅ AI response completed, analyzing emotion...');
          this.finalizeResponse(element, finalText);
        }
      }, 800);

      this.responseCompletionTimers.set(element, completionTimer);

      // Log only on first detection
      if (lastLength === 0) {
        console.log('⏳ AI is typing, waiting for completion...');
      }

      return;
    }

    // Multiple mutation records may describe the same render; keep its debounce.
    if (!this.responseCompletionTimers.has(element)) this.finalizeResponse(element, text);
  }

  private finalizeResponse(element: Element, text: string): void {
    // Clean up timers and tracking
    const timer = this.responseCompletionTimers.get(element);
    if (timer) {
      clearTimeout(timer);
      this.responseCompletionTimers.delete(element);
    }
    this.lastTextLength.delete(element);

    // Create a hash of the text to track processed responses
    const textHash = this.hashText(text);

    // Ignore duplicate responses
    if (this.processedResponses.has(textHash)) {
      // Don't log duplicates to reduce noise
      return;
    }

    // Mark as processed
    this.processedResponses.add(textHash);

    // Limit the set size to prevent memory leaks (keep last 100 responses)
    if (this.processedResponses.size > 100) {
      const firstItem = this.processedResponses.values().next().value;
      if (firstItem) {
        this.processedResponses.delete(firstItem);
      }
    }

    const response: AiResponse = {
      text,
      timestamp: Date.now(),
      site: this.site,
    };

    console.log('🤖 NEW AI Response:', {
      site: this.site,
      textLength: text.length,
      preview: text.substring(0, 50) + '...',
      hash: textHash.substring(0, 8),
    });

    this.notifyCallbacks(response);
  }

  private hashText(text: string): string {
    // Simple hash function for text deduplication
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private notifyCallbacks(response: AiResponse): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(response);
      } catch (error) {
        console.error('Error in response callback:', error);
      }
    });
  }

  public destroy(): void {
    this.stop();
    this.callbacks = [];
    this.processedResponses.clear();
  }
}
