import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import { z } from "zod";
import {
  CEFRLevelSchema,
  ChannelTypeIdSchema,
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  ProviderConfigSchema,
  RouteKindSchema,
  SettingsSchema,
  SupportedLanguageSchema,
  type CEFRLevel,
  type ChannelTypeId,
  type ProviderChannel,
  type RouteKind,
  type Settings,
  type TestProviderConnectionPayload,
} from "@lexipath/core";
import { sendMessage } from "../../shared/messages";

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
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  Languages,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";

type SiteMode = "all" | "whitelist";

type BehaviorKey =
  | "select_keywords"
  | "translate"
  | "dictionary"
  | "enhance_web"
  | "enhance_subtitle"
  | "chat"
  | "explain_word";

const BEHAVIOR_KEYS: BehaviorKey[] = [
  "select_keywords",
  "translate",
  "dictionary",
  "enhance_web",
  "enhance_subtitle",
  "chat",
  "explain_word",
];

const BEHAVIOR_KIND_ALLOWLIST: Record<BehaviorKey, RouteKind[]> = {
  select_keywords: [1],
  translate: [1, 2, 3],
  dictionary: [1, 2, 3],
  enhance_web: [1],
  enhance_subtitle: [1],
  chat: [1],
  explain_word: [1],
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
};

