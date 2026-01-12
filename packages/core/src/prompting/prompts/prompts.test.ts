import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildPrompt } from '../build-prompt';
import { PROMPT_BEHAVIORS } from '../behaviors';

import { parseSubtitleEnhanceResponse } from './subtitle-prompts';
import { parseTermTranslateResponse, parseTranslateKeywordsResponse } from './translate-prompts';
import { parseExplainWordResponse, parseKeywordSelectResponse, parseWebEnhanceResponse } from './vocab-prompts';

// =============================================================================
// buildPrompt (string assembly)
// =============================================================================

describe('buildPrompt', () => {
  it('translate_keywords: keeps <用户输入> pure and renders optional <上下文信息>', () => {
    const noContext = buildPrompt({
      agentKey: 'translate_keywords',
      sceneKey: 'keyword_translate',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      userInput: 'hello\nworld',
    });

    expect(noContext).toContain('<用户输入>');
    expect(noContext).not.toMatch(/<上下文信息>\n/);

    const withContext = buildPrompt({
      agentKey: 'translate_keywords',
      sceneKey: 'keyword_translate',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      contextInfo: { before: ['This is a greeting'], after: [] },
      userInput: 'hello\nworld',
    });

    const userInputMatch = withContext.match(/<用户输入>\n([\s\S]*?)\n<\/用户输入>/);
    expect(userInputMatch).toBeTruthy();
    expect(userInputMatch![1]).toBe('hello\nworld');
    expect(withContext).toContain('<上下文信息>');
    expect(withContext).toContain('This is a greeting');
  });

  it('term_translate: includes terms and line-based output format', () => {
    const prompt = buildPrompt({
      agentKey: 'term_translate',
      sceneKey: 'term_translate',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      userInput: 'hello\nworld',
    });

    expect(prompt).toContain('<用户输入>');
    expect(prompt).toContain('hello');
    expect(prompt).toContain('world');
    expect(prompt).toContain('<输出格式>');
    expect(prompt).toContain('translation_1');
  });

  it('web_enhance: includes content and JSON schema hints', () => {
    const prompt = buildPrompt({
      agentKey: 'web_enhance',
      sceneKey: 'web_content',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      userInput: ['参数：', '- difficultyMin: B1', '- difficultyMax: B2', '- maxWords: 10', '', 'This is a test sentence.'].join(
        '\n'
      ),
    });

    expect(prompt).toContain('<用户信息>');
    expect(prompt).toContain('<用户输入>');
    expect(prompt).toContain('<输出格式>');
    expect(prompt).toContain('<输出说明>');
    expect(prompt).toContain('This is a test sentence.');
    expect(prompt).toContain('"convert_word"');
    expect(prompt).toContain('difficultyMin');
    expect(prompt).toContain('maxWords');
  });

  it('keyword_select: includes constraints and input text', () => {
    const prompt = buildPrompt({
      agentKey: 'keyword_select',
      sceneKey: 'keyword_select_subtitle',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      userInput: 'This is a test subtitle about taking off and getting used to it.',
    });

    expect(prompt).toContain('关键词');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('This is a test subtitle');
    expect(prompt).toContain('<用户输入>');
  });

  it('explain_word: omits <上下文信息> when absent, renders it when provided', () => {
    const noContext = buildPrompt({
      agentKey: 'explain_word',
      sceneKey: 'word_card',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      userInput: 'serendipity',
    });

    expect(noContext).toContain('serendipity');
    expect(noContext).toContain('<用户信息>');
    expect(noContext).toContain('<用户输入>');
    expect(noContext).not.toMatch(/<上下文信息>\n/);
    expect(noContext).toContain('"translation"');
    expect(noContext).toContain('"definition"');

    const withContext = buildPrompt({
      agentKey: 'explain_word',
      sceneKey: 'word_card',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      contextInfo: { before: ['I walked along the river bank.'], after: [] },
      userInput: 'bank',
    });

    expect(withContext).toContain('bank');
    expect(withContext).toContain('<上下文信息>');
    expect(withContext).toContain('I walked along the river bank.');
  });

  it('subtitle_adapt: includes subtitle text and line-based output format', () => {
    const prompt = buildPrompt({
      agentKey: 'subtitle_adapt',
      sceneKey: 'video_subtitle',
      styleKey: 'default',
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1', targetLearningLanguageLevel: 'C1' },
      userInput: ['sourceLang: zh', 'targetLang: en', '', '你好，欢迎回来。'].join('\n'),
    });

    expect(prompt).toContain('你好');
    expect(prompt).toContain('<输出格式>');
    expect(prompt).toContain('sentence_1');
  });
});

