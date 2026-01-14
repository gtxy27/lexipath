import type { Settings } from "@lexipath/core";

export function resolveWordCardTtsLang(settings: Settings | null): string {
  if (!settings) return "en-US";
  const targetLanguage = settings.targetLanguage;

  if (targetLanguage === "en") {
    return settings.wordCardEnglishAccent === "uk" ? "en-GB" : "en-US";
  }
  if (targetLanguage === "ja") return "ja-JP";
  if (targetLanguage === "ko") return "ko-KR";
  if (targetLanguage === "fr") return "fr-FR";
  if (targetLanguage === "de") return "de-DE";
  if (targetLanguage === "zh") {
    return settings.nativeLanguage === "zh-TW" ? "zh-TW" : "zh-CN";
  }

  return "en-US";
}