type FormState = {
  channels: ChannelFormState[];
  behaviorRoutes: Record<BehaviorKey, RouteFormState>;
  nativeLanguage: Settings["nativeLanguage"];
  targetLanguage: Settings["targetLanguage"];
  proficiencyLevel: CEFRLevel;
  enabled: boolean;
  autoEnhance: boolean;
  siteMode: SiteMode;
  excludedSites: string[];
  allowedSites: string[];
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
  | "optionsRouteChannelNotConfigured";

type ChannelFieldErrors = Partial<{
  name: FieldErrorKey;
  baseUrl: FieldErrorKey;
  model: FieldErrorKey;
  apiKey: FieldErrorKey;
  customHeadersText: FieldErrorKey;
  iconUrl: FieldErrorKey;
}>;

type FieldErrors = Partial<{
  channels: Record<number, ChannelFieldErrors>;
  routes: Partial<Record<BehaviorKey, FieldErrorKey>>;
}>;

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
  } catch {
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

  return {
    channels,
    behaviorRoutes: ensureBehaviorRoutesComplete(settings),
    nativeLanguage: settings.nativeLanguage,
    targetLanguage: settings.targetLanguage,
    proficiencyLevel: settings.proficiencyLevel,
    enabled: settings.enabled,
    autoEnhance: settings.autoEnhance,
    siteMode: settings.siteMode,
    excludedSites: settings.excludedSites,
    allowedSites: settings.allowedSites,
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
  } catch {
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
    if (!baseUrl) errors.baseUrl = "optionsProviderBaseUrlRequired";
    else if (!z.string().url().safeParse(baseUrl).success)
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
    if (channel.typeId === 1) {
      return ProviderConfigSchema.safeParse({
        baseUrl: String(config.baseUrl ?? ""),
        model,
        ...(typeof config.apiKey === "string" && config.apiKey
          ? { apiKey: config.apiKey }
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
        ...(typeof config.baseUrl === "string" && config.baseUrl
          ? { baseUrl: config.baseUrl }
          : {}),
        ...(config.customHeaders
          ? { customHeaders: config.customHeaders }
          : {}),
      });
    }
    return GeminiProviderConfigSchema.safeParse({
      model,
      apiKey: String(config.apiKey ?? ""),
      ...(typeof config.baseUrl === "string" && config.baseUrl
        ? { baseUrl: config.baseUrl }
        : {}),
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
    enabled: form.enabled,
    autoEnhance: form.autoEnhance,
    siteMode: form.siteMode,
    excludedSites: form.excludedSites,
    allowedSites: form.allowedSites,
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
    } catch {
      // ignore
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null);
  const [expandedChannels, setExpandedChannels] = useState<Record<number, boolean>>({});

  useEffect(() => {
    async function load() {
      const response = await sendMessage("GET_SETTINGS", undefined);
      if (!response.ok) {
        console.error("[LexiPath] Failed to load settings:", response.error);
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
                <img src="../../icons/icon.svg" className="h-6 w-6" alt={t("extensionName")} />
              </div>
            </div>
            <h1 className="font-black text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-white/70">
              {t("extensionName")}
            </h1>
          </div>

          <TabsList className="flex flex-row lg:flex-col h-auto bg-transparent border-0 space-x-1 lg:space-x-0 lg:space-y-1.5 p-0 overflow-x-auto lg:overflow-x-visible no-scrollbar">
            {[
              { value: "channels", label: t("optionsTab_channels"), icon: Sparkles },
              { value: "routing", label: t("optionsRoutingTitle"), icon: ChevronRight },
              { value: "language", label: t("optionsTab_language"), icon: Languages },
              { value: "sites", label: t("optionsTab_sites"), icon: AlertCircle },
            ].map((tab) => (
              <TabsTrigger 
                key={tab.value}
                value={tab.value}
                className="flex-1 lg:flex-none justify-center lg:justify-start gap-2.5 px-4 py-3 rounded-xl data-[state=active]:bg-indigo-600 dark:data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-all border-0 shadow-none"
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
        <div className="flex-1 flex flex-col p-5 md:p-8 lg:p-12 xl:p-16 max-w-5xl mx-auto w-full overflow-y-auto h-screen custom-scrollbar relative">
          <div className="lg:hidden flex justify-end mb-6">
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
                                      placeholder="https://api.openai.com/v1"
                                   />
                                   {channelErrors.baseUrl && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(channelErrors.baseUrl)}</p>}
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

             <div className="grid gap-4">
                {BEHAVIOR_KEYS.map((key) => {
                  const route = form.behaviorRoutes[key];
                  const allowedKinds = BEHAVIOR_KIND_ALLOWLIST[key];
                  const routeError = errors.routes?.[key];

                  return (
                    <div key={key} className="relative bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all hover:shadow-md">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-indigo-50 dark:bg-white/5 border border-indigo-100 dark:border-white/5 flex items-center justify-center shadow-sm">
                          <Zap className="h-6 w-6 text-indigo-500 dark:text-indigo-400" />
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 dark:text-white text-base">{behaviorLabel(key)}</h4>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mt-1">{t("optionsRoutingDesc").split(".")[0]}</p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <Select
                            value={String(route.kind)}
                            onValueChange={v => {
                              const kind = Number(v) as RouteKind;
                              setForm({
                                ...form,
                                behaviorRoutes: {
                                  ...form.behaviorRoutes,
                                  [key]: { ...route, kind, channelId: kind === 1 ? (form.channels[0]?.channelId ?? null) : null }
                                }
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
                              {routeKindOptions(allowedKinds)}
                            </SelectContent>
                          </Select>

                          {route.kind === 1 && (
                            <Select
                              value={route.channelId === null ? "null" : String(route.channelId)}
                              onValueChange={v => setForm({
                                ...form,
                                behaviorRoutes: {
                                  ...form.behaviorRoutes,
                                  [key]: { ...route, channelId: v === "null" ? null : Number(v) }
                                }
                              })}
                            >
                              <SelectTrigger className="w-48 bg-indigo-50/50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl h-10 font-bold text-xs">
                                <SelectValue placeholder={t("optionsRouteChannelPlaceholder")} />
                              </SelectTrigger>
                              <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                {form.channels.map(ch => (
                                  <SelectItem key={ch.channelId} value={String(ch.channelId)}>{ch.name || `#${ch.channelId}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        {routeError && <p className="text-[10px] text-rose-500 font-bold ml-1">{t(routeError)}</p>}
                      </div>
                    </div>
                  );
                })}
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
                         <Select value={form.nativeLanguage} onValueChange={v => setForm({...form, nativeLanguage: v as any})}>
                            <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                               <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                               {SupportedLanguageSchema.options.map(lang => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
                            </SelectContent>
                         </Select>
                      </div>
                      
                      <div className="space-y-2.5">
                         <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("targetLanguage")}</Label>
                         <Select value={form.targetLanguage} onValueChange={v => setForm({...form, targetLanguage: v as any})}>
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
                         <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">{t("proficiencyLevel")}</Label>
                         <Select value={form.proficiencyLevel} onValueChange={v => setForm({...form, proficiencyLevel: v as CEFRLevel})}>
                            <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                               <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                               {CEFRLevelSchema.options.map(level => <SelectItem key={level} value={level}>{t(`proficiency_${level}`)}</SelectItem>)}
                            </SelectContent>
                         </Select>
                      </div>
                      <div className="p-4 rounded-xl bg-indigo-50/30 dark:bg-indigo-500/5 border border-indigo-100/50 dark:border-indigo-500/10">
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed font-medium">
                          {t("optionsProficiencyHint") || "Adjusting this will change which words are highlighted. Higher levels show fewer, more advanced words."}
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                   <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">{t("optionsSiteModeLabel")}</h4>
                   <Select value={form.siteMode} onValueChange={v => setForm({...form, siteMode: v as SiteMode})}>
                      <SelectTrigger className="w-full sm:w-48 bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs">
                         <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                         <SelectItem value="all">{t("optionsSiteModeAll")}</SelectItem>
                         <SelectItem value="whitelist">{t("optionsSiteModeWhitelist")}</SelectItem>
                      </SelectContent>
                   </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                   <div className="space-y-4">
                      <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                         <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                         {t("optionsAllowedSitesLabel")}
                      </Label>
                      <Textarea 
                        value={form.allowedSites.join("\n")}
                        onChange={e => {
                           const lines = e.target.value.split("\n").map(normalizeSiteEntry).filter(Boolean) as string[];
                           setForm({...form, allowedSites: dedupeStrings(lines)});
                        }}
                        rows={8}
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-indigo-500/30 font-medium transition-all"
                        placeholder="example.com"
                      />
                   </div>
                   <div className="space-y-4">
                      <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                         <AlertCircle className="h-4 w-4 text-rose-500" />
                         {t("optionsExcludedSitesLabel")}
                      </Label>
                      <Textarea 
                        value={form.excludedSites.join("\n")}
                        onChange={e => {
                           const lines = e.target.value.split("\n").map(normalizeSiteEntry).filter(Boolean) as string[];
                           setForm({...form, excludedSites: dedupeStrings(lines)});
                        }}
                        rows={8}
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-rose-500/20 font-medium transition-all"
                        placeholder="google.com"
                      />
                   </div>
                </div>
             </div>
          </TabsContent>
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