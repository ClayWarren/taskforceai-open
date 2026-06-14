import { describe, expect, it } from 'bun:test';

import { basicYamlParse, yamlParser } from './yaml';

describe('basicYamlParse', () => {
  it('should parse simple key-value pairs', () => {
    const yaml = 'key: value\nnumber: 123\nboolean: true';
    const result = basicYamlParse(yaml) as any;
    expect(result.key).toBe('value');
    expect(result.number).toBe(123);
    expect(result.boolean).toBe(true);
  });

  it('should handle null values', () => {
    const yaml = 'api_key: null';
    const result = basicYamlParse(yaml) as any;
    expect(result.api_key).toBe(null);
  });

  it('should parse JSON-looking content and wrap invalid JSON failures', () => {
    expect(basicYamlParse('{"enabled":true,"count":2}')).toEqual({
      enabled: true,
      count: 2,
    });
    expect(() => basicYamlParse('{"enabled":')).toThrow('Failed to parse YAML');
  });

  it('should parse scalar edge values', () => {
    const result = basicYamlParse(`
truthy: true
falsy: false
emptySingle: ''
emptyDouble: ""
quotedNumber: "123"
plainNumber: 123
    `) as any;

    expect(result.truthy).toBe(true);
    expect(result.falsy).toBe(false);
    expect(result.emptySingle).toBe('');
    expect(result.emptyDouble).toBe('');
    expect(result.quotedNumber).toBe('123');
    expect(result.plainNumber).toBe(123);
  });

  it('should handle nested objects', () => {
    const yaml = 'gateway:\n  api_key: null\n  base_url: "https://api.vercel.ai/v1"';
    const result = basicYamlParse(yaml) as any;
    expect(result.gateway.api_key).toBe(null);
    expect(result.gateway.base_url).toBe('https://api.vercel.ai/v1');
  });

  it('should handle lists of objects', () => {
    const yaml = `
models:
  options:
    - id: 'model-1'
      label: 'Model 1'
    - id: 'model-2'
      label: 'Model 2'
    `;
    const result = basicYamlParse(yaml) as any;
    expect(result.models.options).toHaveLength(2);
    expect(result.models.options[0].id).toBe('model-1');
    expect(result.models.options[1].id).toBe('model-2');
  });

  it('should handle multi-line strings with |', () => {
    const yaml = `
system_prompt: |
  Line 1
  Line 2
  
  Line 4
next_key: value
    `;
    const result = basicYamlParse(yaml) as any;
    expect(result.system_prompt).toBe('Line 1\nLine 2\n\nLine 4');
    expect(result.next_key).toBe('value');
  });

  it('should handle comments', () => {
    const yaml = `
# This is a comment
key: value # inline comment
    `;
    const result = basicYamlParse(yaml) as any;
    expect(result.key).toBe('value');
  });

  it('should keep hashes that are not comment delimiters', () => {
    const result = basicYamlParse('tag: value#not-comment') as any;
    expect(result.tag).toBe('value#not-comment');
  });

  it('should handle simple nested lists', () => {
    const result = basicYamlParse(`
items:
  - first
  - "second"
    `) as any;

    expect(result.items).toEqual(['first', 'second']);
  });

  it('should treat non-key lines as empty nested keys', () => {
    expect(basicYamlParse('loose-value')).toEqual({ 'loose-value': {} });
  });

  it('should preserve hash characters inside quoted strings', () => {
    const yaml = `
title: "Sprint #1"
single: 'Issue #42'
    `;
    const result = basicYamlParse(yaml) as any;
    expect(result.title).toBe('Sprint #1');
    expect(result.single).toBe('Issue #42');
  });

  it('should handle a complex real-world-like config', () => {
    const yaml = `
gateway:
  api_key: null
  base_url: 'https://api.vercel.ai/v1'
  model: 'xai/grok-4.3'

models:
  default: 'xai/grok-4.3'
  options:
    - id: 'xai/grok-4.3'
      usageMultiple: 0.1
    - id: 'xai/grok-4.3'
      usageMultiple: 2

agent:
  max_iterations: 5
    `;
    const result = basicYamlParse(yaml) as any;
    expect(result.gateway.api_key).toBe(null);
    expect(result.gateway.base_url).toBe('https://api.vercel.ai/v1');
    expect(result.models.options).toHaveLength(2);
    expect(result.models.options[0].id).toBe('xai/grok-4.3');
    expect(result.models.options[0].usageMultiple).toBe(0.1);
    expect(result.agent.max_iterations).toBe(5);
  });

  it('should use the universal parser facade', () => {
    const result = yamlParser.parse('name: taskforce') as any;
    expect(result.name).toBe('taskforce');
  });
});
