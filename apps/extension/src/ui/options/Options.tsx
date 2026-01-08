import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
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

const log = createLogger("ui:Options");

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
import { Toaster } from "../components/ui/toaster";
import { useToast } from "../components/ui/use-toast";
import { Switch } from "../components/ui/switch";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Upload,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  Languages,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useApplyTheme } from "../lib/theme";
import { ICON_URL } from "../lib/assets";

type SiteMode = "all" | "whitelist";

type BehaviorKey =
  | "select_keywords"
  | "translate"
  | "translate_keywords"
  | "dictionary"
  | "adapt_subtitle"
  | "english_correction"
  | "chat";

const FOLLOW_TRANSLATE_BEHAVIOR_KEYS: readonly BehaviorKey[] = [
  "translate_keywords",
  "dictionary",
];

const NATIVE_LANGUAGE_OPTIONS = ["en", "zh-CN", "zh-TW"] as const;

const BEHAVIOR_KEYS: BehaviorKey[] = [
  "select_keywords",
  "translate",
  "translate_keywords",
  "dictionary",
  "adapt_subtitle",
  "english_correction",
  "chat",
];

const BEHAVIOR_KIND_ALLOWLIST: Record<BehaviorKey, RouteKind[]> = {
  select_keywords: [1],
  translate: [1, 2, 3],
  dictionary: [1, 2, 3],
  translate_keywords: [1, 2, 3],
  adapt_subtitle: [1],
  english_correction: [1],
  chat: [1],
};

type ChannelFormState = {
  channelId: number;
  typeId: ChannelTypeId;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  customHeadersText: string;
  iconUrl: string;
  concurrencyLimit: number;
  configExtra: Record<string, unknown>;
  extra: Record<string, unknown>;
};

type RouteFormState = {
  kind: RouteKind;
  channelId: number | null;
  extra: Record<string, unknown>;
  followTranslate: boolean;
};

type FormState = {
  channels: ChannelFormState[];
  behaviorRoutes: Record<BehaviorKey, RouteFormState>;
  nativeLanguage: Settings["nativeLanguage"];
  targetLanguage: Settings["targetLanguage"];
  proficiencyLevel: CEFRLevel;
  proficiencyPreference?: Settings["proficiencyPreference"];
  theme: Settings["theme"];
  promptStyle: Settings["promptStyle"];
  enabled: boolean;
  autoEnhance: boolean;
  webEnhanceMode: Settings["webEnhanceMode"];
  webShowOriginal: Settings["webShowOriginal"];
  webStyleMapping: Settings["webStyleMapping"];
  webCustomCss: Settings["webCustomCss"];
  scenesEnabled: Settings["scenesEnabled"];
  hasCompletedOnboarding: Settings["hasCompletedOnboarding"];
  floatingButtonEnabled: Settings["floatingButtonEnabled"];
  englishCorrection: Settings["englishCorrection"];
  siteMode: SiteMode;
  excludedSites: string[];
  allowedSites: string[];
  webdav: {
    url: string;
    username: string;
    password: string;
    path: string;
  };
};

type FieldErrorKey =
  | "optionsProviderBaseUrlRequired"
  | "optionsProviderBaseUrlInvalid"
  | "optionsProviderModelRequired"
  | "optionsProviderApiKeyRequired"
  | "optionsProviderCustomHeadersInvalidJson"
  | "optionsProviderCustomHeadersInvalidFormat"
  | "optionsChannelNameRequired"
  | "optionsChannelIconUrlInvalid"
  | "optionsRouteChannelMissing"
  | "optionsRouteChannelNotConfigured"
  | "optionsWebDAVUrlInvalid"
  | "optionsWebDAVUserRequired"
  | "optionsWebDAVPassRequired";

type ChannelFieldErrors = Partial<{
  name: FieldErrorKey;
  baseUrl: FieldErrorKey;
  model: FieldErrorKey;
  apiKey: FieldErrorKey;
  customHeadersText: FieldErrorKey;
  iconUrl: FieldErrorKey;
}>;

type WebDAVFieldErrors = Partial<{
  url: FieldErrorKey;
  username: FieldErrorKey;
  password: FieldErrorKey;
}>;

type FieldErrors = Partial<{
  channels: Record<number, ChannelFieldErrors>;
  routes: Partial<Record<BehaviorKey, FieldErrorKey>>;
  webdav: WebDAVFieldErrors;
}>;

