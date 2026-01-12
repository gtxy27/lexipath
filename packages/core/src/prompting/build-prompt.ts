import { resolvePromptBehaviorSnapshot } from './behaviors';
import { resolvePromptScene } from './scenes';
import { resolvePromptStyleValue } from './styles';
import type { BuildPromptRequest, PromptContextInfo, PromptUserInfo } from './types';

function wrapTag(tagName: string, content: string): string {
  const trimmed = content.trim();
  return `<${tagName}>\n${trimmed}\n</${tagName}>`;
}

function formatUserInfo(userInfo: PromptUserInfo): string {
  const reference = userInfo.levelReferenceLine ? userInfo.levelReferenceLine.trim() : '';
  const targetReference = userInfo.targetLearningLanguageLevelReferenceLine ? userInfo.targetLearningLanguageLevelReferenceLine.trim() : '';
  const currentLevel = reference ? `CEFR ${userInfo.cefrLevel} ${reference}` : `CEFR ${userInfo.cefrLevel}`;

  const lines = [
    `- 用户母语：${userInfo.motherTongue}`,
    `- 用户目标学习语言：${userInfo.targetLearningLanguage}`,
    `- 用户当前水平：${currentLevel}`,
  ];

  if (userInfo.targetLearningLanguageLevel) {
    const targetLevel = targetReference
      ? `CEFR ${userInfo.targetLearningLanguageLevel} ${targetReference}`
      : `CEFR ${userInfo.targetLearningLanguageLevel}`;
    lines.push(`- 用户目标水平：${targetLevel}`);
  }

  return lines.join('\n');
}

function formatContextInfo(context?: PromptContextInfo): string {
  if (!context) return '';

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
 * Build prompt with the fixed blueprint:
 * - Top header (no tags): role → scene → (optional style) → task
 * - Tagged blocks (fixed order):
 *   <用户信息>, optional <上下文信息>, <用户输入>, <输出格式>, <输出说明>
 */
export function buildPrompt(request: BuildPromptRequest): string {
  // ===========================================================================
  // Phase 1: Resolve config (agentKey -> behavior snapshot)
  // ===========================================================================
  const behavior = resolvePromptBehaviorSnapshot(request.agentKey);

  // ===========================================================================
  // Phase 2: Resolve header strings (scene/style)
  // ===========================================================================
 
  const scene = resolvePromptScene(request.sceneKey);
  const style = behavior.usesStyle ? resolvePromptStyleValue(request.styleKey) : '';

  // ===========================================================================
  // Phase 3: Build top header (no tags): Role -> Scene -> (optional Style) -> Task
  // ===========================================================================
  const top = [behavior.role, scene, style, behavior.task].map((v) => String(v ?? '').trim()).filter(Boolean).join('\n');

  // ===========================================================================
  // Phase 4: Build tagged blocks (fixed order)
  //   <用户信息> -> (<上下文信息>?) -> <用户输入> -> <输出格式> -> <输出说明>
  // ===========================================================================
  const blocks: string[] = [];

  // Phase 4.1: <用户信息>
  blocks.push(wrapTag('用户信息', formatUserInfo(request.userInfo)));

  // Phase 4.2: <上下文信息> (optional; only output when non-empty)
  const contextText = formatContextInfo(request.contextInfo);
  if (contextText) {
    blocks.push(wrapTag('上下文信息', contextText));
  }

  // Phase 4.3: <用户输入>
  blocks.push(wrapTag('用户输入', String(request.userInput ?? '').trim()));

  // Phase 4.4: <输出格式>
  blocks.push(wrapTag('输出格式', behavior.outputFormat.trim()));

  // Phase 4.5: <输出说明>
  blocks.push(wrapTag('输出说明', behavior.outputNotes.trim()));

  // ===========================================================================
  // Phase 5: Final assembly
  // ===========================================================================
  return `${top}\n\n${blocks.join('\n\n')}\n`;
}
