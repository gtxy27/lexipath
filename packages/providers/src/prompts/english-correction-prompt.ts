import type {
  CEFRLevel,
  NativeLanguage,
  ProficiencyPreference,
  PromptTemplateInput,
  SupportedLanguage,
} from '@lexipath/core';
import { buildProficiencyReferenceLine } from './proficiency-reference';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface EnglishCorrectionPromptOptions {
  text: string;
  motherTongue: NativeLanguage;
  targetLearningLanguage: SupportedLanguage;
  userLevel: CEFRLevel;
  proficiencyPreference?: ProficiencyPreference;
}

export function buildEnglishCorrectionPrompt(options: EnglishCorrectionPromptOptions): string {
  const input = options.text.trim();
  const referenceLine = buildProficiencyReferenceLine({
    sourceLang: options.targetLearningLanguage,
    targetLang: options.motherTongue,
    userLevel: options.userLevel,
    ...(options.proficiencyPreference ? { proficiencyPreference: options.proficiencyPreference } : {}),
  });

  const template: PromptTemplateInput = {
    role: '你是英文写作纠错助手。',
    scene: '当前环境：用户在网页输入框中输入英文文本并触发快速纠错。',
    style: '风格：保持原意与主要语气，尽量少改；不编造不存在的信息。',
    task: `任务：检查<用户输入>是否存在语法/拼写/用词错误。若<用户输入>主要为 URL/链接或几乎不包含英文句子，则直接判定无错误。`,
    userInfo: {
      motherTongue: options.motherTongue,
      targetLearningLanguage: options.targetLearningLanguage,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    },
    userInput: input,
    outputFormat: `{
  "hasError": false,
  "corrected": null,
  "message": ""
}`,
    outputNotes: [
      '规则（非常重要）：',
      '1. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
      '2. hasError=false：corrected 必须为 null；message 用中文鼓励（≤50字）',
      '3. hasError=true：corrected 为纠正后的文本（尽量少改，保留语气）；message 用中文简明说明（≤50字）',
      '4. 不要过度纠正，只改明显错误；若原句口语但语法正确，可保持原样',
    ].join('\n'),
  };

  return renderPromptTemplate(template);
}

