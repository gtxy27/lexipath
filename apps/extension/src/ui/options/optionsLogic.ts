import { z } from "zod";
import {
  CEFRLevelSchema,
  ChannelTypeIdSchema,
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  JLPTLevelSchema,
  PromptStyleKeySchema,
  ProviderConfigSchema,
  RouteKindSchema,
  SettingsSchema,
  SupportedLanguageSchema,
  TOPIKLevelSchema,
  WebDAVConfigSchema,
  proficiencyPreferenceToCefrLevel,
  type CEFRLevel,
  type ChannelTypeId,
  type ProviderChannel,
  type ProficiencyPreference,
  type RouteKind,
  type Settings,
  type TestProviderConnectionPayload,
} from "@lexipath/core";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { t } from "./optionsI18n";
import type {
  BehaviorKey,
  ChannelFormState,
  ChannelFieldErrors,
  FieldErrorKey,
  FieldErrors,
  FormState,
  RouteFormState,
  WebDAVFieldErrors,
} from "./optionsTypes";

const log = createLogger("ui:options:logic");

export const FOLLOW_TRANSLATE_BEHAVIOR_KEYS: readonly BehaviorKey[] = [
  "translate_keywords",
  "dictionary",
];

export const NATIVE_LANGUAGE_OPTIONS = ["en", "zh-CN", "zh-TW"] as const;

export const BEHAVIOR_KEYS: BehaviorKey[] = [
  "select_keywords",
  "translate",
  "translate_keywords",
  "dictionary",
  "adapt_subtitle",
  "english_correction",
  "chat",
];

export const BEHAVIOR_KIND_ALLOWLIST: Record<BehaviorKey, RouteKind[]> = {
  select_keywords: [1],
  translate: [1, 2, 3],
  dictionary: [1, 2, 3],
  translate_keywords: [1, 2, 3],
  adapt_subtitle: [1],
  english_correction: [1],
  chat: [1],
};

export const IELTS_BANDS: readonly string[] = [
  "3.0",
  "3.5",
  "4.0",
  "4.5",
  "5.0",
  "5.5",
  "6.0",
  "6.5",
  "7.0",
  "7.5",
  "8.0",
  "8.5",
  "9.0",
];

export const WEB_STYLE_THEME_PRESETS = {
  standard: { within: "dashedLine", out: "border", forgotten: "weakened" },
  subtle: { within: "border", out: "dashedLine", forgotten: "weakened" },
  contrast: { within: "background", out: "dashedLine", forgotten: "weakened" },
  minimal: { within: "border", out: "border", forgotten: "weakened" },
} as const;

export type WebStyleThemeKey = keyof typeof WEB_STYLE_THEME_PRESETS | "custom";

export function deriveWebStyleThemeKey(
  mapping: Settings["webStyleMapping"] | null | undefined,
): WebStyleThemeKey {
  const normalized = mapping ?? WEB_STYLE_THEME_PRESETS.standard;
  const keys = Object.keys(WEB_STYLE_THEME_PRESETS) as Array<
    keyof typeof WEB_STYLE_THEME_PRESETS
  >;
  for (const key of keys) {
    const preset = WEB_STYLE_THEME_PRESETS[key];
    if (
      preset.within === normalized.within &&
      preset.out === normalized.out &&
      preset.forgotten === normalized.forgotten
    ) {
      return key;
    }
  }
  return "custom";
}

export type ProficiencyScaleOption = "CEFR" | ProficiencyPreference["standard"];

export function getProficiencyScaleOptions(input: {
  targetLanguage: Settings["targetLanguage"];
  nativeLanguage: Settings["nativeLanguage"];
}): Array<{ value: ProficiencyScaleOption; label: string }> {
  const options: Array<{ value: ProficiencyScaleOption; label: string }> = [
    { value: "CEFR", label: "CEFR" },
  ];

  if (input.targetLanguage === "en") {
    options.push({ value: "IELTS", label: "IELTS" });
    if (input.nativeLanguage === "zh-CN" || input.nativeLanguage === "zh-TW") {
      options.push({ value: "CET-4", label: "CET-4" });
      options.push({ value: "CET-6", label: "CET-6" });
    }
  }

  if (input.targetLanguage === "ja") options.push({ value: "JLPT", label: "JLPT" });
  if (input.targetLanguage === "ko") options.push({ value: "TOPIK", label: "TOPIK" });

  return options;
}

