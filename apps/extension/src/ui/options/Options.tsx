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
  CardFooter,
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
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Trash2,
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
):
  | { ok: true; value: Record<string, string> | undefined }
  | { ok: false; errorKey: FieldErrorKey } {
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
  const [expandedChannels, setExpandedChannels] = useState<
    Record<number, boolean>
  >({});

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
    <div className="min-h-screen bg-gray-50">
      <Toaster />
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <Card className="border-0 shadow-md">
          <CardHeader className="bg-white border-b">
            <CardTitle className="text-xl">{t("optionsTitle")}</CardTitle>
            <CardDescription>{t("optionsDesc")}</CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            <Tabs defaultValue="channels" className="w-full">
              <TabsList className="w-full justify-start rounded-none border-b bg-white px-6 py-3">
                <TabsTrigger value="channels">
                  {t("optionsTab_channels")}
                </TabsTrigger>
                <TabsTrigger value="routing">
                  {t("optionsRoutingTitle")}
                </TabsTrigger>
                <TabsTrigger value="language">
                  {t("optionsTab_language")}
                </TabsTrigger>
                <TabsTrigger value="sites">{t("optionsTab_sites")}</TabsTrigger>
              </TabsList>

              <TabsContent value="channels" className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {t("optionsChannelsTitle")}
                    </h2>
                    <p className="text-sm text-gray-600">
                      {t("optionsChannelsDesc")}
                    </p>
                  </div>
                  <Button
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

                <div className="space-y-4">
                  {form.channels
                    .slice()
                    .sort((a, b) => a.channelId - b.channelId)
                    .map((channel) => {
                      const channelErrors =
                        errors.channels?.[channel.channelId] ?? {};
                      const isTesting = testingChannelId === channel.channelId;
                      const isExpanded =
                        expandedChannels[channel.channelId] ?? false;

                      const toggleExpanded = () => {
                        setExpandedChannels((prev) => ({
                          ...prev,
                          [channel.channelId]: !prev[channel.channelId],
                        }));
                      };

                      return (
                        <Card
                          key={channel.channelId}
                          className="border border-gray-200 overflow-hidden"
                        >
                          <CardHeader
                            className="pb-3 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                            onClick={toggleExpanded}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="transition-transform duration-300 ease-in-out">
                                    {isExpanded ? (
                                      <ChevronDown className="h-5 w-5 text-gray-500" />
                                    ) : (
                                      <ChevronRight className="h-5 w-5 text-gray-500" />
                                    )}
                                  </div>
                                  <CardTitle className="text-base truncate">
                                    {channel.name || `#${channel.channelId}`}
                                  </CardTitle>
                                  <Badge variant="secondary">
                                    {channelTypeLabel(channel.typeId)}
                                  </Badge>
                                  <Badge variant="outline">
                                    #{channel.channelId}
                                  </Badge>
                                </div>
                                <CardDescription className="mt-1">
                                  {channel.model?.trim()
                                    ? channel.model.trim()
                                    : t("optionsChannelModelUnset")}
                                </CardDescription>
                              </div>

                              <div
                                className="flex items-center gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => testProvider(channel)}
                                  disabled={isTesting}
                                >
                                  {isTesting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                  )}
                                  {t("optionsTestConnection")}
                                </Button>

                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => {
                                    const id = nextChannelId(form.channels);
                                    const copy = {
                                      ...channel,
                                      channelId: id,
                                      name: `${channel.name || defaultChannelName(channel.typeId)}${t("optionsChannelCopySuffix")}`,
                                    };
                                    setForm(
                                      repairRoutes({
                                        ...form,
                                        channels: [...form.channels, copy],
                                      }),
                                    );
                                  }}
                                  title={t("optionsCopyChannel")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => {
                                    if (form.channels.length <= 1) return;
                                    const nextChannels = form.channels.filter(
                                      (ch) =>
                                        ch.channelId !== channel.channelId,
                                    );
                                    setForm(
                                      repairRoutes({
                                        ...form,
                                        channels: nextChannels,
                                      }),
                                    );
                                  }}
                                  disabled={form.channels.length <= 1}
                                  title={t("optionsDeleteChannel")}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </CardHeader>

                          <CardContent
                            className={cn(
                              "space-y-4 transition-all duration-300 ease-in-out overflow-hidden",
                              isExpanded
                                ? "max-h-[5000px] opacity-100"
                                : "max-h-0 opacity-0",
                            )}
                          >
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`channel-${channel.channelId}-name`}
                                >
                                  {t("optionsChannelNameLabel")}
                                </Label>
                                <Input
                                  id={`channel-${channel.channelId}-name`}
                                  value={channel.name}
                                  onChange={(e) => {
                                    const name = e.target.value;
                                    setForm({
                                      ...form,
                                      channels: form.channels.map((ch) =>
                                        ch.channelId === channel.channelId
                                          ? { ...ch, name }
                                          : ch,
                                      ),
                                    });
                                  }}
                                />
                                {channelErrors.name && (
                                  <p className="text-xs text-red-600">
                                    {t(channelErrors.name)}
                                  </p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <Label>{t("optionsChannelTypeLabel")}</Label>
                                <Select
                                  value={String(channel.typeId)}
                                  onValueChange={(value) => {
                                    const parsed =
                                      ChannelTypeIdSchema.safeParse(
                                        Number(value),
                                      );
                                    if (!parsed.success) return;
                                    setForm({
                                      ...form,
                                      channels: form.channels.map((ch) =>
                                        ch.channelId === channel.channelId
                                          ? { ...ch, typeId: parsed.data }
                                          : ch,
                                      ),
                                    });
                                  }}
                                >
                                  <SelectTrigger
                                    data-testid={`channel-type-${channel.channelId}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">
                                      {channelTypeLabel(1)}
                                    </SelectItem>
                                    <SelectItem value="2">
                                      {channelTypeLabel(2)}
                                    </SelectItem>
                                    <SelectItem value="3">
                                      {channelTypeLabel(3)}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`channel-${channel.channelId}-model`}
                                >
                                  {t("optionsProviderModelLabel")}
                                </Label>
                                <Input
                                  id={`channel-${channel.channelId}-model`}
                                  value={channel.model}
                                  onChange={(e) => {
                                    const model = e.target.value;
                                    setForm({
                                      ...form,
                                      channels: form.channels.map((ch) =>
                                        ch.channelId === channel.channelId
                                          ? { ...ch, model }
                                          : ch,
                                      ),
                                    });
                                  }}
                                />
                                {channelErrors.model && (
                                  <p className="text-xs text-red-600">
                                    {t(channelErrors.model)}
                                  </p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`channel-${channel.channelId}-icon`}
                                >
                                  {t("optionsChannelIconUrlLabel")}
                                </Label>
                                <Input
                                  id={`channel-${channel.channelId}-icon`}
                                  value={channel.iconUrl}
                                  onChange={(e) => {
                                    const iconUrl = e.target.value;
                                    setForm({
                                      ...form,
                                      channels: form.channels.map((ch) =>
                                        ch.channelId === channel.channelId
                                          ? { ...ch, iconUrl }
                                          : ch,
                                      ),
                                    });
                                  }}
                                  placeholder={t(
                                    "optionsChannelIconUrlPlaceholder",
                                  )}
                                />
                                {channelErrors.iconUrl && (
                                  <p className="text-xs text-red-600">
                                    {t(channelErrors.iconUrl)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`channel-${channel.channelId}-base-url`}
                                >
                                  {t("optionsProviderBaseUrlLabel")}
                                </Label>
                                <Input
                                  id={`channel-${channel.channelId}-base-url`}
                                  value={channel.baseUrl}
                                  onChange={(e) => {
                                    const baseUrl = e.target.value;
                                    setForm({
                                      ...form,
                                      channels: form.channels.map((ch) =>
                                        ch.channelId === channel.channelId
                                          ? { ...ch, baseUrl }
                                          : ch,
                                      ),
                                    });
                                  }}
                                  placeholder={
                                    channel.typeId === 1
                                      ? t("optionsProviderBaseUrlPlaceholder")
                                      : t(
                                          "optionsProviderBaseUrlOptionalPlaceholder",
                                        )
                                  }
                                />
                                {channelErrors.baseUrl && (
                                  <p className="text-xs text-red-600">
                                    {t(channelErrors.baseUrl)}
                                  </p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`channel-${channel.channelId}-api-key`}
                                >
                                  {t("optionsProviderApiKeyLabel")}
                                </Label>
                                <Input
                                  id={`channel-${channel.channelId}-api-key`}
                                  value={channel.apiKey}
                                  onChange={(e) => {
                                    const apiKey = e.target.value;
                                    setForm({
                                      ...form,
                                      channels: form.channels.map((ch) =>
                                        ch.channelId === channel.channelId
                                          ? { ...ch, apiKey }
                                          : ch,
                                      ),
                                    });
                                  }}
                                  placeholder={
                                    channel.typeId === 1
                                      ? t("optionsProviderApiKeyOptional")
                                      : ""
                                  }
                                />
                                {channelErrors.apiKey && (
                                  <p className="text-xs text-red-600">
                                    {t(channelErrors.apiKey)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label
                                htmlFor={`channel-${channel.channelId}-headers`}
                              >
                                {t("optionsProviderCustomHeadersLabel")}
                              </Label>
                              <Textarea
                                id={`channel-${channel.channelId}-headers`}
                                value={channel.customHeadersText}
                                onChange={(e) => {
                                  const customHeadersText = e.target.value;
                                  setForm({
                                    ...form,
                                    channels: form.channels.map((ch) =>
                                      ch.channelId === channel.channelId
                                        ? { ...ch, customHeadersText }
                                        : ch,
                                    ),
                                  });
                                }}
                                rows={4}
                                placeholder={t(
                                  "optionsProviderCustomHeadersPlaceholder",
                                )}
                              />
                              {channelErrors.customHeadersText && (
                                <p className="text-xs text-red-600">
                                  {t(channelErrors.customHeadersText)}
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              </TabsContent>

              <TabsContent value="routing" className="p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">
                    {t("optionsRoutingTitle")}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {t("optionsRoutingDesc")}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {BEHAVIOR_KEYS.map((key) => {
                    const route = form.behaviorRoutes[key];
                    const allowedKinds = BEHAVIOR_KIND_ALLOWLIST[key];
                    const routeError = errors.routes?.[key];

                    return (
                      <Card key={key} className="border border-gray-200">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">
                            {behaviorLabel(key)}
                          </CardTitle>
                          <CardDescription>{behaviorDesc(key)}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {allowedKinds.length > 1 && (
                            <div className="space-y-2">
                              <Label>{t("optionsRouteKindLabel")}</Label>
                              <Select
                                value={String(route.kind)}
                                onValueChange={(value) => {
                                  const parsed = RouteKindSchema.safeParse(
                                    Number(value),
                                  );
                                  if (!parsed.success) return;
                                  setForm(
                                    repairRoutes({
                                      ...form,
                                      behaviorRoutes: {
                                        ...form.behaviorRoutes,
                                        [key]: {
                                          ...route,
                                          kind: parsed.data,
                                          channelId:
                                            parsed.data === 1
                                              ? (route.channelId ??
                                                firstAvailableChannelId(
                                                  form.channels,
                                                ))
                                              : null,
                                        },
                                      },
                                    }),
                                  );
                                }}
                              >
                                <SelectTrigger
                                  data-testid={`route-kind-${key}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {routeKindOptions(allowedKinds)}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {(allowedKinds.length === 1 || route.kind === 1) && (
                            <div className="space-y-2">
                              <Label>{t("optionsRouteChannelLabel")}</Label>
                              <Select
                                value={
                                  route.channelId ? String(route.channelId) : ""
                                }
                                onValueChange={(value) => {
                                  const id = Number(value);
                                  setForm(
                                    repairRoutes({
                                      ...form,
                                      behaviorRoutes: {
                                        ...form.behaviorRoutes,
                                        [key]: {
                                          ...route,
                                          kind: 1,
                                          channelId: Number.isFinite(id)
                                            ? id
                                            : null,
                                        },
                                      },
                                    }),
                                  );
                                }}
                              >
                                <SelectTrigger
                                  data-testid={`route-channel-${key}`}
                                >
                                  <SelectValue
                                    placeholder={t(
                                      "optionsRouteChannelPlaceholder",
                                    )}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {channelOptions.map((opt) => (
                                    <SelectItem
                                      key={opt.value}
                                      value={opt.value}
                                    >
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {routeError && (
                            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                              <AlertCircle className="h-4 w-4 mt-0.5" />
                              <div>{t(routeError)}</div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={testGoogleTranslate}>
                    {t("optionsTestGoogleTranslate")}
                  </Button>
                  <Button variant="outline" onClick={testBingTranslate}>
                    {t("optionsTestBingTranslate")}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="language" className="p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">
                    {t("optionsLanguageTitle")}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {t("optionsLanguageDesc")}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>{t("nativeLanguage")}</Label>
                    <Select
                      value={form.nativeLanguage}
                      onValueChange={(value) =>
                        setForm({ ...form, nativeLanguage: value as any })
                      }
                    >
                      <SelectTrigger data-testid="native-language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh-CN">zh-CN</SelectItem>
                        <SelectItem value="zh-TW">zh-TW</SelectItem>
                        <SelectItem value="en">en</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("targetLanguage")}</Label>
                    <Select
                      value={form.targetLanguage}
                      onValueChange={(value) => {
                        const parsed = SupportedLanguageSchema.safeParse(value);
                        if (!parsed.success) return;
                        setForm({ ...form, targetLanguage: parsed.data });
                      }}
                    >
                      <SelectTrigger data-testid="target-language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SupportedLanguageSchema.options.map((lang) => (
                          <SelectItem key={lang} value={lang}>
                            {t(`languageTarget_${lang}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("proficiencyLevel")}</Label>
                    <Select
                      value={form.proficiencyLevel}
                      onValueChange={(value) => {
                        const parsed = CEFRLevelSchema.safeParse(value);
                        if (!parsed.success) return;
                        setForm({ ...form, proficiencyLevel: parsed.data });
                      }}
                    >
                      <SelectTrigger data-testid="proficiency-level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CEFRLevelSchema.options.map((lvl) => (
                          <SelectItem key={lvl} value={lvl}>
                            {t(`proficiency_${lvl}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="sites" className="p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">
                    {t("optionsSitesTitle")}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {t("optionsSiteModeDesc")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>{t("optionsSiteModeLabel")}</Label>
                  <Select
                    value={form.siteMode}
                    onValueChange={(value) =>
                      setForm({ ...form, siteMode: value as SiteMode })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("optionsSiteModeAll")}
                      </SelectItem>
                      <SelectItem value="whitelist">
                        {t("optionsSiteModeWhitelist")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("optionsAllowedSitesLabel")}</Label>
                    <Textarea
                      value={form.allowedSites.join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split("\n")
                          .map(normalizeSiteEntry)
                          .filter(Boolean) as string[];
                        setForm({
                          ...form,
                          allowedSites: dedupeStrings(lines),
                        });
                      }}
                      rows={6}
                      placeholder={t("optionsSiteEntryPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("optionsExcludedSitesLabel")}</Label>
                    <Textarea
                      value={form.excludedSites.join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split("\n")
                          .map(normalizeSiteEntry)
                          .filter(Boolean) as string[];
                        setForm({
                          ...form,
                          excludedSites: dedupeStrings(lines),
                        });
                      }}
                      rows={6}
                      placeholder={t("optionsSiteEntryPlaceholder")}
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>

          <CardFooter className="flex items-center justify-between gap-3 border-t bg-white px-6 py-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Badge
                className={cn(form.enabled ? "bg-emerald-500" : "bg-gray-300")}
              >
                {form.enabled ? t("on") : t("off")}
              </Badge>
              <span>{t("optionsEnabledHint")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setForm(
                    settingsToFormState(settings ?? SettingsSchema.parse({})),
                  )
                }
                disabled={saving}
              >
                {t("optionsResetButton")}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {t("optionsSaveButton")}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
