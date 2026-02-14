import { describe, it, expect } from 'vitest';
import {
  canonicalizeVendor,
  flattenOtelAttributes,
  isLLMTool,
} from '../vendor-map.js';

describe('canonicalizeVendor', () => {
  it('returns anthropic for Claude attributes', () => {
    const result = canonicalizeVendor({
      'gen_ai.system': 'anthropic',
      'service.name': 'test',
    });
    expect(result.slug).toBe('anthropic');
    expect(result.displayName).toBe('Anthropic (Claude)');
    expect(result.category).toBe('llm');
  });

  it('returns openai for GPT model attributes', () => {
    const result = canonicalizeVendor({
      'gen_ai.request.model': 'gpt-4o',
      'service.name': 'test',
    });
    expect(result.slug).toBe('openai');
    expect(result.category).toBe('llm');
  });

  it('returns openrouter for OpenRouter attributes', () => {
    const result = canonicalizeVendor({
      'gen_ai.system': 'openrouter',
      'service.name': 'openrouter-proxy',
    });
    expect(result.slug).toBe('openrouter');
    expect(result.category).toBe('llm');
  });

  it('returns cloudflare-workers for Cloudflare attributes', () => {
    const result = canonicalizeVendor({
      'cloud.provider': 'cloudflare',
      'service.name': 'my-worker',
    });
    expect(result.slug).toBe('cloudflare-workers');
    expect(result.category).toBe('runtime');
  });

  it('returns cursor for Cursor IDE attributes', () => {
    const result = canonicalizeVendor({
      'service.name': 'cursor-agent',
      'process.executable.name': 'Cursor',
    });
    expect(result.slug).toBe('cursor');
    expect(result.category).toBe('ide');
  });

  it('falls back to slugified service.name when no matcher hits', () => {
    const result = canonicalizeVendor({
      'service.name': 'My Custom Service',
    });
    expect(result.slug).toBe('my-custom-service');
    expect(result.displayName).toBe('My Custom Service');
    expect(result.category).toBe('unknown');
  });

  it('returns unknown when service.name is empty', () => {
    const result = canonicalizeVendor({});
    expect(result.slug).toBe('unknown');
    expect(result.displayName).toBe('unknown');
    expect(result.category).toBe('unknown');
  });
});

describe('flattenOtelAttributes', () => {
  it('converts OTEL attribute array to flat record', () => {
    const attrs = [
      { key: 'service.name', value: { stringValue: 'test-svc' } },
      { key: 'count', value: { intValue: 42 } },
      { key: 'enabled', value: { boolValue: true } },
      { key: 'ratio', value: { doubleValue: 0.5 } },
    ];
    const result = flattenOtelAttributes(attrs);
    expect(result['service.name']).toBe('test-svc');
    expect(result.count).toBe('42');
    expect(result.enabled).toBe('true');
    expect(result.ratio).toBe('0.5');
  });

  it('returns empty object for undefined or null', () => {
    expect(flattenOtelAttributes(undefined)).toEqual({});
    expect(flattenOtelAttributes(null as any)).toEqual({});
  });

  it('returns empty object for non-array', () => {
    expect(flattenOtelAttributes('not-array' as any)).toEqual({});
  });

  it('skips attributes with no value', () => {
    const attrs = [
      { key: 'hasValue', value: { stringValue: 'yes' } },
      { key: 'noValue' },
    ];
    const result = flattenOtelAttributes(attrs);
    expect(result.hasValue).toBe('yes');
    expect(result.noValue).toBeUndefined();
  });
});

describe('isLLMTool', () => {
  it('returns true for llm vendor category', () => {
    expect(isLLMTool({}, { slug: 'anthropic', displayName: 'Anthropic', category: 'llm' })).toBe(true);
  });

  it('returns true when gen_ai.system is set', () => {
    expect(isLLMTool({ 'gen_ai.system': 'anthropic' })).toBe(true);
  });

  it('returns true when gen_ai.request.model or gen_ai.response.model is set', () => {
    expect(isLLMTool({ 'gen_ai.request.model': 'gpt-4' })).toBe(true);
    expect(isLLMTool({ 'gen_ai.response.model': 'claude-3' })).toBe(true);
  });

  it('returns false for non-LLM attributes without vendor', () => {
    expect(isLLMTool({ 'service.name': 'http-server' })).toBe(false);
  });
});