export function isScaleApplicable(options: {
  scale: ProficiencyScaleOption;
  targetLanguage: Settings["targetLanguage"];
  nativeLanguage: Settings["nativeLanguage"];
}): boolean {
  if (options.scale === "CEFR") return true;
  if (options.scale === "IELTS") return options.targetLanguage === "en";
  if (options.scale === "CET-4" || options.scale === "CET-6") {
    return (
      options.targetLanguage === "en" &&
      (options.nativeLanguage === "zh-CN" || options.nativeLanguage === "zh-TW")
    );
  }
  if (options.scale === "JLPT") return options.targetLanguage === "ja";
  if (options.scale === "TOPIK") return options.targetLanguage === "ko";
  return false;
}

export function defaultPreferenceForScale(
  scale: ProficiencyScaleOption,
): ProficiencyPreference | undefined {
  if (scale === "CEFR") return undefined;
  if (scale === "IELTS") return { standard: "IELTS", value: "6.5" };
  if (scale === "CET-4") return { standard: "CET-4", value: "pass" };
  if (scale === "CET-6") return { standard: "CET-6", value: "pass" };
  if (scale === "JLPT") return { standard: "JLPT", value: "N3" };
  if (scale === "TOPIK") return { standard: "TOPIK", value: "3" };
  return undefined;
}

export function deriveCefrFromPreference(
  preference: ProficiencyPreference,
): CEFRLevel {
  return proficiencyPreferenceToCefrLevel(preference);
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeSiteEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function parseCustomHeaders(
  rawText: string,
): { ok: true; value: Record<string, string> | undefined } | {
  ok: false;
  errorKey: FieldErrorKey;
} {
  const text = rawText.trim();
  if (!text) return { ok: true, value: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    log.debug("Failed to parse custom headers JSON", {
      message: getErrorMessage(error),
    });
    return { ok: false, errorKey: "optionsProviderCustomHeadersInvalidJson" };
  }

  const result = z.record(z.string()).safeParse(parsed);
  if (!result.success) {
    return { ok: false, errorKey: "optionsProviderCustomHeadersInvalidFormat" };
  }
  return { ok: true, value: result.data };
}

function omitKeys<T extends Record<string, unknown>>(
  obj: T,
  keys: string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...obj };
  for (const key of keys) delete next[key];
  return next;
}

export function resolveChannel(
  channels: ChannelFormState[],
  channelId: number | null,
): ChannelFormState | null {
  if (typeof channelId !== "number") return null;
  return channels.find((channel) => channel.channelId === channelId) ?? null;
}

function firstAvailableChannelId(channels: ChannelFormState[]): number | null {
  const sorted = [...channels].sort((a, b) => a.channelId - b.channelId);
  return sorted[0]?.channelId ?? null;
}

function ensureBehaviorRoutesComplete(
  settings: Settings,
): Record<BehaviorKey, RouteFormState> {
  const fallbackChannelId = (() => {
    const first = settings.channels
      .slice()
      .sort((a, b) => a.channelId - b.channelId)[0];
    return first?.channelId ?? 1;
  })();

  const routes: Record<BehaviorKey, RouteFormState> = {} as any;
  for (const key of BEHAVIOR_KEYS) {
    const raw = settings.behaviorRoutes?.[key];
    const kind = RouteKindSchema.safeParse(raw?.kind).success
      ? (raw!.kind as RouteKind)
      : 1;
    const channelId = typeof raw?.channelId === "number" ? raw.channelId : null;
    routes[key] = {
      kind,
      channelId: kind === 1 ? (channelId ?? fallbackChannelId) : null,
      extra: raw?.extra && typeof raw.extra === "object" ? (raw.extra as any) : {},
      followTranslate: false,
    };
  }

  const translateRoute = routes.translate;
  for (const key of FOLLOW_TRANSLATE_BEHAVIOR_KEYS) {
    const raw = settings.behaviorRoutes?.[key];
    const inferredFollow =
      !raw ||
      (routes[key].kind === translateRoute.kind &&
        (routes[key].kind !== 1 || routes[key].channelId === translateRoute.channelId));

    routes[key] = {
      ...routes[key],
      followTranslate: inferredFollow,
      ...(inferredFollow
        ? {
            kind: translateRoute.kind,
            channelId: translateRoute.kind === 1 ? translateRoute.channelId : null,
          }
        : {}),
    };
  }
  return routes;
}

