/**
 * Unit tests for SiteAdapterFactory
 */

import { describe, it, expect } from 'vitest';
import { SiteAdapterFactory } from '@/adapters/SiteAdapterFactory';
import { TargetSite } from '@/common/types';

describe('SiteAdapterFactory', () => {
  let factory: SiteAdapterFactory;

  beforeEach(() => {
    factory = new SiteAdapterFactory();
  });

  describe('create', () => {
    it('should create ChatGPT adapter', () => {
      const adapter = factory.create(TargetSite.CHATGPT);
      expect(adapter).toBeDefined();
      expect(adapter.getResponseSelector()).toContain('[data-message-author-role="assistant"]');
      expect(adapter.getResponseSelector()).toContain('article[data-turn="assistant"]');
    });

    it('should create Gemini adapter', () => {
      const adapter = factory.create(TargetSite.GEMINI);
      expect(adapter).toBeDefined();
      expect(adapter.getResponseSelector()).toBe('.model-response-text');
    });

    it('should throw error for unsupported site', () => {
      expect(() => factory.create('unknown')).toThrow('Unsupported site');
    });
  });

  describe('ChatGPT adapter', () => {
    it('should identify AI response elements correctly', () => {
      const adapter = factory.create(TargetSite.CHATGPT);
      const element = document.createElement('div');
      element.setAttribute('data-message-author-role', 'assistant');
      expect(adapter.isAiResponseElement(element)).toBe(true);
    });

    it('should not identify user elements as AI responses', () => {
      const adapter = factory.create(TargetSite.CHATGPT);
      const element = document.createElement('div');
      element.setAttribute('data-message-author-role', 'user');
      expect(adapter.isAiResponseElement(element)).toBe(false);
    });

    it('should extract text from element', () => {
      const adapter = factory.create(TargetSite.CHATGPT);
      const element = document.createElement('div');
      element.textContent = 'Hello world';
      expect(adapter.extractTextFromElement(element)).toBe('Hello world');
    });
  });

  describe('Gemini adapter', () => {
    it('should identify AI response elements correctly', () => {
      const adapter = factory.create(TargetSite.GEMINI);
      const element = document.createElement('div');
      element.classList.add('model-response-text');
      expect(adapter.isAiResponseElement(element)).toBe(true);
    });

    it('should extract text from element', () => {
      const adapter = factory.create(TargetSite.GEMINI);
      const element = document.createElement('div');
      element.textContent = 'Test response';
      expect(adapter.extractTextFromElement(element)).toBe('Test response');
    });
  });
});
