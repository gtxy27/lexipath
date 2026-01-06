import type { CEFRLevel, NativeLanguage, SupportedLanguage } from '../types';

export type PromptBehavior<TParams extends object> = {
  role: string;
  task: (params: TParams) => string;
  outputFormat: (params: TParams) => string;
  outputNotes: (params: TParams) => string;
};

function getLanguageName(lang: SupportedLanguage | NativeLanguage): string {
  const names: Record<string, string> = {
    en: '英语',
    ja: '日语',
    ko: '韩语',
    fr: '法语',
    de: '德语',
    zh: '中文',
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
  };
  return names[lang] || String(lang);
}

export const BEHAVIORS = {
  subtitle_enhance: {
    role: '你是字幕增强助手。',
    task: (params: {
      sourceLang: SupportedLanguage;
      targetLang: NativeLanguage;
      difficultyLevel: CEFRLevel;
      mode: 'single' | 'bilingual';
    }) => {
      const sourceLanguageName = getLanguageName(params.sourceLang);
      const targetLanguageName = getLanguageName(params.targetLang);
      return params.mode === 'single'
        ? `任务：将<用户输入>中的${sourceLanguageName}字幕改写到符合 CEFR ${params.difficultyLevel} 水平，同时保持口语自然、适合字幕显示。只返回增强后的${sourceLanguageName}字幕内容。`
        : `任务：将<用户输入>中的${sourceLanguageName}字幕处理为双语展示：line1_final 为符合 CEFR ${params.difficultyLevel} 的增强${sourceLanguageName}字幕，line2_final 为${targetLanguageName}对照翻译。`;
    },
    outputFormat: (params: { mode: 'single' | 'bilingual' }) =>
      params.mode === 'single'
        ? `{
  "line1_final": ""
}`
        : `{
  "line1_final": "",
  "line2_final": ""
}`,
    outputNotes: (params: {
      cefrGuidance: string;
      sourceLang: SupportedLanguage;
      targetLang: NativeLanguage;
      difficultyLevel: CEFRLevel;
      mode: 'single' | 'bilingual';
    }) => {
      const sourceLanguageName = getLanguageName(params.sourceLang);
      const targetLanguageName = getLanguageName(params.targetLang);
      return [
        params.cefrGuidance,
        '',
        '规则：',
        params.mode === 'single'
          ? `1. 词汇与语法难度适配 CEFR ${params.difficultyLevel}`
          : `1. line1_final：将${sourceLanguageName}字幕改写到符合 CEFR ${params.difficultyLevel} 水平`,
        params.mode === 'single'
          ? '2. 保持核心含义不变'
          : `2. line2_final：提供${targetLanguageName}翻译用于对照`,
        params.mode === 'single'
          ? '3. 字幕长度合理（最多 2 行，每行约 40 个字符以内）'
          : '3. 每行尽量控制在约 40 个字符以内，便于阅读',
        params.mode === 'single' ? '4. 使用自然、口语化表达' : '4. 两行都要保持核心含义一致',
        params.mode === 'single'
          ? `5. 只返回增强后的${sourceLanguageName}字幕内容`
          : '5. 使用自然、口语化表达',
        '6. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
      ].join('\n');
    },
  } satisfies PromptBehavior<{
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    difficultyLevel: CEFRLevel;
    mode: 'single' | 'bilingual';
    cefrGuidance: string;
  }>,

  subtitle_adapt: {
    role: '你是字幕学习翻译助手。',
    task: (params: {
      sourceLang: SupportedLanguage;
      targetLang: SupportedLanguage;
      difficultyLevel: CEFRLevel;
    }) => {
      const sourceName = getLanguageName(params.sourceLang);
      const targetName = getLanguageName(params.targetLang);
      return `任务：将<用户输入>中的${sourceName}字幕翻译为${targetName}，并将表达难度调整到 CEFR ${params.difficultyLevel} 水平；保持核心含义不变；字幕长度合理（最多 2 行，每行约 40 个字符以内）。`;
    },
    outputFormat: (_params) => `{
  "line1_final": ""
}`,
    outputNotes: (params: {
      cefrGuidance: string;
      targetLang: SupportedLanguage;
      difficultyLevel: CEFRLevel;
    }) => {
      const targetName = getLanguageName(params.targetLang);
      return [
        params.cefrGuidance,
        '',
        '规则：',
        '1. 保持核心含义不变',
        `2. 输出必须是${targetName}`,
        `3. 难度适配 CEFR ${params.difficultyLevel}（词汇与句式尽量符合该水平）`,
        '4. 字幕长度合理（最多 2 行，每行约 40 个字符以内）',
        '5. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
      ].join('\n');
    },
  } satisfies PromptBehavior<{
    sourceLang: SupportedLanguage;
    targetLang: SupportedLanguage;
    difficultyLevel: CEFRLevel;
    cefrGuidance: string;
  }>,

  explain_word: {
    role: '你是词汇学习助手。',
    task: (params: { sourceLang: SupportedLanguage; targetLang: NativeLanguage; userLevel: CEFRLevel }) => {
      const sourceLanguageName = getLanguageName(params.sourceLang);
      const targetLanguageName = getLanguageName(params.targetLang);
      return `任务：为一个 CEFR ${params.userLevel} 水平的语言学习者解释<用户输入>中的${sourceLanguageName}单词/短语，输出${targetLanguageName}的解释与学习信息。`;
    },
    outputFormat: (_params) => `{
  "translation": "",
  "phonetic": "",
  "difficulty": "",
  "definition": "",
  "example": "",
  "example_translation": ""
}`,
    outputNotes: (params: {
      cefrGuidance: string;
      targetLang: NativeLanguage;
      sourceLang: SupportedLanguage;
      userLevel: CEFRLevel;
      phoneticInstruction: string;
      hasContext: boolean;
    }) => {
      const sourceLanguageName = getLanguageName(params.sourceLang);
      const targetLanguageName = getLanguageName(params.targetLang);
      return [
        params.cefrGuidance,
        '',
        '字段要求：',
        `1. translation：翻译成${targetLanguageName}`,
        `2. phonetic：${params.phoneticInstruction}`,
        '3. difficulty：CEFR 等级（A1/A2/B1/B2/C1/C2）',
        `4. definition：用${targetLanguageName}给出简明释义（难度适配 CEFR ${params.userLevel}）`,
        `5. example：${sourceLanguageName}例句（仅在未提供语境时给出）`,
        `6. example_translation：例句的${targetLanguageName}翻译（仅在给出 example 时给出）`,
        '',
        '输出要求：',
        '1. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
        `2. 释义尽量简洁、口语化，适合 CEFR ${params.userLevel} 学习者`,
        `3. 如果有多个含义：优先选择与语境最相关的那个${params.hasContext ? '' : '；若无语境则选择最常见含义'}`,
      ].join('\n');
    },
  } satisfies PromptBehavior<{
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    userLevel: CEFRLevel;
    cefrGuidance: string;
    phoneticInstruction: string;
    hasContext: boolean;
  }>,

  keyword_select: {
    role: '你是关键词选择助手。',
    task: (params: { userLevel: CEFRLevel }) =>
      `任务：从<用户输入>中挑选对学习者最有价值的关键词/短语。学习目标：优先选择对 CEFR ${params.userLevel} 有提升价值的词/短语（接近或略高于该水平），不要挑太基础的词。`,
    outputFormat: (_params) => `[""]`,
    outputNotes: (_params) =>
      [
        '规则（非常重要）：',
        '1. 只输出一个 JSON 字符串数组（string array）；不要 Markdown、不要代码块、不要任何额外文字',
        '2. 数组中的每个元素必须是原文中出现的：一个单词或一个短语（固定搭配/短语动词/习语）；短语优先',
        '3. 排除人名、地名等专有名词',
        '4. 排除基础数字/计数词（例如 3、three），除非它对句子含义至关重要',
        '5. 最多返回 8 个元素',
        '6. 不要输出索引/位置等信息',
      ].join('\n'),
  } satisfies PromptBehavior<{ userLevel: CEFRLevel }>,

  web_enhance: {
    role: '你是词汇学习助手。',
    task: (params: {
      sourceLang: SupportedLanguage;
      targetLang: NativeLanguage;
      difficultyMin: CEFRLevel;
      difficultyMax: CEFRLevel;
      maxWords: number;
    }) => {
      const difficultyLabel =
        params.difficultyMin === params.difficultyMax
          ? params.difficultyMin
          : `${params.difficultyMin}-${params.difficultyMax}`;
      const sourceLanguageName = getLanguageName(params.sourceLang);
      const targetLanguageName = getLanguageName(params.targetLang);
      return `任务：分析<用户输入>中的${sourceLanguageName}文本，为语言学习者挑选最多 ${params.maxWords} 个值得学习的词汇/短语并翻译为${targetLanguageName}。只选择 CEFR 难度范围在 ${difficultyLabel} 内的词汇。`;
    },
    outputFormat: (_params) => `{
  "content_result": "",
  "convert_word": [
    { "original": "", "converted": "", "difficulty": "" }
  ]
}`,
    outputNotes: (params: {
      cefrGuidance: string;
      difficultyMin: CEFRLevel;
      difficultyMax: CEFRLevel;
      maxWords: number;
      targetLang: NativeLanguage;
    }) => {
      const difficultyLabel =
        params.difficultyMin === params.difficultyMax
          ? params.difficultyMin
          : `${params.difficultyMin}-${params.difficultyMax}`;
      const targetLanguageName = getLanguageName(params.targetLang);
      return [
        params.cefrGuidance,
        '',
        '规则：',
        `1. 只选择 CEFR 难度范围在 ${difficultyLabel} 内的词汇`,
        `2. 优先选择教育价值高、常见且有代表性的词/短语（短语优先；最多 ${params.maxWords} 个）`,
        '3. 避免：专有名词、人名地名、纯数字、URL、代码片段、单个字母、明显的虚词/停用词',
        `4. 对每个入选词输出：original（原文形式，保留大小写）、converted（翻译为${targetLanguageName}）、difficulty（CEFR 等级）`,
        '5. content_result 必须返回原文，不做改写',
        '6. convert_word 可为空数组；若没有合适词汇也可以返回空数组',
        '7. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
      ].join('\n');
    },
  } satisfies PromptBehavior<{
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    difficultyMin: CEFRLevel;
    difficultyMax: CEFRLevel;
    maxWords: number;
    cefrGuidance: string;
  }>,

  translate_keywords: {
    role: '你是专业翻译助手。',
    task: (params: { sourceLang: SupportedLanguage; targetLang: NativeLanguage }) =>
      `任务：将<用户输入>中的词汇列表从 ${params.sourceLang} 翻译为 ${params.targetLang}。`,
    outputFormat: (_params) => `translation_1\ntranslation_2`,
    outputNotes: (params: { hasContext: boolean }) =>
      [
        '输入格式：',
        params.hasContext
          ? '- 前面若干行：待翻译的词汇列表（每行一个）\n- 后面部分（空行后）：上下文信息'
          : '- 每行一个待翻译的词汇',
        '',
        '规则（非常重要）：',
        '1. 严格按输入顺序输出',
        '2. 每行只输出一个翻译结果',
        '3. 不要输出序号、项目符号、解释、JSON、Markdown 或代码块',
        '4. 只输出最常见、最基础的译法（不要多个释义）',
        ...(params.hasContext ? ['5. 结合上下文选择最合适的译法'] : []),
      ].join('\n'),
  } satisfies PromptBehavior<{ sourceLang: SupportedLanguage; targetLang: NativeLanguage; hasContext: boolean }>,

  term_translate: {
    role: '你是翻译助手。',
    task: (params: { sourceLang: SupportedLanguage; targetLang: NativeLanguage }) =>
      `任务：把<用户输入>中的术语从${params.sourceLang}翻译为${params.targetLang}，输出一个 JSON 对象：key 为原术语（与输入完全一致），value 为翻译结果。`,
    outputFormat: (_params) => `{
  "term": "translation"
}`,
    outputNotes: () =>
      [
        '规则（非常重要）：',
        '1. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
        '2. key 必须与输入术语完全一致；value 为翻译结果',
        '3. 不要添加或删除术语；必须对每个术语给出一个翻译',
      ].join('\n'),
  } satisfies PromptBehavior<{ sourceLang: SupportedLanguage; targetLang: NativeLanguage }>,

  english_correction: {
    role: '你是英文写作纠错助手。',
    task: () =>
      '任务：检查<用户输入>是否存在语法/拼写/用词错误。若<用户输入>主要为 URL/链接或几乎不包含英文句子，则直接判定无错误。',
    outputFormat: (_params) => `{
  "hasError": false,
  "corrected": null,
  "message": ""
}`,
    outputNotes: (_params) =>
      [
        '规则（非常重要）：',
        '1. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
        '2. hasError=false：corrected 必须为 null；message 用中文鼓励（≤50字）',
        '3. hasError=true：corrected 为纠正后的文本（尽量少改，保留语气）；message 用中文简明说明（≤50字）',
        '4. 不要过度纠正，只改明显错误；若原句口语但语法正确，可保持原样',
      ].join('\n'),
  } satisfies PromptBehavior<Record<string, never>>,
} as const;