export function settingsToFormState(settings: Settings): FormState {
  const channels: ChannelFormState[] = settings.channels
    .slice()
    .sort((a, b) => a.channelId - b.channelId)
    .map((channel) => {
      const cfg = (channel.config ?? {}) as Record<string, unknown>;
      const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
      const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey : "";
      const customHeaders = cfg.customHeaders as unknown;
      const customHeadersText = z.record(z.string()).safeParse(customHeaders).success
        ? JSON.stringify(customHeaders, null, 2)
        : "";

      const configExtra = omitKeys(cfg, ["baseUrl", "apiKey", "customHeaders"]);
      return {
        channelId: channel.channelId,
        typeId: channel.typeId,
        name: channel.name ?? "",
        model: channel.model ?? "",
        baseUrl,
        apiKey,
        customHeadersText,
        iconUrl: channel.iconUrl ?? "",
        concurrencyLimit: channel.concurrencyLimit ?? 15,
        configExtra,
        extra: channel.extra ?? {},
      };
    });

  const proficiencyPreference = (() => {
    const pref = settings.proficiencyPreference;
    if (!pref) return undefined;
    const ok = isScaleApplicable({
      scale: pref.standard,
      targetLanguage: settings.targetLanguage,
      nativeLanguage: settings.nativeLanguage,
    });
    return ok ? pref : undefined;
  })();

  const targetProficiencyPreference = (() => {
    const pref = settings.targetProficiencyPreference;
    if (!pref) return undefined;
    const ok = isScaleApplicable({
      scale: pref.standard,
      targetLanguage: settings.targetLanguage,
      nativeLanguage: settings.nativeLanguage,
    });
    return ok ? pref : undefined;
  })();

  return {
    channels,
    behaviorRoutes: ensureBehaviorRoutesComplete(settings),
    nativeLanguage: settings.nativeLanguage,
    targetLanguage: settings.targetLanguage,
    proficiencyLevel: settings.proficiencyLevel,
    proficiencyPreference,
    targetProficiencyLevel: settings.targetProficiencyLevel,
    targetProficiencyPreference,
    theme: settings.theme,
    promptStyle: settings.promptStyle,
    llmContextSentences:
      typeof settings.llmContextSentences === "number" &&
      Number.isFinite(settings.llmContextSentences)
        ? Math.max(0, Math.min(6, Math.trunc(settings.llmContextSentences)))
        : 1,
	    enabled: settings.enabled,
	    autoEnhance: settings.autoEnhance,
	    webEnhanceMode: settings.webEnhanceMode,
	    webEnhanceModeNative: settings.webEnhanceModeNative,
	    webShowOriginal: settings.webShowOriginal,
	    webStyleMapping: settings.webStyleMapping,
	    webCustomCss: settings.webCustomCss,
	    scenesEnabled: settings.scenesEnabled,
	    hasCompletedOnboarding: Boolean(settings.hasCompletedOnboarding),
	    hasSeenOptionsTour: Boolean(settings.hasSeenOptionsTour),
	    floatingButtonEnabled: settings.floatingButtonEnabled,

	    webSelectionExplainEnabled: settings.webSelectionExplainEnabled,
	    wordCardSectionsOrder: settings.wordCardSectionsOrder,
	    wordCardAutoPronounce: settings.wordCardAutoPronounce,
	    wordCardEnglishAccent: settings.wordCardEnglishAccent,
	    englishCorrection: settings.englishCorrection,
	    siteMode: settings.siteMode,
	    excludedSites: settings.excludedSites,
	    allowedSites: settings.allowedSites,
    webdav: {
      url: settings.webdav?.url ?? "",
      username: settings.webdav?.username ?? "",
      password: settings.webdav?.password ?? "",
      path: settings.webdav?.path ?? "/LexiPath/backup.json",
    },
    toolExecutionEnabled: Boolean(settings.toolExecutionEnabled),
  };
}

