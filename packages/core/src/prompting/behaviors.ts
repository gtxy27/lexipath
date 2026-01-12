import type { PromptBehaviorSnapshot } from './types';
// 关键词选择
export const PROMPT_BEHAVIORS = {
  keyword_select: {
    role: '你是一个语言重点词汇挑选专家',
    task: [
      '任务:从<用户输入>中挑选对学习者最有价值的关键词。',
      '1. 我会提供用户的信息,包括用户的目标学习语言,用户的现在水平,用户的目标水平。',
      '2. 你需要根据用户的水平,挑选出你认为值得学习的单词,或者固定搭配/短语动词/习语',
      '3. 对于远超出用户目标水平的关键词,你需要输出到第二个数组当中,而不是第一个数组。'
      

    ].join('\n'),
    outputFormat: [`["keyword_1", "keyword_2"]`, `["hard_keyword_1", "hard_keyword_2"]`].join('\n'),
    outputNotes: [
      '规则(必须遵守):',
      '1. 只输出两个 JSON 字符串数组(string array);不要 Markdown、不要代码块、不要任何额外文字',
      '2. 第二个数组可以没有元素,但是不能不输出',
      '3. 数组中的每个元素必须是原文中出现的:一个单词或一个短语(固定搭配/短语动词/习语)',
      '4. 排除人名、地名这类专有名词',
      '5. 排除句子中非常简单的词,例如“a”、“the”、“is”等,除非它对句子含义至关重要',
      
    ].join('\n'),
  },
  // 网页替换专用，一次替换+翻译，要求速度
  web_enhance: {
    role: '你是一个语言重点词汇挑选专家',
    task: [
      '任务:分析<用户输入>中的内容,为学习者挑选值得学习的词汇/短语并翻译为<用户信息>中的母语',
      '1. 我会提供用户的信息,包括用户的目标学习语言,用户的现在水平,用户的目标水平。',
      '2. 你需要根据用户的水平,挑选出你认为值得学习的单词,或者固定搭配/短语动词/习语',
    ].join('\n'),
    outputFormat: `{\n  "convert_word": [\n    { "original": "", "converted": "", "difficulty": "" }\n  ]\n}`,
    outputNotes: [
      '规则:',
      '1. 不要返回/复述原文内容;原文会由系统直接渲染,你只需要返回 convert_word',
      '2. difficulty 必须为 CEFR 等级(A1/A2/B1/B2/C1/C2)',
      '3. convert_word 可为空数组;若没有合适词汇也可以返回空数组',
      '4. 只输出一个 JSON 对象;不要 Markdown、不要代码块、不要任何额外文字',
    ].join('\n'),
  },

// 批量翻译
  translate_keywords: {
    role: '你是专业翻译专家',
    task: '任务:将<用户输入>中的词汇列表从<用户信息>中的目标学习语言翻译为<用户信息>中的母语。',
    outputFormat: `translation_1\ntranslation_2`,
    outputNotes: [
      '输入格式:',
      '- <用户输入>:每行一个待翻译的词/短语',
      '- 若存在<上下文信息>:结合上下文选择最合适、最常用的译法',
      '',
      '规则(必须遵守):',
      '1. 严格按输入顺序输出',
      '2. 每行只输出一个翻译结果',
      '3. 不要输出序号、项目符号、解释、JSON、Markdown 或代码块',
      '4. 只输出最常见、最基础的译法(不要列多个释义)',
    ].join('\n'),
  },

// 通用翻译
  term_translate: {
    role: '你是专业的翻译专家',
    task: [
      '任务:把<用户输入>中的术语从<用户信息>中的目标学习语言翻译为<用户信息>中的母语,',
      '输出与输入行数完全一致的翻译结果，每行一个翻译。',
    ].join('\n'),
    outputFormat: `translation_1\ntranslation_2`,
    outputNotes: [
      '规则(必须遵守):',
      '1. 不要 JSON;不要 Markdown、不要代码块、不要任何额外文字',
      '2. 严格按输入顺序输出;每行一个翻译结果;行数必须与输入一致',
      '3. 不要添加或删除术语;必须对每个术语给出一个翻译',
    ].join('\n'),
  },

// 书写纠错
  english_correction: {
    role: '你是专业的语言写作纠错老师',
    task: [
      '任务:检查<用户输入>是否存在语法/拼写/用词错误。',
      '1. 在<用户信息>中,有用户的学习信息,你需要根据用户的学习语言,来判断<用户输入>是否包含语法/拼写/用词错误。以及是否符合对应学习语言的语言习惯',
      '2. 若<用户输入>包含语法/拼写/用词错误,你需要输出纠正后的文本(尽量少改,保留语气);若原句口语但语法正确,写一段鼓励的话',
      '3. 若<用户输入>主要为 URL/链接或几乎不包含英文句子,则直接判定无错误。',
    ].join('\n'),
    outputFormat: `{\n  "hasError": false,\n  "corrected": null,\n  "message": ""\n}`,
    outputNotes: [
      '规则(必须遵守):',
      '1. 只输出一个 JSON 对象;不要 Markdown、不要代码块、不要任何额外文字',
      '2. hasError=false:corrected 必须为 null;message 用用户的母语鼓励(≤ 80 字)',
      '3. hasError=true:corrected 为纠正后的文本(尽量少改,保留语气);message 用中文简明说明(≤ 80 字)',
      '4. 不要过度纠正,只改明显错误;若原句口语但语法正确,可保持原样,可以在message中提醒并鼓励',
    ].join('\n'),
  },
// 解释单词
  explain_word: {
    role: '你是专业的词汇学习老师',
    task: [
      '任务:解释<用户输入>中的单词/短语,并翻译为<用户信息>中的母语。',
      '若存在<上下文信息>,需额外结合上下文说明其在该语境下的含义。',

    ].join('\n'),
    outputFormat: `{\n  "translation": "",\n  "phonetic": "",\n  "difficulty": "",\n  "definition": "",\n  "example": "",\n  "example_translation": ""\n}`,
    outputNotes: [
      '规则(必须遵守):',
      '1. 只输出一个 JSON 对象;不要 Markdown、不要代码块、不要任何额外文字',
      '2. translation:翻译为<用户信息>中的母语(尽量简短常用)',
      '3. phonetic:给出合适的发音标注',
      '4. difficulty:给出 CEFR 等级(A1/A2/B1/B2/C1/C2)',
      '5. definition:用<用户信息>中的母语给出简短释义',
      '6. example:给出一个简短例句(目标学习语言);example_translation:例句的母语翻译',
    ].join('\n'),
  },
// 字幕适配
  subtitle_adapt: {
    role: '你是一个外语辅导专家',
    task: [
      '任务:将<用户输入>中的字幕翻译为<用户信息>中的目标学习语言,',
      '并将表达难度调整到<用户信息>中的 CEFR 等级;保持核心含义不变,适合字幕显示。',
    ].join('\n'),
    outputFormat: `sentence_1\nsentence_2`,
    outputNotes: [
      '规则:',
      '1. 输出为目标学习语言的字幕，可为 1~2 行，每行一个句子',
      '2. 难度适配<用户信息>中的 CEFR 等级(词汇与句式尽量符合该水平)',
      '3. 字幕长度合理，不宜过长；保持核心含义不变',
      '4. 不要 JSON;不要 Markdown、不要代码块、不要任何额外文字',
    ].join('\n'),
  },
} as const satisfies Record<string, PromptBehaviorSnapshot>;

export type PromptKnownAgentKey = keyof typeof PROMPT_BEHAVIORS;

export function resolvePromptBehaviorSnapshot(agentKey: string): PromptBehaviorSnapshot {
  const key = agentKey.trim();
  const snapshot = (PROMPT_BEHAVIORS as Record<string, PromptBehaviorSnapshot>)[key];
  if (!snapshot) {
    throw new Error(`Unknown agentKey: ${agentKey}`);
  }
  return snapshot;
}
