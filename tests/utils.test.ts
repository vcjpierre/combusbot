import { describe, it, expect } from 'vitest';
import { escapeMarkdown, escapeHtml } from '../src/types';

describe('escapeMarkdown', () => {
  it('should escape asterisks', () => {
    expect(escapeMarkdown('hello *world*')).toBe('hello \\*world\\*');
  });

  it('should escape underscores', () => {
    expect(escapeMarkdown('hello_world')).toBe('hello\\_world');
  });

  it('should escape backticks', () => {
    expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
  });

  it('should escape brackets', () => {
    expect(escapeMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)');
  });

  it('should escape tildes', () => {
    expect(escapeMarkdown('~strike~')).toBe('\\~strike\\~');
  });

  it('should escape backslashes', () => {
    expect(escapeMarkdown('a\\b')).toBe('a\\\\b');
  });

  it('should not modify plain text', () => {
    expect(escapeMarkdown('hello world 123')).toBe('hello world 123');
  });

  it('should escape multiple special chars', () => {
    const input = '*bold* _italic_ `code` [link](url)';
    const result = escapeMarkdown(input);
    expect(result).toContain('\\*bold\\*');
    expect(result).toContain('\\_italic\\_');
    expect(result).toContain('\\`code\\`');
    expect(result).toContain('\\[link\\]');
  });
});

describe('escapeHtml', () => {
  it('should escape ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should escape angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });
});