export function channelTypeLabel(typeId: ChannelTypeId): string {
  if (typeId === 1) return t("optionsChannelType_openaiCompatible");
  if (typeId === 2) return t("optionsChannelType_claude");
  if (typeId === 3) return t("optionsChannelType_gemini");
  return t("optionsChannelType_unknown");
}

export function routeKindLabel(kind: RouteKind): string {
  if (kind === 1) return t("optionsRouteKind_channel");
  if (kind === 2) return t("translationProvider_google");
  if (kind === 3) return t("translationProvider_bing");
  return t("optionsRouteKind_channel");
}

export function behaviorLabel(key: BehaviorKey): string {
  return t(`optionsBehavior_${key}`);
}

export function behaviorDesc(key: BehaviorKey): string {
  return t(`optionsBehaviorDesc_${key}`);
}

function isIconUrlAllowed(raw: string): boolean {
  const url = raw.trim();
  if (!url) return true;
  if (url.startsWith("data:")) return true;
  if (url.startsWith("http://")) return true;
  if (url.startsWith("https://")) return true;
  return false;
}

function iconOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("data:")) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch (error: unknown) {
    log.debug("Invalid icon URL; cannot extract origin", {
      value,
      message: getErrorMessage(error),
    });
    return null;
  }
}

export function channelIsConfigured(channel: ChannelFormState): boolean {
  const model = channel.model.trim();
  if (!model) return false;
  if (channel.typeId === 1) {
    const baseUrl = channel.baseUrl.trim();
    return Boolean(baseUrl && z.string().url().safeParse(baseUrl).success);
  }
  return Boolean(channel.apiKey.trim());
}

export function channelHasAnyInput(channel: ChannelFormState): boolean {
  return Boolean(
    channel.model.trim() ||
      channel.baseUrl.trim() ||
      channel.apiKey.trim() ||
      channel.customHeadersText.trim() ||
      channel.iconUrl.trim(),
  );
}

