export const PROMPT_SCENES = {
  video_subtitle: '当前环境：视频字幕学习场景。',
  video_subtitle_enhance: '当前环境：视频字幕增强场景。',
  web_content: '当前环境：网页内容增强（词汇挑选与翻译）。',
  keyword_select_subtitle: '当前环境：字幕文本关键词提取场景。',
  keyword_select_web: '当前环境：网页文本关键词提取场景。',
  word_card: '当前环境：词卡解释与学习提示场景。',
  term_translate: '当前环境：术语列表翻译场景。',
  keyword_translate: '当前环境：词汇列表翻译场景。',
  english_correction: '当前环境：用户在网页输入框中输入英文文本并触发快速纠错。',
} as const;

export type PromptSceneKey = keyof typeof PROMPT_SCENES;

export function resolvePromptScene(sceneKey: string): string {
  const key = sceneKey.trim();
  if (!key) return PROMPT_SCENES.video_subtitle;
  return (PROMPT_SCENES as Record<string, string>)[key] ?? key;
}

