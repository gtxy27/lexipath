import { describe, expect, it } from 'vitest';
import {
  analyzeTextQuality,
  detectPrimaryLanguage,
  getChannel,
  isUrlInSiteList,
  matchSiteRule,
  qualifyContent,
  qualifySite,
} from './index';

describe('matchSiteRule', () => {
  it('matches host rules (including subdomains)', () => {
    expect(
      matchSiteRule({ url: 'https://www.youtube.com/watch?v=123', rule: 'youtube.com' }).matched
    ).toBe(true);
    expect(matchSiteRule({ url: 'https://example.com', rule: 'youtube.com' }).matched).toBe(false);
  });

  it('matches host + path prefix rules', () => {
    expect(matchSiteRule({ url: 'https://example.com/a/b', rule: 'example.com/a' }).matched).toBe(
      true
    );
    expect(matchSiteRule({ url: 'https://example.com/a/b', rule: 'example.com/b' }).matched).toBe(
      false
    );
  });

  it('matches URL prefix rules', () => {
    expect(
      matchSiteRule({ url: 'https://example.com/a?x=1', rule: 'https://example.com/a' }).matched
    ).toBe(true);
  });

  it('supports simple wildcard rules', () => {
    expect(matchSiteRule({ url: 'https://a.example.com/x', rule: '*.example.com/*' }).matched).toBe(
      true
    );
    expect(matchSiteRule({ url: 'https://www.youtube.com/watch?v=1', rule: '*youtube*' }).matched).toBe(
      true
    );
  });
});

describe('isUrlInSiteList', () => {
  it('returns matchedRule when a rule matches', () => {
    expect(
      isUrlInSiteList({
        url: 'https://sub.example.com/path',
        sites: ['youtube.com', 'example.com/path'],
      })
    ).toEqual({ matched: true, matchedRule: 'example.com/path' });
  });
});

describe('qualifySite', () => {
  it('blocks excluded sites in all mode', () => {
    expect(
      qualifySite({
        url: 'https://example.com',
        settings: { siteMode: 'all', excludedSites: ['example.com'], allowedSites: [] },
      })
    ).toEqual({ qualified: false, reason: 'excluded', matchedRule: 'example.com' });
  });

  it('allows non-excluded sites in all mode', () => {
    expect(
      qualifySite({
        url: 'https://example.com',
        settings: { siteMode: 'all', excludedSites: [], allowedSites: [] },
      }).qualified
    ).toBe(true);
  });

  it('enforces whitelist mode (allow list wins unless excluded)', () => {
    expect(
      qualifySite({
        url: 'https://example.com',
        settings: { siteMode: 'whitelist', excludedSites: [], allowedSites: ['example.com'] },
      }).qualified
    ).toBe(true);

    expect(
      qualifySite({
        url: 'https://example.com',
        settings: { siteMode: 'whitelist', excludedSites: [], allowedSites: [] },
      })
    ).toEqual({ qualified: false, reason: 'not_in_whitelist' });
  });

  it('returns invalid_url for invalid inputs', () => {
    expect(
      qualifySite({
        url: 'not-a-url',
        settings: { siteMode: 'all', excludedSites: [], allowedSites: [] },
      })
    ).toEqual({ qualified: false, reason: 'invalid_url' });
  });
});

describe('detectPrimaryLanguage', () => {
  it('detects zh', () => {
    const result = detectPrimaryLanguage({ text: '这是一个测试。我们正在学习。' });
    expect(result.language).toBe('zh');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('detects ja (kana)', () => {
    const result = detectPrimaryLanguage({ text: 'これはテストです。日本語を勉強します。' });
    expect(result.language).toBe('ja');
  });

  it('detects ko (hangul)', () => {
    const result = detectPrimaryLanguage({ text: '이것은 테스트입니다. 한국어를 공부합니다.' });
    expect(result.language).toBe('ko');
  });

  it('detects en/fr/de (latin)', () => {
    expect(detectPrimaryLanguage({ text: 'This is a test and it works.' }).language).toBe('en');
    expect(detectPrimaryLanguage({ text: "C'est un test et il fonctionne." }).language).toBe('fr');
    expect(detectPrimaryLanguage({ text: 'Das ist ein Test und es funktioniert.' }).language).toBe(
      'de'
    );
  });

  it('returns unknown for non-language text', () => {
    expect(detectPrimaryLanguage({ text: '12345 !!!' }).language).toBe('unknown');
  });
});

describe('getChannel', () => {
  it('maps detected language to native/target/else based on settings', () => {
    const settings = { nativeLanguage: 'zh-CN', targetLanguage: 'en' } as const;

    expect(getChannel({ language: 'zh', settings }).channel).toBe('native');
    expect(getChannel({ language: 'en', settings }).channel).toBe('target');
    expect(getChannel({ language: 'ja', settings }).channel).toBe('else');
    expect(getChannel({ language: 'unknown', settings }).channel).toBe('else');
  });
});

describe('analyzeTextQuality', () => {
  it('skips empty text', () => {
    expect(analyzeTextQuality({ text: '   ' })).toMatchObject({ skippable: true, reason: 'empty' });
  });

  it('skips too-short text by default', () => {
    expect(analyzeTextQuality({ text: 'Hi' })).toMatchObject({ skippable: true, reason: 'too_short' });
  });

  it('skips suspicious repetition as junk', () => {
    const result = analyzeTextQuality({ text: 'a'.repeat(30) });
    expect(result.skippable).toBe(true);
    expect(result.reason).toBe('junk');
  });
});

describe('qualifyContent', () => {
  const settings = { nativeLanguage: 'zh-CN', targetLanguage: 'en' } as const;

  it('allows target-language paragraphs', () => {
    const result = qualifyContent({
      text: 'This is a simple paragraph and it should be processed by the qualify logic.',
      settings,
    });
    expect(result.qualified).toBe(true);
    expect(result.channel).toBe('target');
    expect(result.reason).toBe('allowed');
  });

  it('blocks native-language paragraphs', () => {
    const result = qualifyContent({
      text: '这是一个足够长的中文段落，用于验证内容门控逻辑应该将其判定为母语并跳过。',
      settings,
    });
    expect(result.qualified).toBe(false);
    expect(result.channel).toBe('native');
    expect(result.reason).toBe('native_language');
  });

  it('blocks other-language paragraphs', () => {
    const result = qualifyContent({
      text: 'これは十分に長い日本語の段落であり、ターゲット言語ではないためスキップされます。',
      settings,
    });
    expect(result.qualified).toBe(false);
    expect(result.channel).toBe('else');
    expect(result.reason).toBe('other_language');
  });

  it('can return unknown_language when thresholds are relaxed', () => {
    const result = qualifyContent({
      text: 'Test',
      settings,
      minNormalizedLength: 0,
      minLetterLikeChars: 0,
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('unknown_language');
  });
});

