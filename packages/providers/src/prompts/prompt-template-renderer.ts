import { PromptTemplateInputSchema } from '@lexipath/core';
import type { PromptContextInfo, PromptTemplateInput, PromptUserInfo } from '@lexipath/core';

function wrapTag(tagName: string, content: string): string {
  const trimmed = content.trim();
  return `<${tagName}>\n${trimmed}\n</${tagName}>`;
}

function formatUserInfo(userInfo: PromptUserInfo): string {
  const reference = userInfo.levelReferenceLine ? userInfo.levelReferenceLine.trim() : '';
  const level = reference ? `CEFR ${userInfo.cefrLevel} ${reference}` : `CEFR ${userInfo.cefrLevel}`;

  return [
    `- 母语：${userInfo.motherTongue}`,
    `- 目标学习语言：${userInfo.targetLearningLanguage}`,
    `- 用户水平：${level}`,
  ].join('\n');
}

function formatContextInfo(context: PromptContextInfo): string {
  const before = (context.before ?? []).map((line) => line.trim()).filter(Boolean);
  const after = (context.after ?? []).map((line) => line.trim()).filter(Boolean);

  if (before.length === 0 && after.length === 0) return '';

  const parts: string[] = [];
  if (before.length) {
    parts.push('上文：');
    parts.push(before.join('\n'));
  }
  if (after.length) {
    if (parts.length) parts.push('');
    parts.push('下文：');
    parts.push(after.join('\n'));
  }

  return parts.join('\n').trim();
}

/**
 * Render a prompt with the agreed blueprint:
 * - Top fixed section (no tags): role -> scene -> style -> task
 * - Tagged sections: <用户信息>, optional <上下文信息>, <用户输入>, <输出格式>, <输出说明>
 *
 * Note: <输出格式> must not include Chinese; builders should provide format-only content.
 */
export function renderPromptTemplate(input: PromptTemplateInput): string {
  const parsed = PromptTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid PromptTemplateInput: ${parsed.error.message}`);
  }

  const value = parsed.data;
  const top = [value.role.trim(), value.scene.trim(), value.style.trim(), value.task.trim()]
    .filter(Boolean)
    .join('\n');

  const blocks: string[] = [];
  blocks.push(wrapTag('用户信息', formatUserInfo(value.userInfo)));

  const contextText = value.contextInfo ? formatContextInfo(value.contextInfo) : '';
  if (contextText) {
    blocks.push(wrapTag('上下文信息', contextText));
  }

  blocks.push(wrapTag('用户输入', value.userInput.trim()));
  blocks.push(wrapTag('输出格式', value.outputFormat.trim()));
  blocks.push(wrapTag('输出说明', value.outputNotes.trim()));

  return `${top}\n\n${blocks.join('\n\n')}\n`;
}