// =============================================================================
// Parsers (LLM output parsing)
// =============================================================================

describe('parseTranslateKeywordsResponse', () => {
  it('parses newline-separated translations', () => {
    const result = parseTranslateKeywordsResponse('你好\n世界\n', 2);
    expect(result.ok).toBe(true);
    expect(result.translations).toEqual(['你好', '世界']);
  });

  it('strips numbering and bullets', () => {
    const result = parseTranslateKeywordsResponse('1. 你好\n- 世界\n', 2);
    expect(result.ok).toBe(true);
    expect(result.translations).toEqual(['你好', '世界']);
  });

  it('fails when line count mismatches', () => {
    const result = parseTranslateKeywordsResponse('你好\n世界\n', 3);
    expect(result.ok).toBe(false);
    expect(result.translations).toEqual(['你好', '世界']);
  });
});

describe('parseTermTranslateResponse', () => {
  it('parses direct JSON object', () => {
    const result = parseTermTranslateResponse('{"hello":"你好","world":"世界"}');
    expect(result.ok).toBe(true);
    expect(result.translations.hello).toBe('你好');
    expect(result.translations.world).toBe('世界');
  });

  it('parses wrapped translations object', () => {
    const result = parseTermTranslateResponse('{"translations":{"hello":"你好"}}');
    expect(result.ok).toBe(true);
    expect(result.translations.hello).toBe('你好');
  });

  it('parses fenced JSON', () => {
    const result = parseTermTranslateResponse('```json\n{\"hello\":\"你好\"}\n```');
    expect(result.ok).toBe(true);
    expect(result.translations.hello).toBe('你好');
  });
});

describe('parseKeywordSelectResponse', () => {
  it('parses a plain JSON array', () => {
    const result = parseKeywordSelectResponse('["take off","get used to","subtitle"]');
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['take off', 'get used to', 'subtitle']);
  });

  it('parses JSON wrapped in code fences', () => {
    const result = parseKeywordSelectResponse('```json\n["a","b"]\n```');
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['a', 'b']);
  });

  it('extracts the first JSON array from extra text', () => {
    const response = 'Here you go:\n["alpha","beta"]\nThanks!';
    const result = parseKeywordSelectResponse(response);
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['alpha', 'beta']);
  });

  it('dedupes case-insensitively and trims whitespace', () => {
    const result = parseKeywordSelectResponse('["  Test  ","test","TEST","another"]');
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['Test', 'another']);
  });

  it('returns ok=false on invalid JSON', () => {
    const result = parseKeywordSelectResponse('not json');
    expect(result.ok).toBe(false);
    expect(result.keywords).toEqual([]);
  });
});

describe('parseExplainWordResponse', () => {
  it('parses complete response with all fields', () => {
    const response = JSON.stringify({
      translation: '偶然发现',
      phonetic: '/ˌser.ənˈdɪp.ɪ.ti/',
      difficulty: 'C2',
      definition: '意外发现有价值事物的能力',
      example: 'Finding this restaurant was pure serendipity.',
      example_translation: '发现这家餐厅纯属偶然。',
    });

    const result = parseExplainWordResponse(response);

    expect(result.translation).toBe('偶然发现');
    expect(result.phonetic).toBe('/ˌser.ənˈdɪp.ɪ.ti/');
    expect(result.difficulty).toBe('C2');
    expect(result.definition).toBe('意外发现有价值事物的能力');
    expect(result.example).toBe('Finding this restaurant was pure serendipity.');
    expect(result.example_translation).toBe('发现这家餐厅纯属偶然。');
  });

  it('throws when required fields are missing', () => {
    const response = JSON.stringify({
      translation: '测试',
      difficulty: 'A2',
      definition: 'A test',
    });

    expect(() => parseExplainWordResponse(response)).toThrow('Missing required fields');
  });
});

describe('parseWebEnhanceResponse', () => {
  it('parses plain JSON response', () => {
    const response = JSON.stringify({
      content_result: 'This is a test',
      convert_word: [{ original: 'test', converted: '测试', difficulty: 'A2' }],
    });

    const result = parseWebEnhanceResponse(response);
    expect(result.content_result).toBe('This is a test');
    expect(result.convert_word).toHaveLength(1);
    expect(result.convert_word?.[0]?.original).toBe('test');
  });

  it('throws error for invalid JSON', () => {
    expect(() => parseWebEnhanceResponse('not valid json')).toThrow('Failed to parse');
  });
});