const IELTS_BANDS: readonly string[] = [
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

type ProficiencyScaleOption = "CEFR" | ProficiencyPreference["standard"];

function getProficiencyScaleOptions(input: {
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

function isScaleApplicable(options: {
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

function defaultPreferenceForScale(scale: ProficiencyScaleOption): ProficiencyPreference | undefined {
  if (scale === "CEFR") return undefined;
  if (scale === "IELTS") return { standard: "IELTS", value: "6.5" };
  if (scale === "CET-4") return { standard: "CET-4", value: "pass" };
  if (scale === "CET-6") return { standard: "CET-6", value: "pass" };
  if (scale === "JLPT") return { standard: "JLPT", value: "N3" };
  if (scale === "TOPIK") return { standard: "TOPIK", value: "3" };
  return undefined;
}

function deriveCefrFromPreference(preference: ProficiencyPreference): CEFRLevel {
  return proficiencyPreferenceToCefrLevel(preference);
}

function t(key: string, substitutions?: string | string[]): string {
  const message = browser.i18n.getMessage(key, substitutions as any);
  return message || key;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeSiteEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function parseCustomHeaders(
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
    log.debug("Failed to parse custom headers JSON", { message: getErrorMessage(error) });
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

function resolveChannel(
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
      extra:
        raw?.extra && typeof raw.extra === "object" ? (raw.extra as any) : {},
      followTranslate: false,
    };
  }

  const translateRoute = routes.translate;
  for (const key of FOLLOW_TRANSLATE_BEHAVIOR_KEYS) {
    const raw = settings.behaviorRoutes?.[key];
    const inferredFollow =
      !raw ||
      (routes[key].kind === translateRoute.kind &&
        (routes[key].kind !== 1 ||
          routes[key].channelId === translateRoute.channelId));

    routes[key] = {
      ...routes[key],
      followTranslate: inferredFollow,
      ...(inferredFollow
        ? {
            kind: translateRoute.kind,
            channelId:
              translateRoute.kind === 1 ? translateRoute.channelId : null,
          }
        : {}),
    };
  }
  return routes;
}

function settingsToFormState(settings: Settings): FormState {
  const channels: ChannelFormState[] = settings.channels
    .slice()
    .sort((a, b) => a.channelId - b.channelId)
    .map((channel) => {
      const cfg = (channel.config ?? {}) as Record<string, unknown>;
      const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
      const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey : "";
      const customHeaders = cfg.customHeaders as unknown;
      const customHeadersText = z.record(z.string()).safeParse(customHeaders)
        .success
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

  return {
    channels,
    behaviorRoutes: ensureBehaviorRoutesComplete(settings),
    nativeLanguage: settings.nativeLanguage,
    targetLanguage: settings.targetLanguage,
    proficiencyLevel: settings.proficiencyLevel,
    proficiencyPreference,
    theme: settings.theme,
    promptStyle: settings.promptStyle,
    enabled: settings.enabled,
    autoEnhance: settings.autoEnhance,
    webEnhanceMode: settings.webEnhanceMode,
    webShowOriginal: settings.webShowOriginal,
    webStyleMapping: settings.webStyleMapping,
    webCustomCss: settings.webCustomCss,
    scenesEnabled: settings.scenesEnabled,
    hasCompletedOnboarding: settings.hasCompletedOnboarding,
    floatingButtonEnabled: settings.floatingButtonEnabled,
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
  };
}

function channelTypeLabel(typeId: ChannelTypeId): string {
  switch (typeId) {
    case 1:
      return t("translationProvider_openai");
    case 2:
      return t("translationProvider_claude");
    case 3:
      return t("translationProvider_gemini");
  }
}

function routeKindLabel(kind: RouteKind): string {
  switch (kind) {
    case 1:
      return t("optionsRouteKind_channel");
    case 2:
      return t("translationProvider_google");
    case 3:
      return t("translationProvider_bing");
  }
}

function behaviorLabel(key: BehaviorKey): string {
  return t(`optionsBehavior_${key}`);
}

function behaviorDesc(key: BehaviorKey): string {
  return t(`optionsBehaviorDesc_${key}`);
}

function isIconUrlAllowed(raw: string): boolean {
  const value = raw.trim();
  if (!value) return true;
  if (value.startsWith("https://")) return true;
  if (value.startsWith("assets/") || value.startsWith("/assets/")) return true;
  if (value.startsWith("icons/") || value.startsWith("/icons/")) return true;
  return false;
}

function iconOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!value.startsWith("https://")) return null;
  try {
    return new URL(value).origin;
  } catch (error: unknown) {
    log.debug("Invalid icon URL; cannot extract origin", { value, message: getErrorMessage(error) });
    return null;
  }
}

function channelIsConfigured(channel: ChannelFormState): boolean {
  const model = channel.model.trim();
  if (!model) return false;
  if (channel.typeId === 1) {
    const baseUrl = channel.baseUrl.trim();
    return Boolean(baseUrl && z.string().url().safeParse(baseUrl).success);
  }
  return Boolean(channel.apiKey.trim());
}

function channelHasAnyInput(channel: ChannelFormState): boolean {
  return Boolean(
    channel.model.trim() ||
    channel.baseUrl.trim() ||
    channel.apiKey.trim() ||
    channel.customHeadersText.trim() ||
    channel.iconUrl.trim(),
  );
}

function buildChannel(
  channel: ChannelFormState,
  required: boolean,
): {
  ok: true;
  value: ProviderChannel;
} | {
  ok: false;
  errors: ChannelFieldErrors;
} {
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
    const baseUrlToValidate = typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : undefined;
    
    if (channel.typeId === 1) {
      return ProviderConfigSchema.safeParse({
        model,
        ...(baseUrlToValidate ? { baseUrl: baseUrlToValidate } : {}),
        ...(typeof config.apiKey === "string" && config.apiKey.trim()
          ? { apiKey: config.apiKey.trim() }
          : {}),
        ...(config.customHeaders
          ? { customHeaders: config.customHeaders }
          : {}),
      });
    }
    if (channel.typeId === 2) {
      return ClaudeProviderConfigSchema.safeParse({
        model,
        apiKey: String(config.apiKey ?? ""),
        ...(baseUrlToValidate ? { baseUrl: baseUrlToValidate } : {}),
        ...(config.customHeaders
          ? { customHeaders: config.customHeaders }
          : {}),
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

function buildSettingsPatch(form: FormState):
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
    if (typeof route.channelId === "number")
      requiredChannelIds.add(route.channelId);
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
    builtChannels
      .map((channel) => iconOrigin(channel.iconUrl ?? ""))
      .filter(Boolean) as string[],
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
    form.webdav.url.trim() ||
      form.webdav.username.trim() ||
      form.webdav.password.trim(),
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
    theme: form.theme,
    promptStyle: form.promptStyle,
    enabled: form.enabled,
    autoEnhance: form.autoEnhance,
    webEnhanceMode: form.webEnhanceMode,
    webShowOriginal: form.webShowOriginal,
    webStyleMapping: form.webStyleMapping,
    webCustomCss: form.webCustomCss,
    scenesEnabled: form.scenesEnabled,
    hasCompletedOnboarding: form.hasCompletedOnboarding,
    floatingButtonEnabled: form.floatingButtonEnabled,
    englishCorrection: form.englishCorrection,
    siteMode: form.siteMode,
    excludedSites: form.excludedSites,
    allowedSites: form.allowedSites,
    webdav: webdavHasAnyInput ? builtWebdav : undefined,
  };

  const parsed = SettingsSchema.partial().strict().safeParse(patch);
  if (!parsed.success) {
    return { ok: false, errors: {} };
  }

  return { ok: true, patch, errors: {}, iconOriginsToRequest };
}

function nextChannelId(channels: ChannelFormState[]): number {
  const max = channels.reduce((acc, ch) => Math.max(acc, ch.channelId), 0);
  return max + 1;
}

function defaultChannelName(typeId: ChannelTypeId): string {
  return channelTypeLabel(typeId);
}

function repairRoutes(form: FormState): FormState {
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

async function requestIconHostPermissions(origins: string[]): Promise<void> {
  for (const origin of origins) {
    try {
      await sendMessage("REQUEST_HOST_PERMISSION", { origin });
    } catch (error: unknown) {
      log.warn("REQUEST_HOST_PERMISSION threw while requesting icon host permission; continuing", {
        origin,
        message: getErrorMessage(error),
      });
    }
  }
}

function buildTestPayload(
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
      ...(customHeadersResult.value
        ? { customHeaders: customHeadersResult.value }
        : {}),
    });
    if (!parsed.success) return null;
    return { type: "openai", config: parsed.data };
  }

  if (channel.typeId === 2) {
    const parsed = ClaudeProviderConfigSchema.safeParse({
      model,
      apiKey: channel.apiKey.trim(),
      ...(channel.baseUrl.trim() ? { baseUrl: channel.baseUrl.trim() } : {}),
      ...(customHeadersResult.value
        ? { customHeaders: customHeadersResult.value }
        : {}),
    });
    if (!parsed.success) return null;
    return { type: "claude", config: parsed.data };
  }

  const parsed = GeminiProviderConfigSchema.safeParse({
    model,
    apiKey: channel.apiKey.trim(),
    ...(channel.baseUrl.trim() ? { baseUrl: channel.baseUrl.trim() } : {}),
    ...(customHeadersResult.value
      ? { customHeaders: customHeadersResult.value }
      : {}),
  });
  if (!parsed.success) return null;
  return { type: "gemini", config: parsed.data };
}

export function Options(): React.ReactElement {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [routingLearningOpen, setRoutingLearningOpen] = useState(false);
  const [routingSubtitleOpen, setRoutingSubtitleOpen] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null);
  const [webdavAction, setWebdavAction] = useState<"upload" | "download" | null>(
    null,
  );
  const [expandedChannels, setExpandedChannels] = useState<Record<number, boolean>>({});

  useApplyTheme(form?.theme ?? settings?.theme);

  useEffect(() => {
    async function load() {
      const response = await sendMessage("GET_SETTINGS", undefined);
      if (!response.ok) {
        log.error("Failed to load settings", response.error);
        setLoading(false);
        return;
      }

      setSettings(response.value);
      const formState = settingsToFormState(response.value);
      setForm(formState);

      const sortedChannels = formState.channels
        .slice()
        .sort((a, b) => a.channelId - b.channelId);
      if (sortedChannels.length > 0 && sortedChannels[0]) {
        setExpandedChannels({ [sortedChannels[0].channelId]: true });
      }

      setLoading(false);
    }
    load();
  }, []);

  const channelOptions = useMemo(() => {
    if (!form) return [];
    return form.channels
      .slice()
      .sort((a, b) => a.channelId - b.channelId)
      .map((channel) => ({
        value: String(channel.channelId),
        label: `${channel.name || `#${channel.channelId}`} · ${channelTypeLabel(channel.typeId)} · ${channel.model || "-"}`,
      }));
  }, [form]);

  async function handleSave() {
    if (!form || saving) return;

    setSaving(true);
    setErrors({});
    try {
      const built = buildSettingsPatch(form);
      if (!built.ok) {
        setErrors(built.errors);
        toast({
          title: t("optionsValidationError"),
          variant: "destructive",
        });
        return;
      }

      if (built.iconOriginsToRequest.length > 0) {
        await requestIconHostPermissions(built.iconOriginsToRequest);
      }

      const response = await sendMessage("SET_SETTINGS", built.patch);
      if (!response.ok) {
        toast({
          title: t("optionsSaveError", response.error.message),
          variant: "destructive",
        });
        return;
      }

      const merged = SettingsSchema.parse({
        ...(settings ?? {}),
        ...built.patch,
      });
      setSettings(merged);
      setForm(settingsToFormState(merged));
      toast({
        title: t("optionsSaveSuccess"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function testProvider(channel: ChannelFormState) {
    const payload = buildTestPayload(channel);
    if (!payload) {
      toast({
        title: t("optionsTestInvalidConfig"),
        variant: "destructive",
      });
      return;
    }

    setTestingChannelId(channel.channelId);
    try {
      const response = await sendMessage("TEST_PROVIDER_CONNECTION", payload);
      if (response.ok) {
        toast({
          title: t("optionsTestSuccess"),
        });
      } else {
        toast({
          title: t("optionsTestError", response.error.message),
          variant: "destructive",
        });
      }
    } finally {
      setTestingChannelId(null);
    }
  }

  async function ensureWebDAVPermission(url: string): Promise<boolean> {
    try {
      const origin = new URL(url).origin;
      const response = await sendMessage("REQUEST_HOST_PERMISSION", { origin });
      if (response.ok && response.value) return true;
      toast({
        title: t("optionsWebDAVPermissionDenied"),
        variant: "destructive",
      });
      return false;
    } catch (error: unknown) {
      log.error("WebDAV permission request failed", { message: getErrorMessage(error) });
      toast({
        title: t(
          "optionsWebDAVPermissionError",
          error instanceof Error ? error.message : t("error_unknown"),
        ),
        variant: "destructive",
      });
      return false;
    }
  }

  function buildWebDAVConfig():
    | { ok: true; value: NonNullable<Settings["webdav"]> }
    | { ok: false } {
    if (!form) return { ok: false };
    const parsed = WebDAVConfigSchema.safeParse({
      url: form.webdav.url.trim(),
      username: form.webdav.username,
      password: form.webdav.password,
      path: form.webdav.path.trim() || "/LexiPath/backup.json",
    });
    if (!parsed.success) {
      toast({
        title: t("optionsWebDAVInvalidConfig"),
        variant: "destructive",
      });
      return { ok: false };
    }
    return { ok: true, value: parsed.data };
  }

  async function handleWebDAVUpload() {
    if (!form || webdavAction) return;
    const configResult = buildWebDAVConfig();
    if (!configResult.ok) return;

    const hasPermission = await ensureWebDAVPermission(configResult.value.url);
    if (!hasPermission) return;

    setWebdavAction("upload");
    try {
      const response = await sendMessage("WEBDAV_UPLOAD", configResult.value);
      if (response.ok) {
        toast({ title: t("optionsWebDAVUploadSuccess") });
      } else {
        toast({
          title: t("optionsWebDAVUploadError", response.error.message),
          variant: "destructive",
        });
      }
    } finally {
      setWebdavAction(null);
    }
  }

  async function handleWebDAVDownload() {
    if (!form || webdavAction) return;
    const configResult = buildWebDAVConfig();
    if (!configResult.ok) return;

    const hasPermission = await ensureWebDAVPermission(configResult.value.url);
    if (!hasPermission) return;

    setWebdavAction("download");
    try {
      const response = await sendMessage("WEBDAV_DOWNLOAD", configResult.value);
      if (response.ok) {
        toast({ title: t("optionsWebDAVDownloadSuccess") });
        const settingsRes = await sendMessage("GET_SETTINGS", undefined);
        if (settingsRes.ok) {
          setSettings(settingsRes.value);
          setForm(settingsToFormState(settingsRes.value));
        }
      } else {
        toast({
          title: t("optionsWebDAVDownloadError", response.error.message),
          variant: "destructive",
        });
      }
    } finally {
      setWebdavAction(null);
    }
  }

  async function handleExport() {
    const response = await sendMessage("EXPORT_DATA", undefined);
    if (!response.ok) {
      toast({
        title: t("optionsExportError", response.error.message),
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([JSON.stringify(response.value, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lexipath-backup-${new Date().toISOString().split("T")[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast({
      title: t("optionsExportSuccess"),
    });
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = e.target?.result;
        if (typeof raw !== "string") return;
        const data = JSON.parse(raw);
        const response = await sendMessage("IMPORT_DATA", data);
        if (response.ok) {
          toast({
            title: t("optionsImportSuccess"),
          });
          const settingsRes = await sendMessage("GET_SETTINGS", undefined);
          if (settingsRes.ok) {
            setSettings(settingsRes.value);
            setForm(settingsToFormState(settingsRes.value));
          }
        } else {
          toast({
            title: t("optionsImportError", response.error.message),
            variant: "destructive",
          });
        }
      } catch (err: unknown) {
        log.error("Import failed", { message: getErrorMessage(err) });
        toast({
          title: t(
            "optionsImportError",
            err instanceof Error ? err.message : t("optionsImportInvalidJson")
          ),
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function testGoogleTranslate() {
    const response = await sendMessage("TEST_PROVIDER_CONNECTION", {
      type: "google",
    });
    if (response.ok) {
      toast({ title: t("optionsTestSuccess") });
    } else {
      toast({
        title: t("optionsTestError", response.error.message),
        variant: "destructive",
      });
    }
  }

  async function testBingTranslate() {
    const response = await sendMessage("TEST_PROVIDER_CONNECTION", {
      type: "bing",
    });
    if (response.ok) {
      toast({ title: t("optionsTestSuccess") });
    } else {
      toast({
        title: t("optionsTestError", response.error.message),
        variant: "destructive",
      });
    }
  }

  if (loading || !form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const routeKindOptions = (allowed: RouteKind[]) =>
    allowed.map((kind) => (
      <SelectItem key={String(kind)} value={String(kind)}>
        {routeKindLabel(kind)}
      </SelectItem>
    ));

  const currentForm = form;

  const coreRoutingKeys: readonly BehaviorKey[] = ["translate", "chat"];
  const learningRoutingKeys: readonly BehaviorKey[] = [
    "select_keywords",
    "translate_keywords",
    "dictionary",
    "english_correction",
  ];
  const subtitleRoutingKeys: readonly BehaviorKey[] = ["adapt_subtitle"];

  function isFollowTranslateBehavior(key: BehaviorKey): boolean {
    return FOLLOW_TRANSLATE_BEHAVIOR_KEYS.includes(key);
  }

  function applyTranslateFollowers(
    routes: Record<BehaviorKey, RouteFormState>,
    translateRoute: RouteFormState,
  ): Record<BehaviorKey, RouteFormState> {
    const next = { ...routes };
    for (const key of FOLLOW_TRANSLATE_BEHAVIOR_KEYS) {
      const route = next[key];
      if (!route.followTranslate) continue;
      next[key] = {
        ...route,
        kind: translateRoute.kind,
        channelId: translateRoute.kind === 1 ? translateRoute.channelId : null,
      };
    }
    return next;
  }

  function updateBehaviorRoute(key: BehaviorKey, nextRoute: RouteFormState) {
    setForm((current) => {
      if (!current) return current;
      const nextRoutes: Record<BehaviorKey, RouteFormState> = {
        ...current.behaviorRoutes,
        [key]: nextRoute,
      };

      if (key === "translate") {
        return {
          ...current,
          behaviorRoutes: applyTranslateFollowers(nextRoutes, nextRoute),
        };
      }

      return { ...current, behaviorRoutes: nextRoutes };
    });
  }

  function renderRoutingRow(key: BehaviorKey, isNested = false) {
    const route = currentForm.behaviorRoutes[key];
    const allowedKinds = BEHAVIOR_KIND_ALLOWLIST[key];
    const routeError = errors.routes?.[key];

    const translateRoute = currentForm.behaviorRoutes.translate;
    const followSupported = isFollowTranslateBehavior(key);

    const kindValue =
      followSupported && route.followTranslate ? "follow" : String(route.kind);

    return (
      <div
        key={key}
        className={cn(
          "relative flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all",
          isNested
            ? "bg-transparent py-5 px-2 border-b border-gray-100 dark:border-white/5 last:border-0"
            : "bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-5 hover:shadow-md",
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "h-12 w-12 rounded-xl flex items-center justify-center shadow-sm transition-colors",
              isNested
                ? "bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5"
                : "bg-indigo-50 dark:bg-white/5 border border-indigo-100 dark:border-white/5",
            )}
          >
            <Zap
              className={cn(
                "h-6 w-6",
                isNested
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-indigo-500 dark:text-indigo-400",
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4
                className={cn(
                  "font-bold text-gray-900 dark:text-white",
                  isNested ? "text-sm" : "text-base",
                )}
              >
                {behaviorLabel(key)}
              </h4>
              {followSupported && route.followTranslate && (
                <Badge className="bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20">
                  {t("optionsRouteFollowTranslate")}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {behaviorDesc(key)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Select
              value={kindValue}
              onValueChange={(v) => {
                if (followSupported && v === "follow") {
                  updateBehaviorRoute(key, {
                    ...route,
                    followTranslate: true,
                    kind: translateRoute.kind,
                    channelId:
                      translateRoute.kind === 1
                        ? translateRoute.channelId
                        : null,
                  });
                  return;
                }

                const kind = Number(v) as RouteKind;
                updateBehaviorRoute(key, {
                  ...route,
                  followTranslate: false,
                  kind,
                  channelId:
                    kind === 1
                      ? (route.channelId ??
                          (currentForm.channels[0]?.channelId ?? null))
                      : null,
                });
              }}
            >
              <SelectTrigger
                data-testid={`route-kind-${key}`}
                className="w-40 bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                {followSupported && (
                  <SelectItem value="follow">
                    {t("optionsRouteFollowTranslate")}
                  </SelectItem>
                )}
                {routeKindOptions(allowedKinds)}
              </SelectContent>
            </Select>

            {route.kind === 1 && !(followSupported && route.followTranslate) && (
              <Select
                value={
                  route.channelId === null ? "null" : String(route.channelId)
                }
                onValueChange={(v) =>
                  updateBehaviorRoute(key, {
                    ...route,
                    channelId: v === "null" ? null : Number(v),
                  })
                }
              >
                <SelectTrigger className="w-48 bg-indigo-50/50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl h-10 font-bold text-xs">
                  <SelectValue
                    placeholder={t("optionsRouteChannelPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                  {currentForm.channels.map((ch) => (
                    <SelectItem key={ch.channelId} value={String(ch.channelId)}>
                      {ch.name || `#${ch.channelId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {routeError && (
            <p className="text-[10px] text-rose-500 font-bold ml-1">
              {t(routeError)}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0d0e14] text-gray-900 dark:text-white relative overflow-hidden font-sans transition-colors duration-500">
      <Toaster />
      
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 dark:bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/5 dark:bg-purple-600/10 rounded-full blur-[120px]" />
      </div>

      <Tabs defaultValue="channels" className="relative z-10 mx-auto max-w-[1440px] min-h-screen flex flex-col lg:flex-row">
        {/* Sidebar Navigation */}
        <div className="w-full lg:w-72 lg:h-screen lg:sticky lg:top-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-white/5 bg-white/70 dark:bg-[#0d0e14]/70 backdrop-blur-xl p-4 md:p-6 lg:p-8 flex flex-col gap-6 lg:gap-10 transition-all">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-premium p-[1px] shadow-lg shadow-indigo-500/20">
              <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-white dark:bg-[#0d0e14]">
                <img src={ICON_URL} className="h-6 w-6" alt={t("extensionName")} />
              </div>
            </div>
            <h1 className="font-black text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-white/70">
              {t("extensionName")}
            </h1>
          </div>

          <TabsList className="hidden lg:flex flex-col h-auto bg-transparent border-0 space-y-1.5 p-0">
            {[
              { value: "channels", label: t("optionsTab_channels"), icon: Sparkles },
              { value: "routing", label: t("optionsRoutingTitle"), icon: ChevronRight },
              { value: "language", label: t("optionsTab_language"), icon: Languages },
              { value: "sites", label: t("optionsTab_sites"), icon: AlertCircle },
              { value: "backup", label: t("optionsTab_backup"), icon: Copy },
            ].map((tab) => (
              <TabsTrigger 
                key={tab.value}
                value={tab.value}
                className="justify-start gap-2.5 px-4 py-3 rounded-xl data-[state=active]:bg-indigo-600 dark:data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-all border-0 shadow-none"
              >
                <tab.icon className="h-4 w-4 shrink-0" />
                <span className="font-bold whitespace-nowrap">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="hidden lg:flex mt-auto pt-6 border-t border-gray-200 dark:border-white/5 flex-col gap-4">
             <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className={cn("h-2 w-2 rounded-full", form.enabled ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-gray-400")} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                     {form.enabled ? t("on") : t("off")}
                  </span>
                </div>
                <Button 
                  size="sm"
                  variant="ghost"
                  className="h-9 px-4 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-400/10 rounded-xl"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                  {t("optionsSaveButton")}
                </Button>
             </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col p-5 md:p-8 lg:p-12 xl:p-16 pb-32 lg:pb-16 max-w-5xl mx-auto w-full overflow-y-auto h-screen custom-scrollbar relative">
          <div className="lg:hidden flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <img src={ICON_URL} className="h-6 w-6" alt={t("extensionName")} />
              <h1 className="font-black text-lg tracking-tight">{t("extensionName")}</h1>
            </div>
            <Button 
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-6 h-10 shadow-lg shadow-indigo-600/20"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("optionsSaveButton")}
            </Button>
          </div>

          <TabsContent value="channels" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none">
            <header className="space-y-3">
              <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">{t("optionsChannelsTitle")}</h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">{t("optionsChannelsDesc")}</p>
            </header>

            <div className="flex items-center justify-between py-4 border-b border-gray-100 dark:border-white/5">
               <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsTab_channels")}</h3>
               <Button
                className="bg-indigo-600/10 hover:bg-indigo-600 text-indigo-600 hover:text-white border border-indigo-200 dark:border-indigo-500/20 rounded-xl px-5 h-10 font-bold transition-all"
                onClick={() => {
                  const id = nextChannelId(form.channels);
                  const typeId: ChannelTypeId = 1;
                  setForm(
                    repairRoutes({
                      ...form,
                      channels: [
                        ...form.channels,
                        {
                          channelId: id,
                          typeId,
                          name: defaultChannelName(typeId),
                          model: "",
                          baseUrl: "",
                          apiKey: "",
                          customHeadersText: "",
                          iconUrl: "",
                          concurrencyLimit: 15,
                          configExtra: {},
                          extra: {},
                        },
                      ],
                    }),
                  );
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t("optionsAddChannel")}
              </Button>
            </div>

            <div className="grid gap-5">
              {form.channels
                .slice()
                .sort((a, b) => a.channelId - b.channelId)
                .map((channel) => {
                  const channelErrors = errors.channels?.[channel.channelId] ?? {};
                  const isTesting = testingChannelId === channel.channelId;
                  const isExpanded = expandedChannels[channel.channelId] ?? false;

                  return (
                    <div key={channel.channelId} className="relative group">
                      <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />
                      <Card className="relative border-gray-200 dark:border-white/10 bg-white dark:bg-[#15161e] shadow-sm overflow-hidden rounded-2xl transition-all duration-300">
                        <CardHeader
                          className="pb-4 pt-5 px-6 cursor-pointer select-none"
                          onClick={() => setExpandedChannels(prev => ({ ...prev, [channel.channelId]: !isExpanded }))}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={cn("p-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 transition-transform duration-300", isExpanded ? "rotate-90" : "")}>
                                <ChevronRight className="h-4 w-4 text-gray-400" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <CardTitle className="text-lg font-bold text-gray-900 dark:text-white">
                                    {channel.name || `#${channel.channelId}`}
                                  </CardTitle>
                                  <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-500/20 px-2 py-0 text-[10px] font-bold">
                                    {channelTypeLabel(channel.typeId)}
                                  </Badge>
                                </div>
                                <CardDescription className="text-gray-500 dark:text-gray-400 mt-1 font-semibold text-[11px] uppercase tracking-wider">
                                  {channel.model?.trim() ? channel.model.trim() : t("optionsChannelModelUnset")}
                                </CardDescription>
                              </div>
                            </div>

                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-white gap-2 rounded-xl px-4"
                                onClick={() => testProvider(channel)}
                                disabled={isTesting}
                              >
                                {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 text-indigo-500" />}
                                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest">{t("optionsTestConnection")}</span>
                              </Button>
                              
                              <div className="h-6 w-px bg-gray-200 dark:bg-white/10 mx-1" />

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-gray-400 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-white/5 rounded-xl transition-colors"
                                onClick={() => {
                                  const id = nextChannelId(form.channels);
                                  const copy = {
                                    ...channel,
                                    channelId: id,
                                    name: `${channel.name || defaultChannelName(channel.typeId)}${t("optionsChannelCopySuffix")}`,
                                  };
                                  setForm(repairRoutes({ ...form, channels: [...form.channels, copy] }));
                                }}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-red-500/10 rounded-xl transition-colors"
                                onClick={() => {
                                  if (form.channels.length <= 1) return;
                                  const nextChannels = form.channels.filter(ch => ch.channelId !== channel.channelId);
                                  setForm(repairRoutes({ ...form, channels: nextChannels }));
                                }}
                                disabled={form.channels.length <= 1}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>

                        <div className={cn(
                            "grid transition-all duration-500 ease-in-out",
                            isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                          )}>
                            <div className="overflow-hidden">
                              <CardContent className="px-6 pb-8 pt-2 space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                   <div className="space-y-2.5">
                                      <Label 
                                        htmlFor={`channel-${channel.channelId}-name`}
                                        className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                                      >
                                        {t("optionsChannelNameLabel")}
                                      </Label>
                                      <Input 
                                        id={`channel-${channel.channelId}-name`}
                                        value={channel.name}
                                        onChange={e => setForm({
                                          ...form,
                                          channels: form.channels.map(ch => ch.channelId === channel.channelId ? { ...ch, name: e.target.value } : ch)
                                        })}
                                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 focus:ring-indigo-500/30 rounded-xl h-11 font-medium transition-all"
                                      />
                                      {channelErrors.name && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(channelErrors.name)}</p>}
                                   </div>
                                   <div className="space-y-2.5">
                                      <Label 
                                        htmlFor={`channel-${channel.channelId}-type`}
                                        className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                                      >
                                        {t("optionsChannelTypeLabel")}
                                      </Label>
                                      <Select
                                        value={String(channel.typeId)}
                                        onValueChange={v => {
                                          const parsed = ChannelTypeIdSchema.safeParse(Number(v));
                                          if (parsed.success) setForm({
                                            ...form,
                                            channels: form.channels.map(ch => ch.channelId === channel.channelId ? { ...ch, typeId: parsed.data } : ch)
                                          });
                                        }}
                                      >
                                        <SelectTrigger 
                                          id={`channel-${channel.channelId}-type`}
                                          className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 h-11 rounded-xl font-medium"
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                          <SelectItem value="1">{channelTypeLabel(1)}</SelectItem>
                                          <SelectItem value="2">{channelTypeLabel(2)}</SelectItem>
                                          <SelectItem value="3">{channelTypeLabel(3)}</SelectItem>
                                        </SelectContent>
                                      </Select>
                                   </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                   <div className="space-y-2.5">
                                      <Label 
                                        htmlFor={`channel-${channel.channelId}-model`}
                                        className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                                      >
                                        {t("optionsProviderModelLabel")}
                                      </Label>
                                      <Input 
                                        id={`channel-${channel.channelId}-model`}
                                        value={channel.model}
                                        onChange={e => setForm({
                                          ...form,
                                          channels: form.channels.map(ch => ch.channelId === channel.channelId ? { ...ch, model: e.target.value } : ch)
                                        })}
                                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                                      />
                                      {channelErrors.model && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(channelErrors.model)}</p>}
                                   </div>
                                   <div className="space-y-2.5">
                                      <Label 
                                        htmlFor={`channel-${channel.channelId}-api-key`}
                                        className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                                      >
                                        {t("optionsProviderApiKeyLabel")}
                                      </Label>
                                      <Input 
                                        id={`channel-${channel.channelId}-api-key`}
                                        type="password"
                                        value={channel.apiKey}
                                        onChange={e => setForm({
                                          ...form,
                                          channels: form.channels.map(ch => ch.channelId === channel.channelId ? { ...ch, apiKey: e.target.value } : ch)
                                        })}
                                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                                        placeholder={t("optionsProviderApiKeyPlaceholder")}
                                      />
                                      {channelErrors.apiKey && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(channelErrors.apiKey)}</p>}
                                   </div>
                                </div>

                                <div className="space-y-2.5">
                                   <Label
                                     htmlFor={`channel-${channel.channelId}-base-url`}
                                     className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                                   >
                                     {t("optionsProviderBaseUrlLabel")}
                                   </Label>
                                   <Input
                                      id={`channel-${channel.channelId}-base-url`}
                                      value={channel.baseUrl}
                                      onChange={e => setForm({
                                        ...form,
                                        channels: form.channels.map(ch => ch.channelId === channel.channelId ? { ...ch, baseUrl: e.target.value } : ch)
                                      })}
                                      className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                                      placeholder={
                                        channel.typeId === 1
                                          ? t("optionsProviderBaseUrlPlaceholder")
                                          : channel.typeId === 2
                                            ? t("optionsClaudeBaseUrlPlaceholder")
                                            : t("optionsGeminiBaseUrlPlaceholder")
                                      }
                                   />
                                   {channelErrors.baseUrl && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(channelErrors.baseUrl)}</p>}
                                </div>

                                <div className="space-y-2.5">
                                   <Label
                                     htmlFor={`channel-${channel.channelId}-concurrency-limit`}
                                     className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                                   >
                                     {t("optionsConcurrencyLimitLabel")}
                                   </Label>
                                   <Input
                                      id={`channel-${channel.channelId}-concurrency-limit`}
                                      type="number"
                                      min="1"
                                      max="500"
                                      step="1"
                                      value={channel.concurrencyLimit}
                                      onChange={e => {
                                        const next = e.target.valueAsNumber;
                                        if (!Number.isFinite(next)) return;
                                        const clamped = Math.min(500, Math.max(1, Math.trunc(next)));
                                        setForm(prev => {
                                          if (!prev) return prev;
                                          return {
                                            ...prev,
                                            channels: prev.channels.map(ch =>
                                              ch.channelId === channel.channelId
                                                ? { ...ch, concurrencyLimit: clamped }
                                                : ch
                                            ),
                                          };
                                        });
                                      }}
                                      className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                                      placeholder="15"
                                   />
                                   <p className="text-[10px] text-gray-500 dark:text-gray-400 ml-1">{t("optionsConcurrencyLimitDesc")}</p>
                                </div>
                              </CardContent>
                            </div>
                        </div>
                      </Card>
                    </div>
                  );
                })}
            </div>
          </TabsContent>

          <TabsContent value="routing" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none">
             <header className="space-y-3">
                <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">{t("optionsRoutingTitle")}</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">{t("optionsRoutingDesc")}</p>
             </header>

             <div className="space-y-8">
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                    {t("optionsRoutingGroupCoreTitle")}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("optionsRoutingGroupCoreDesc")}
                  </p>
                </div>
                <div className="grid gap-4">
                  {coreRoutingKeys.map((key) => renderRoutingRow(key))}
                </div>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setRoutingLearningOpen(!routingLearningOpen)}
                  className="w-full flex items-center justify-between bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl px-5 py-4 hover:shadow-sm transition-all"
                >
                  <div className="text-left space-y-1">
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                      {t("optionsRoutingGroupLearningTitle")}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("optionsRoutingGroupLearningDesc")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                      {routingLearningOpen
                        ? t("optionsRoutingGroupCollapse")
                        : t("optionsRoutingGroupExpand")}
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-gray-400 transition-transform",
                        routingLearningOpen ? "rotate-90" : "rotate-0",
                      )}
                    />
                  </div>
                </button>

                <AnimatePresence>
                  {routingLearningOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden bg-gray-50/30 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 rounded-2xl px-4"
                    >
                      {learningRoutingKeys.map((key) => renderRoutingRow(key, true))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setRoutingSubtitleOpen(!routingSubtitleOpen)}
                  className="w-full flex items-center justify-between bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl px-5 py-4 hover:shadow-sm transition-all"
                >
                  <div className="text-left space-y-1">
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                      {t("optionsRoutingGroupSubtitleTitle")}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("optionsRoutingGroupSubtitleDesc")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                      {routingSubtitleOpen
                        ? t("optionsRoutingGroupCollapse")
                        : t("optionsRoutingGroupExpand")}
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-gray-400 transition-transform",
                        routingSubtitleOpen ? "rotate-90" : "rotate-0",
                      )}
                    />
                  </div>
                </button>

                <AnimatePresence>
                  {routingSubtitleOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden bg-gray-50/30 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 rounded-2xl px-4"
                    >
                      {subtitleRoutingKeys.map((key) => renderRoutingRow(key, true))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
             </div>

             <div className="flex flex-wrap gap-3 pt-6">
                <Button 
                  variant="outline" 
                  onClick={testGoogleTranslate}
                  className="h-10 px-6 rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 font-bold text-[10px] uppercase tracking-widest transition-all shadow-sm"
                >
                  {t("optionsTestGoogleTranslate")}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={testBingTranslate}
                  className="h-10 px-6 rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 font-bold text-[10px] uppercase tracking-widest transition-all shadow-sm"
                >
                  {t("optionsTestBingTranslate")}
                </Button>
             </div>
          </TabsContent>

          <TabsContent value="language" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none">
             <header className="space-y-3">
                <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">{t("optionsTab_language")}</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">{t("optionsLanguageDesc")}</p>
             </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
                  <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
                     <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsLanguageTitle")}</h4>
                     
                     <div className="space-y-5">
                      <div className="space-y-2.5">
                         <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("nativeLanguage")}</Label>
                         <Select
                           value={form.nativeLanguage}
                           onValueChange={(v) => {
                             const nextNativeLanguage = v as Settings["nativeLanguage"];
                             const currentScale = (form.proficiencyPreference?.standard ?? "CEFR") as ProficiencyScaleOption;
                             const nextScaleApplicable = isScaleApplicable({
                               scale: currentScale,
                               targetLanguage: form.targetLanguage,
                               nativeLanguage: nextNativeLanguage,
                             });
                             setForm({
                               ...form,
                               nativeLanguage: nextNativeLanguage,
                               ...(nextScaleApplicable ? {} : { proficiencyPreference: undefined }),
                             });
                           }}
                          >
                             <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                <SelectValue />
                             </SelectTrigger>
                             <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                               {NATIVE_LANGUAGE_OPTIONS.map((lang) => (
                                 <SelectItem key={lang} value={lang}>
                                   {t(`languageNative_${lang.replace("-", "_")}`)}
                                 </SelectItem>
                               ))}
                             </SelectContent>
                          </Select>
                       </div>
                      
                      <div className="space-y-2.5">
                         <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("targetLanguage")}</Label>
                         <Select
                           value={form.targetLanguage}
                           onValueChange={(v) => {
                             const nextTargetLanguage = v as Settings["targetLanguage"];
                             const currentScale = (form.proficiencyPreference?.standard ?? "CEFR") as ProficiencyScaleOption;
                             const nextScaleApplicable = isScaleApplicable({
                               scale: currentScale,
                               targetLanguage: nextTargetLanguage,
                               nativeLanguage: form.nativeLanguage,
                             });
                             setForm({
                               ...form,
                               targetLanguage: nextTargetLanguage,
                               ...(nextScaleApplicable ? {} : { proficiencyPreference: undefined }),
                             });
                           }}
                         >
                            <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                               <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                               {SupportedLanguageSchema.options.map(lang => <SelectItem key={lang} value={lang}>{t(`languageTarget_${lang}`)}</SelectItem>)}
                            </SelectContent>
                         </Select>
                      </div>
                     </div>
                  </div>

                  <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
                     <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("proficiencyLevel")}</h4>
                   
                    <div className="space-y-5">
                       <div className="space-y-2.5">
                          <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsProficiencyScaleLabel")}</Label>
                          <Select
                            value={(form.proficiencyPreference?.standard ?? "CEFR") as ProficiencyScaleOption}
                            onValueChange={(v) => {
                              const nextScale = v as ProficiencyScaleOption;
                              const nextPreference = defaultPreferenceForScale(nextScale);
                              if (!nextPreference) {
                                setForm({ ...form, proficiencyPreference: undefined });
                                return;
                              }
                              setForm({
                                ...form,
                                proficiencyPreference: nextPreference,
                                proficiencyLevel: deriveCefrFromPreference(nextPreference),
                              });
                            }}
                          >
                             <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                <SelectValue />
                             </SelectTrigger>
                             <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                {getProficiencyScaleOptions({
                                  targetLanguage: form.targetLanguage,
                                  nativeLanguage: form.nativeLanguage,
                                }).map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                             </SelectContent>
                          </Select>
                       </div>

                        {form.proficiencyPreference ? (
                          <div className="space-y-2.5">
                            {form.proficiencyPreference.standard !== "CET-4" &&
                            form.proficiencyPreference.standard !== "CET-6" ? (
                              <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsProficiencyScaleValueLabel")}</Label>
                            ) : null}

                            {form.proficiencyPreference.standard === "IELTS" ? (
                              <Select
                                value={form.proficiencyPreference.value}
                                onValueChange={(v) => {
                                 const next: ProficiencyPreference = { standard: "IELTS", value: v };
                                 setForm({
                                   ...form,
                                   proficiencyPreference: next,
                                   proficiencyLevel: deriveCefrFromPreference(next),
                                 });
                               }}
                             >
                               <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                 {IELTS_BANDS.map((band) => (
                                   <SelectItem key={band} value={band}>
                                     {band}
                                   </SelectItem>
                                 ))}
                               </SelectContent>
                              </Select>
                            ) : null}

                           {form.proficiencyPreference.standard === "JLPT" ? (
                             <Select
                               value={form.proficiencyPreference.value}
                               onValueChange={(v) => {
                                 const next: ProficiencyPreference = { standard: "JLPT", value: v };
                                 setForm({
                                   ...form,
                                   proficiencyPreference: next,
                                   proficiencyLevel: deriveCefrFromPreference(next),
                                 });
                               }}
                             >
                               <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                 {JLPTLevelSchema.options.map((level) => (
                                   <SelectItem key={level} value={level}>
                                     {t(`proficiency_${level}`)}
                                   </SelectItem>
                                 ))}
                               </SelectContent>
                             </Select>
                           ) : null}

                            {form.proficiencyPreference.standard === "TOPIK" ? (
                              <Select
                                value={form.proficiencyPreference.value}
                                onValueChange={(v) => {
                                 const next: ProficiencyPreference = { standard: "TOPIK", value: v };
                                 setForm({
                                   ...form,
                                   proficiencyPreference: next,
                                   proficiencyLevel: deriveCefrFromPreference(next),
                                 });
                               }}
                             >
                               <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                 {TOPIKLevelSchema.options.map((level) => (
                                   <SelectItem key={level} value={String(level)}>
                                     {t(`proficiency_TOPIK${level}`)}
                                   </SelectItem>
                                 ))}
                               </SelectContent>
                              </Select>
                            ) : null}

                            {/* CET-4/CET-6 are fixed standards: no value input, implicit conversion to CEFR. */}

                             <div className="p-3 rounded-xl bg-gray-50/40 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
                               <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                                 {t("optionsProficiencyDerivedCefr", [form.proficiencyLevel])}
                               </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium mt-1">
                                {t(`proficiencyRequirement_${form.proficiencyLevel}`)}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                           <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("proficiencyLevel")}</Label>
                           <Select value={form.proficiencyLevel} onValueChange={v => setForm({...form, proficiencyLevel: v as CEFRLevel})}>
                             <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                <SelectValue />
                             </SelectTrigger>
                             <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                 {CEFRLevelSchema.options.map(level => <SelectItem key={level} value={level}>{t(`proficiency_${level}`)}</SelectItem>)}
                              </SelectContent>
                           </Select>
                           <div className="p-3 rounded-xl bg-gray-50/40 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
                             <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                               {t(`proficiencyRequirement_${form.proficiencyLevel}`)}
                             </p>
                           </div>
                          </div>
                        )}
                       <div className="p-4 rounded-xl bg-indigo-50/30 dark:bg-indigo-500/5 border border-indigo-100/50 dark:border-indigo-500/10">
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed font-medium">
                           {t("optionsProficiencyHint")}
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                          {t("optionsPromptStyleLabel")}
                        </Label>
                        <Select
                          value={form.promptStyle}
                          onValueChange={(v) => setForm({ ...form, promptStyle: v as Settings["promptStyle"] })}
                        >
                          <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                            {PromptStyleKeySchema.options.map((styleKey) => (
                              <SelectItem key={styleKey} value={styleKey}>
                                {t(`promptStyle_${styleKey}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium ml-1">
                          {t("optionsPromptStyleDesc")}
                        </p>
                      </div>
                    </div>
                 </div>

                  <div className="md:col-span-2 bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
                     <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsEnglishCorrectionTitle")}</h4>

                     <div className="space-y-5">
                       <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                         {t("optionsEnglishCorrectionDesc")}
                       </p>

                       <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
                         <div className="space-y-1">
                           <div className="text-sm font-bold text-gray-900 dark:text-white">{t("optionsEnglishCorrectionEnabled")}</div>
                           <div className="text-xs text-gray-500 dark:text-gray-400">{t("optionsEnglishCorrectionEnabledDesc")}</div>
                         </div>
                         <Switch
                           checked={form.englishCorrection.enabled}
                           onCheckedChange={(checked) =>
                             setForm({
                               ...form,
                               englishCorrection: { ...form.englishCorrection, enabled: checked },
                             })
                           }
                         />
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                         <div className="space-y-2.5">
                           <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                             {t("optionsEnglishCorrectionTriggerTimeout")}
                           </Label>
                           <Input
                             type="number"
                             min={100}
                             max={2000}
                             value={String(form.englishCorrection.triggerTimeout)}
                             onChange={(e) => {
                               const next = Number(e.target.value);
                               if (!Number.isFinite(next)) return;
                               setForm({
                                 ...form,
                                 englishCorrection: { ...form.englishCorrection, triggerTimeout: next },
                               });
                             }}
                             className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                           />
                           <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("optionsEnglishCorrectionTriggerTimeoutDesc")}</p>
                         </div>

                         <div className="space-y-2.5">
                           <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                             {t("optionsEnglishCorrectionAutoCloseDelay")}
                           </Label>
                           <Input
                             type="number"
                             min={0}
                             max={10000}
                             value={String(form.englishCorrection.autoCloseDelay)}
                             onChange={(e) => {
                               const next = Number(e.target.value);
                               if (!Number.isFinite(next)) return;
                               setForm({
                                 ...form,
                                 englishCorrection: { ...form.englishCorrection, autoCloseDelay: next },
                               });
                             }}
                             className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                           />
                           <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("optionsEnglishCorrectionAutoCloseDelayDesc")}</p>
                         </div>
                       </div>

                       <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
                         <div className="space-y-1">
                           <div className="text-sm font-bold text-gray-900 dark:text-white">{t("optionsEnglishCorrectionShowUndo")}</div>
                           <div className="text-xs text-gray-500 dark:text-gray-400">{t("optionsEnglishCorrectionShowUndoDesc")}</div>
                         </div>
                         <Switch
                           checked={form.englishCorrection.showUndoButton}
                           onCheckedChange={(checked) =>
                             setForm({
                               ...form,
                               englishCorrection: { ...form.englishCorrection, showUndoButton: checked },
                             })
                           }
                         />
                       </div>
                     </div>
                  </div>

                  <div className="md:col-span-2 bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
                     <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsAppearanceTitle")}</h4>

                     <div className="space-y-5">
                        <div className="space-y-2.5">
                           <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsThemeLabel")}</Label>
                           <Select
                              value={form.theme}
                              onValueChange={(v) =>
                                setForm({ ...form, theme: v as Settings["theme"] })
                              }
                           >
                              <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                 <SelectItem value="system">{t("optionsTheme_system")}</SelectItem>
                                 <SelectItem value="light">{t("optionsTheme_light")}</SelectItem>
                                 <SelectItem value="dark">{t("optionsTheme_dark")}</SelectItem>
                              </SelectContent>
                           </Select>
                        </div>
                        <div className="p-4 rounded-xl bg-indigo-50/30 dark:bg-indigo-500/5 border border-indigo-100/50 dark:border-indigo-500/10">
                          <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed font-medium">
                            {t("optionsThemeHint")}
                          </p>
                        </div>
                     </div>
                  </div>
                </div>
             </TabsContent>

          <TabsContent value="sites" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none">
             <header className="space-y-3">
                <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">{t("optionsTab_sites")}</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">{t("optionsSiteModeDesc")}</p>
             </header>

             <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-8 shadow-sm">
                {(() => {
                  type EnhanceSiteMode = "manual" | "auto_blacklist" | "auto_whitelist";
                  const enhanceSiteMode: EnhanceSiteMode = form.autoEnhance
                    ? form.siteMode === "whitelist"
                      ? "auto_whitelist"
                      : "auto_blacklist"
                    : "manual";

                  return (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5">
                          <div className="space-y-1">
                            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                              {t("optionsEnhanceModeLabel")}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                              {t("optionsEnhanceModeDesc")}
                            </p>
                          </div>
                          <Select
                            value={enhanceSiteMode}
                            onValueChange={(v) => {
                              const next = v as EnhanceSiteMode;
                              if (next === "manual") {
                                setForm({ ...form, autoEnhance: false });
                                return;
                              }
                              if (next === "auto_whitelist") {
                                setForm({ ...form, autoEnhance: true, siteMode: "whitelist" });
                                return;
                              }
                              setForm({ ...form, autoEnhance: true, siteMode: "all" });
                            }}
                          >
                            <SelectTrigger className="w-full sm:w-52 bg-white/70 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                              <SelectItem value="manual">{t("optionsEnhanceModeManual")}</SelectItem>
                              <SelectItem value="auto_blacklist">{t("optionsEnhanceModeAutoBlacklist")}</SelectItem>
                              <SelectItem value="auto_whitelist">{t("optionsEnhanceModeAutoWhitelist")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center justify-between gap-6 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5">
                          <div className="space-y-1">
                            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                              {t("optionsFloatingButtonLabel")}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                              {t("optionsFloatingButtonDesc")}
                            </p>
                          </div>
                          <Switch
                            checked={form.floatingButtonEnabled ?? true}
                            onCheckedChange={(checked) =>
                              setForm({ ...form, floatingButtonEnabled: checked })
                            }
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5">
                        <div className="space-y-1">
                          <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                            {t("optionsWebEnhanceModeLabel")}
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            {t("optionsWebEnhanceModeDesc")}
                          </p>
                        </div>
                        <Select
                          value={form.webEnhanceMode}
                          onValueChange={(v) =>
                            setForm({ ...form, webEnhanceMode: v as Settings["webEnhanceMode"] })
                          }
                        >
                          <SelectTrigger className="w-full sm:w-52 bg-white/70 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                            <SelectItem value="light">{t("optionsWebEnhanceModeLight")}</SelectItem>
                            <SelectItem value="i_plus_1">{t("optionsWebEnhanceModeIPlus1")}</SelectItem>
                            <SelectItem value="full">{t("optionsWebEnhanceModeFull")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {enhanceSiteMode === "manual" ? (
                        <div className="rounded-2xl border border-indigo-100/60 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/10 p-5">
                          <div className="text-sm font-bold text-gray-900 dark:text-white">
                            {t("optionsEnhanceModeManualHintTitle")}
                          </div>
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300/90 font-medium leading-relaxed">
                            {t("optionsEnhanceModeManualHintDesc")}
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2">
                          {enhanceSiteMode === "auto_whitelist" ? (
                            <div className="space-y-4">
                              <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                {t("optionsAllowedSitesLabel")}
                              </Label>
                              <Textarea
                                value={form.allowedSites.join("\n")}
                                onChange={(e) => {
                                  const lines = e.target.value
                                    .split("\n")
                                    .map(normalizeSiteEntry)
                                    .filter(Boolean) as string[];
                                  setForm({ ...form, allowedSites: dedupeStrings(lines) });
                                }}
                                rows={8}
                                className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-indigo-500/30 font-medium transition-all"
                                placeholder={t("optionsSiteEntryPlaceholder")}
                              />
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                                <AlertCircle className="h-4 w-4 text-rose-500" />
                                {t("optionsExcludedSitesLabel")}
                              </Label>
                              <Textarea
                                value={form.excludedSites.join("\n")}
                                onChange={(e) => {
                                  const lines = e.target.value
                                    .split("\n")
                                    .map(normalizeSiteEntry)
                                    .filter(Boolean) as string[];
                                  setForm({ ...form, excludedSites: dedupeStrings(lines) });
                                }}
                                rows={8}
                                className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-rose-500/20 font-medium transition-all"
                                placeholder={t("optionsSiteEntryPlaceholder")}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}

                <div className="h-px bg-gray-100 dark:bg-white/5 my-8" />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5">
                    <div className="space-y-1">
                      <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                        {t("optionsWebShowOriginalLabel")}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                        {t("optionsWebShowOriginalDesc")}
                      </p>
                    </div>
                    <Switch
                      checked={form.webShowOriginal ?? false}
                      onCheckedChange={(checked) => setForm({ ...form, webShowOriginal: checked })}
                      className="data-[state=checked]:bg-indigo-600"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5">
                    <div className="space-y-1">
                      <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                        {t("openOnboarding")}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                        {t("optionsOpenOnboardingDesc")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto h-10 rounded-xl border-gray-200 dark:border-white/10 bg-white/70 dark:bg-black/20 font-bold text-xs"
                      onClick={async () => {
                        await sendMessage("SET_SETTINGS", { hasCompletedOnboarding: false });
                        const url = browser.runtime.getURL("src/ui/onboarding/index.html");
                        globalThis.open?.(url, "_blank");
                      }}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {t("openOnboarding")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                      {t("optionsWebStyleLabel")}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                      {t("optionsWebStyleDesc")}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { key: "within", label: t("optionsWebStyleWithin") },
                      { key: "out", label: t("optionsWebStyleOut") },
                      { key: "forgotten", label: t("optionsWebStyleForgotten") },
                    ].map((item) => (
                      <div key={item.key} className="space-y-2.5">
                        <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                          {item.label}
                        </Label>
                        <Select
                          value={(form.webStyleMapping as any)?.[item.key] ?? "border"}
                          onValueChange={(value) =>
                            setForm({
                              ...form,
                              webStyleMapping: {
                                ...(form.webStyleMapping as any),
                                [item.key]: value,
                              } as any,
                            })
                          }
                        >
                          <SelectTrigger className="bg-white/70 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                            {["border", "dashedLine", "weakened", "background", "textColor"].map((k) => (
                              <SelectItem key={k} value={k}>
                                {t(`optionsWebStyleKey_${k}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                      <Zap className="h-4 w-4 text-indigo-500" />
                      {t("optionsWebCustomCssLabel")}
                    </Label>
                    <Textarea
                      value={form.webCustomCss ?? ""}
                      onChange={(e) => setForm({ ...form, webCustomCss: e.target.value })}
                      rows={6}
                      className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-indigo-500/20 font-medium transition-all"
                      placeholder={t("optionsWebCustomCssPlaceholder")}
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t("optionsWebCustomCssDesc")}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                      {t("optionsScenesLabel")}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                      {t("optionsScenesDesc")}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { key: "webNative", title: t("onboardingSceneWebNativeTitle"), desc: t("onboardingSceneWebNativeDesc") },
                      { key: "webTarget", title: t("onboardingSceneWebTargetTitle"), desc: t("onboardingSceneWebTargetDesc") },
                      { key: "videoNative", title: t("onboardingSceneVideoNativeTitle"), desc: t("onboardingSceneVideoNativeDesc") },
                      { key: "videoTarget", title: t("onboardingSceneVideoTargetTitle"), desc: t("onboardingSceneVideoTargetDesc") },
                    ].map((item) => (
                      <div
                        key={item.key}
                        className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="text-sm font-bold text-gray-900 dark:text-white truncate">
                            {item.title}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            {item.desc}
                          </div>
                        </div>
                        <Switch
                          checked={(form.scenesEnabled as any)?.[item.key] ?? true}
                          onCheckedChange={(checked) =>
                            setForm({
                              ...form,
                              scenesEnabled: {
                                ...(form.scenesEnabled as any),
                                [item.key]: checked,
                              } as any,
                            })
                          }
                          className="data-[state=checked]:bg-indigo-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>
             </div>
          </TabsContent>

          <TabsContent value="backup" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none">
             <header className="space-y-3">
                <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">{t("optionsBackupTitle")}</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">{t("optionsBackupDesc")}</p>
             </header>

             <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-8 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                       <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsExportButton")}</h4>
                       <p className="text-sm text-gray-500 dark:text-gray-400">{t("optionsExportDesc")}</p>
                       <Button 
                         onClick={handleExport}
                         className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl h-11 shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                       >
                        <Download className="h-4 w-4" />
                        {t("optionsExportButton")}
                      </Button>
                   </div>

                    <div className="space-y-4">
                       <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsImportButton")}</h4>
                       <p className="text-sm text-gray-500 dark:text-gray-400">{t("optionsImportDesc")}</p>
                       <div className="relative">
                         <Input
                           type="file"
                           accept=".json"
                          onChange={handleImport}
                          className="absolute inset-0 opacity-0 cursor-pointer z-10"
                        />
                        <Button 
                          className="w-full bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/10 font-bold rounded-xl h-11 flex items-center justify-center gap-2"
                        >
                          <Upload className="h-4 w-4" />
                          {t("optionsImportButton")}
                        </Button>
                      </div>
                   </div>
                </div>

                <div className="h-px bg-gray-100 dark:bg-white/5 my-8" />

                <div className="space-y-6">
                  <header className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsWebDAVCloudSyncTitle")}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("optionsWebDAVDesc")}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest px-2 py-0">{t("optionsPhase2Badge")}</Badge>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsWebDAVUrl")}</Label>
                      <Input 
                        placeholder={t("optionsWebDAVUrlPlaceholder")}
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11"
                        value={form.webdav.url}
                        onChange={e => setForm({ ...form, webdav: { ...form.webdav, url: e.target.value } })}
                      />
                      {errors.webdav?.url && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(errors.webdav.url)}</p>}
                    </div>
                    <div className="space-y-2.5">
                      <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsWebDAVPath")}</Label>
                      <Input 
                        placeholder={t("optionsWebDAVPathPlaceholder")}
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11"
                        value={form.webdav.path}
                        onChange={e => setForm({ ...form, webdav: { ...form.webdav, path: e.target.value } })}
                      />
                    </div>
                    <div className="space-y-2.5">
                      <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsWebDAVUser")}</Label>
                      <Input 
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11"
                        value={form.webdav.username}
                        onChange={e => setForm({ ...form, webdav: { ...form.webdav, username: e.target.value } })}
                      />
                      {errors.webdav?.username && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(errors.webdav.username)}</p>}
                    </div>
                    <div className="space-y-2.5">
                      <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("optionsWebDAVPass")}</Label>
                      <Input 
                        type="password"
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11"
                        value={form.webdav.password}
                        onChange={e => setForm({ ...form, webdav: { ...form.webdav, password: e.target.value } })}
                      />
                      {errors.webdav?.password && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(errors.webdav.password)}</p>}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 h-11 rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 font-bold text-xs"
                      onClick={handleWebDAVUpload}
                      disabled={webdavAction !== null}
                    >
                      {webdavAction === "upload" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                      {t("optionsWebDAVUpload")}
                    </Button>
                    <Button 
                      variant="outline" 
                      className="flex-1 h-11 rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 font-bold text-xs"
                      onClick={handleWebDAVDownload}
                      disabled={webdavAction !== null}
                    >
                      {webdavAction === "download" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                      {t("optionsWebDAVDownload")}
                    </Button>
                  </div>
                </div>
             </div>
          </TabsContent>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-[#0d0e14]/80 backdrop-blur-xl border-t border-gray-200 dark:border-white/5 px-2 pb-safe pt-2 z-50">
          <TabsList className="flex h-auto bg-transparent border-0 p-0">
            {[
              { value: "channels", label: t("optionsTab_channels"), icon: Sparkles },
              { value: "routing", label: t("optionsRoutingTitle"), icon: ChevronRight },
              { value: "language", label: t("optionsTab_language"), icon: Languages },
              { value: "sites", label: t("optionsTab_sites"), icon: AlertCircle },
              { value: "backup", label: t("optionsTab_backup"), icon: Copy },
            ].map((tab) => (
              <TabsTrigger 
                key={tab.value}
                value={tab.value}
                className="flex-1 flex-col gap-1 py-3 rounded-xl data-[state=active]:bg-indigo-600/10 data-[state=active]:text-indigo-600 dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white text-gray-500 dark:text-gray-400 border-0 shadow-none transition-all"
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-[10px] font-black">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.05); border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.1); }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.1); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
}