export function buildChannel(
  channel: ChannelFormState,
  required: boolean,
):
  | { ok: true; value: ProviderChannel }
  | { ok: false; errors: ChannelFieldErrors } {
  const errors: ChannelFieldErrors = {};

  const name = channel.name.trim();
  if (!name) errors.name = "optionsChannelNameRequired";

  if (!isIconUrlAllowed(channel.iconUrl)) {
    errors.iconUrl = "optionsChannelIconUrlInvalid";
  }

  const hasAnyInput = channelHasAnyInput(channel);
  if (!required && !hasAnyInput) {
    if (Object.keys(errors).length > 0) {
      return { ok: false, errors };
    }

    const parsedType = ChannelTypeIdSchema.safeParse(channel.typeId);
    if (!parsedType.success) {
      return { ok: false, errors: {} };
    }

    const iconUrl = channel.iconUrl.trim();
    const value: ProviderChannel = {
      channelId: channel.channelId,
      typeId: parsedType.data,
      name,
      model: "",
      config: { ...channel.configExtra },
      ...(iconUrl ? { iconUrl } : {}),
      concurrencyLimit: channel.concurrencyLimit ?? 15,
      extra: channel.extra ?? {},
    };
    return { ok: true, value };
  }

  const model = channel.model.trim();
  if (!model) errors.model = "optionsProviderModelRequired";

  const customHeadersResult = parseCustomHeaders(channel.customHeadersText);
  if (!customHeadersResult.ok) {
    errors.customHeadersText = customHeadersResult.errorKey;
  }

  const baseUrl = channel.baseUrl.trim();
  const apiKey = channel.apiKey.trim();

  if (channel.typeId === 1) {
    if (baseUrl && !z.string().url().safeParse(baseUrl).success)
      errors.baseUrl = "optionsProviderBaseUrlInvalid";
  } else {
    if (baseUrl && !z.string().url().safeParse(baseUrl).success)
      errors.baseUrl = "optionsProviderBaseUrlInvalid";
    if (!apiKey) errors.apiKey = "optionsProviderApiKeyRequired";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const config: Record<string, unknown> = {
    ...channel.configExtra,
    ...(channel.typeId === 1 ? { baseUrl } : {}),
    ...(channel.typeId !== 1 && baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(customHeadersResult.ok && customHeadersResult.value
      ? { customHeaders: customHeadersResult.value }
      : {}),
  };

  const validateConfig = (() => {
    const baseUrlToValidate =
      typeof config.baseUrl === "string" && config.baseUrl.trim()
        ? config.baseUrl.trim()
        : undefined;

    if (channel.typeId === 1) {
      return ProviderConfigSchema.safeParse({
        model,
        ...(baseUrlToValidate ? { baseUrl: baseUrlToValidate } : {}),
        ...(typeof config.apiKey === "string" && config.apiKey.trim()
          ? { apiKey: config.apiKey.trim() }
          : {}),
        ...(config.customHeaders ? { customHeaders: config.customHeaders } : {}),
      });
    }
    if (channel.typeId === 2) {
      return ClaudeProviderConfigSchema.safeParse({
        model,
        apiKey: String(config.apiKey ?? ""),
        ...(baseUrlToValidate ? { baseUrl: baseUrlToValidate } : {}),
        ...(config.customHeaders ? { customHeaders: config.customHeaders } : {}),
      });
    }
    return GeminiProviderConfigSchema.safeParse({
      model,
      apiKey: String(config.apiKey ?? ""),
      ...(baseUrlToValidate ? { baseUrl: baseUrlToValidate } : {}),
      ...(config.customHeaders ? { customHeaders: config.customHeaders } : {}),
    });
  })();

  if (!validateConfig.success) {
    return { ok: false, errors: { baseUrl: "optionsProviderBaseUrlInvalid" } };
  }

  const parsedType = ChannelTypeIdSchema.safeParse(channel.typeId);
  if (!parsedType.success) {
    return { ok: false, errors: {} };
  }

  const iconUrl = channel.iconUrl.trim();
  const value: ProviderChannel = {
    channelId: channel.channelId,
    typeId: parsedType.data,
    name,
    model,
    config,
    ...(iconUrl ? { iconUrl } : {}),
    concurrencyLimit: channel.concurrencyLimit ?? 15,
    extra: channel.extra ?? {},
  };

  return { ok: true, value };
}

export function buildSettingsPatch(
  form: FormState,
):
  | {
      ok: true;
      patch: Partial<Settings>;
      errors: FieldErrors;
      iconOriginsToRequest: string[];
    }
  | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const channelsErrors: Record<number, ChannelFieldErrors> = {};
  const routesErrors: Partial<Record<BehaviorKey, FieldErrorKey>> = {};
  const webdavErrors: WebDAVFieldErrors = {};

  const builtChannels: ProviderChannel[] = [];
  const builtById = new Map<number, ProviderChannel>();

  const requiredChannelIds = new Set<number>();
  for (const key of BEHAVIOR_KEYS) {
    const route = form.behaviorRoutes[key];
    if (route.kind !== 1) continue;
    if (typeof route.channelId === "number") requiredChannelIds.add(route.channelId);
  }

  for (const channel of form.channels) {
    const required = requiredChannelIds.has(channel.channelId);
    const result = buildChannel(channel, required);
    if (!result.ok) {
      channelsErrors[channel.channelId] = result.errors;
      continue;
    }
    builtChannels.push(result.value);
    builtById.set(result.value.channelId, result.value);
  }

  const iconOriginsToRequest = dedupeStrings(
    builtChannels.map((channel) => iconOrigin(channel.iconUrl ?? "")).filter(Boolean) as string[],
  );

  for (const key of BEHAVIOR_KEYS) {
    const route = form.behaviorRoutes[key];
    const allowed = BEHAVIOR_KIND_ALLOWLIST[key];
    if (!allowed.includes(route.kind)) {
      routesErrors[key] = "optionsRouteChannelMissing";
      continue;
    }

    if (route.kind === 1) {
      const channel = resolveChannel(form.channels, route.channelId);
      if (!channel) {
        routesErrors[key] = "optionsRouteChannelMissing";
        continue;
      }
      if (!channelIsConfigured(channel)) {
        routesErrors[key] = "optionsRouteChannelNotConfigured";
        continue;
      }
      if (!builtById.has(channel.channelId)) {
        routesErrors[key] = "optionsRouteChannelNotConfigured";
        continue;
      }
    }
  }

  if (Object.keys(channelsErrors).length > 0) {
    errors.channels = channelsErrors;
  }
  if (Object.keys(routesErrors).length > 0) {
    errors.routes = routesErrors;
  }

  const webdavHasAnyInput = Boolean(
    form.webdav.url.trim() || form.webdav.username.trim() || form.webdav.password.trim(),
  );

  const builtWebdav = (() => {
    if (!webdavHasAnyInput) return undefined;

    const url = form.webdav.url.trim();
    if (!z.string().url().safeParse(url).success) {
      webdavErrors.url = "optionsWebDAVUrlInvalid";
      return undefined;
    }

    if (!form.webdav.username.trim()) {
      webdavErrors.username = "optionsWebDAVUserRequired";
      return undefined;
    }

    if (!form.webdav.password.trim()) {
      webdavErrors.password = "optionsWebDAVPassRequired";
      return undefined;
    }

    const parsed = WebDAVConfigSchema.safeParse({
      url,
      username: form.webdav.username,
      password: form.webdav.password,
      path: form.webdav.path.trim() || "/LexiPath/backup.json",
    });
    if (!parsed.success) {
      webdavErrors.url = "optionsWebDAVUrlInvalid";
      return undefined;
    }

    return parsed.data;
  })();

  if (Object.keys(webdavErrors).length > 0) {
    errors.webdav = webdavErrors;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const behaviorRoutes: Settings["behaviorRoutes"] = {} as any;
  for (const key of BEHAVIOR_KEYS) {
    const route = form.behaviorRoutes[key];
    behaviorRoutes[key] = {
      kind: route.kind,
      ...(route.kind === 1 && typeof route.channelId === "number"
        ? { channelId: route.channelId }
        : {}),
      extra: route.extra ?? {},
    };
  }

  const patch: Partial<Settings> = {
    channels: builtChannels,
    behaviorRoutes,
    nativeLanguage: form.nativeLanguage,
    targetLanguage: form.targetLanguage,
    proficiencyLevel: form.proficiencyLevel,
    proficiencyPreference: form.proficiencyPreference,
    targetProficiencyLevel: form.targetProficiencyLevel,
    targetProficiencyPreference: form.targetProficiencyPreference,
    theme: form.theme,
    promptStyle: form.promptStyle,
    llmContextSentences: form.llmContextSentences,
	    enabled: form.enabled,
	    autoEnhance: form.autoEnhance,
	    webEnhanceMode: form.webEnhanceMode,
	    webEnhanceModeNative: form.webEnhanceModeNative,
	    webShowOriginal: form.webShowOriginal,
	    webStyleMapping: form.webStyleMapping,
	    webCustomCss: form.webCustomCss,
	    scenesEnabled: form.scenesEnabled,
	    hasCompletedOnboarding: Boolean(form.hasCompletedOnboarding),
	    hasSeenOptionsTour: Boolean(form.hasSeenOptionsTour),
	    floatingButtonEnabled: form.floatingButtonEnabled,

	    webSelectionExplainEnabled: form.webSelectionExplainEnabled,
	    wordCardSectionsOrder: form.wordCardSectionsOrder,
	    wordCardAutoPronounce: form.wordCardAutoPronounce,
	    wordCardEnglishAccent: form.wordCardEnglishAccent,
	    englishCorrection: form.englishCorrection,
	    siteMode: form.siteMode,
	    excludedSites: form.excludedSites,
	    allowedSites: form.allowedSites,
    webdav: webdavHasAnyInput ? builtWebdav : undefined,
    toolExecutionEnabled: Boolean(form.toolExecutionEnabled),
  };

  const parsed = SettingsSchema.partial().strict().safeParse(patch);
  if (!parsed.success) {
    return { ok: false, errors: {} };
  }

  return { ok: true, patch, errors: {}, iconOriginsToRequest };
}

export function nextChannelId(channels: ChannelFormState[]): number {
  const max = channels.reduce((acc, ch) => Math.max(acc, ch.channelId), 0);
  return max + 1;
}

export function defaultChannelName(typeId: ChannelTypeId): string {
  return channelTypeLabel(typeId);
}

export function repairRoutes(form: FormState): FormState {
  const fallback = firstAvailableChannelId(form.channels);
  const next: FormState = {
    ...form,
    behaviorRoutes: { ...form.behaviorRoutes },
  };
  for (const key of BEHAVIOR_KEYS) {
    const route = next.behaviorRoutes[key];
    if (route.kind !== 1) continue;
    const channel = resolveChannel(next.channels, route.channelId);
    if (channel) continue;
    next.behaviorRoutes[key] = { ...route, channelId: fallback };
  }
  return next;
}

export async function requestIconHostPermissions(
  origins: string[],
): Promise<void> {
  for (const origin of origins) {
    try {
      await sendMessage("REQUEST_HOST_PERMISSION", { origin });
    } catch (error: unknown) {
      log.warn(
        "REQUEST_HOST_PERMISSION threw while requesting icon host permission; continuing",
        { origin, message: getErrorMessage(error) },
      );
    }
  }
}

export function buildTestPayload(
  channel: ChannelFormState,
): TestProviderConnectionPayload | null {
  const model = channel.model.trim();
  if (!model) return null;

  const customHeadersResult = parseCustomHeaders(channel.customHeadersText);
  if (!customHeadersResult.ok) return null;

  if (channel.typeId === 1) {
    const baseUrl = channel.baseUrl.trim();
    if (!z.string().url().safeParse(baseUrl).success) return null;
    const parsed = ProviderConfigSchema.safeParse({
      baseUrl,
      model,
      ...(channel.apiKey.trim() ? { apiKey: channel.apiKey.trim() } : {}),
      ...(customHeadersResult.value ? { customHeaders: customHeadersResult.value } : {}),
    });
    if (!parsed.success) return null;
    return { type: "openai", config: parsed.data };
  }

  if (channel.typeId === 2) {
    const parsed = ClaudeProviderConfigSchema.safeParse({
      model,
      apiKey: channel.apiKey.trim(),
      ...(channel.baseUrl.trim() ? { baseUrl: channel.baseUrl.trim() } : {}),
      ...(customHeadersResult.value ? { customHeaders: customHeadersResult.value } : {}),
    });
    if (!parsed.success) return null;
    return { type: "claude", config: parsed.data };
  }

  const parsed = GeminiProviderConfigSchema.safeParse({
    model,
    apiKey: channel.apiKey.trim(),
    ...(channel.baseUrl.trim() ? { baseUrl: channel.baseUrl.trim() } : {}),
    ...(customHeadersResult.value ? { customHeaders: customHeadersResult.value } : {}),
  });
  if (!parsed.success) return null;
  return { type: "gemini", config: parsed.data };
}

export function isValidLanguageCode(
  value: unknown,
): value is Settings["nativeLanguage"] {
  return SupportedLanguageSchema.safeParse(value).success;
}

export function isValidPromptStyle(
  value: unknown,
): value is Settings["promptStyle"] {
  return PromptStyleKeySchema.safeParse(value).success;
}

export function isValidCefrLevel(value: unknown): value is CEFRLevel {
  return CEFRLevelSchema.safeParse(value).success;
}

export function isValidJLPTLevel(
  value: unknown,
): value is (typeof JLPTLevelSchema.options)[number] {
  return JLPTLevelSchema.safeParse(value).success;
}

export function isValidTOPIKLevel(
  value: unknown,
): value is (typeof TOPIKLevelSchema.options)[number] {
  return TOPIKLevelSchema.safeParse(value).success;
}
