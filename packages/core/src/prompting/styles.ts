import { PromptStyleKeySchema, type PromptStyleKey } from '../types';

export const PROMPT_STYLES: Record<PromptStyleKey, string> = {
  default: '风格：自然清晰、简洁准确；不编造不存在的信息。',
  anime: '风格：口语化、轻松自然；尽量保留二次元/网络用语与角色称谓；不编造不存在的信息。',
  academic: '风格：术语准确、逻辑严谨、书面表达；不编造不存在的信息。',
  casual: '风格：口语化、轻松、自然；优先常用表达；不编造不存在的信息。',
  concise: '风格：尽量短句、直给结论；避免冗余；不编造不存在的信息。',
};

export function resolvePromptStyleKey(input: unknown): PromptStyleKey {
  const parsed = PromptStyleKeySchema.safeParse(input);
  return parsed.success ? parsed.data : 'default';
}

export function resolvePromptStyleValue(input: unknown): string {
  return PROMPT_STYLES[resolvePromptStyleKey(input)];
}