describe('parseSubtitleEnhanceResponse', () => {
  it('parses JSON wrapped in markdown code block', () => {
    const response = `\`\`\`json
{
  "line1_final": "Test subtitle",
  "line2_final": "测试字幕"
}
\`\`\``;

    const result = parseSubtitleEnhanceResponse(response);

    expect(result.line1_final).toBe('Test subtitle');
    expect(result.line2_final).toBe('测试字幕');
  });

  it('throws error if line1_final is missing', () => {
    const response = JSON.stringify({
      line2_final: 'Only second line',
    });

    expect(() => parseSubtitleEnhanceResponse(response)).toThrow('Missing required field: line1_final');
  });
});

// =============================================================================
// Prompt samples (manual inspection)
// =============================================================================

describe('prompt samples', () => {
  it('writes built prompts into a markdown-wrapped txt file', async () => {
    const userInfo = {
      motherTongue: 'zh-CN',
      targetLearningLanguage: 'en',
      cefrLevel: 'B1',
      targetLearningLanguageLevel: 'C1',
    } as const;

    const agentKeys = Object.keys(PROMPT_BEHAVIORS).sort((a, b) => a.localeCompare(b));
    expect(agentKeys.length).toBeGreaterThan(0);

    function guessSceneKey(agentKey: string): string {
      if (agentKey === 'subtitle_adapt') return 'video_subtitle';
      if (agentKey === 'keyword_select') return 'keyword_select_subtitle';
      if (agentKey === 'translate_keywords') return 'keyword_translate';
      if (agentKey === 'term_translate') return 'term_translate';
      if (agentKey === 'english_correction') return 'english_correction';
      if (agentKey === 'web_enhance') return 'web_content';
      if (agentKey === 'explain_word') return 'word_card';
      return 'word_card';
    }

    function guessUserInput(agentKey: string): string {
      if (agentKey === 'keyword_select') return 'This is a test subtitle about taking off and getting used to it.';
      if (agentKey === 'translate_keywords') return 'hello\nworld';
      if (agentKey === 'term_translate') return 'term_1\nterm_2';
      if (agentKey === 'english_correction') return 'He go to school yesterday.';
      if (agentKey === 'explain_word') return 'serendipity';
      if (agentKey === 'web_enhance')
        return ['参数：', '- difficultyMin: B1', '- difficultyMax: B2', '- maxWords: 10', '', 'This is a test sentence.'].join(
          '\n'
        );
      if (agentKey === 'subtitle_adapt') return ['sourceLang: zh', 'targetLang: en', '', '你好，欢迎回来。'].join('\n');
      return 'SAMPLE_INPUT';
    }

    const header = [
      '# Prompt Samples (generated)',
      '',
      'Each prompt is wrapped in a Markdown code fence for easy copy/paste.',
      '',
      `agentKeys: ${agentKeys.join(', ')}`,
      '',
    ].join('\n');

    const blocks = agentKeys.flatMap((agentKey) => {
      const sceneKey = guessSceneKey(agentKey);
      const userInput = guessUserInput(agentKey);
      const base = buildPrompt({
        agentKey,
        sceneKey,
        styleKey: 'default',
        userInfo,
        userInput,
      });

      const pieces: string[] = [];
      pieces.push([`## agentKey: ${agentKey}`, '```text', base.replace(/\r\n/g, '\n').trimEnd(), '```', ''].join('\n'));

      // For a small subset, also output a "with context" variant to showcase the optional tag behavior.
      if (agentKey === 'translate_keywords' || agentKey === 'explain_word') {
        const withContext = buildPrompt({
          agentKey,
          sceneKey,
          styleKey: 'default',
          userInfo,
          contextInfo: { before: ['This is a greeting / context line.'], after: [] },
          userInput,
        });
        pieces.push(
          [
            `## agentKey: ${agentKey} (with context)`,
            '```text',
            withContext.replace(/\r\n/g, '\n').trimEnd(),
            '```',
            '',
          ].join('\n')
        );
      }

      return pieces;
    });

    const output = [header, ...blocks].join('\n');
    const outFile = resolve(process.cwd(), 'packages/core/src/prompting/prompt-samples.txt');
    await writeFile(outFile, output, { encoding: 'utf8' });
  });
});
