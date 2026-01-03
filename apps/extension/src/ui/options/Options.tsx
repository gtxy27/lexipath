import React, { useEffect, useMemo, useState } from 'react';
import browser from 'webextension-polyfill';
import { z } from 'zod';
import {
  CEFRLevelSchema,
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  LLMProviderChannelSchema,
  NativeLanguageSchema,
  ProviderConfigSchema,
  SettingsSchema,
  SupportedLanguageSchema,
  TranslationProviderSchema,
  type ClaudeProviderConfig,
  type GeminiProviderConfig,
  type LLMProviderChannel,
  type ProviderConfig,
  type Settings,
  type TestProviderConnectionPayload,
  type TranslationProvider,
} from '@lexipath/core';
import { sendMessage } from '../../shared/messages';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Toaster } from '../components/ui/toaster';
import { useToast } from '../components/ui/use-toast';
import { Loader2, Plus, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

// --- Types ---

type SiteMode = 'all' | 'whitelist';

type ChannelFormState = {
  baseUrl: string;
  model: string;
  apiKey: string;
  customHeadersText: string;
};

type ConcurrencyFormState = {
  openai: string;
  claude: string;
  gemini: string;
  google: string;
  bing: string;
};

type FormState = {
  channels: {
    openai: ChannelFormState;
    claude: ChannelFormState;
    gemini: ChannelFormState;
  };
  keywordProvider: LLMProviderChannel;
  translationProvider: TranslationProvider;
  channelConcurrencyLimits: ConcurrencyFormState;
  nativeLanguage: Settings['nativeLanguage'];
  targetLanguage: Settings['targetLanguage'];
  proficiencyLevel: Settings['proficiencyLevel'];
  siteMode: SiteMode;
  excludedSites: string[];
  allowedSites: string[];
};

type FieldErrorKey =
  | 'optionsProviderBaseUrlRequired'
  | 'optionsProviderBaseUrlInvalid'
  | 'optionsProviderModelRequired'
  | 'optionsProviderApiKeyRequired'
  | 'optionsProviderCustomHeadersInvalidJson'
  | 'optionsProviderCustomHeadersInvalidFormat'
  | 'optionsConcurrencyInvalidNumber'
  | 'optionsKeywordProviderNotConfigured'
  | 'optionsTranslationProviderNotConfigured';

type ChannelFieldErrors = Partial<{
  baseUrl: FieldErrorKey;
  model: FieldErrorKey;
  apiKey: FieldErrorKey;
  customHeadersText: FieldErrorKey;
}>;

type FieldErrors = Partial<{
  openai: ChannelFieldErrors;
  claude: ChannelFieldErrors;
  gemini: ChannelFieldErrors;
  keywordProvider: FieldErrorKey;
  translationProvider: FieldErrorKey;
  concurrency: Partial<Record<TranslationProvider, FieldErrorKey>>;
}>;

function t(key: string, substitutions?: string | string[]): string {
  const message = browser.i18n.getMessage(key, substitutions);
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

function settingsToFormState(settings: Settings): FormState {
  const openai = settings.channels.openai;
  const claude = settings.channels.claude;
  const gemini = settings.channels.gemini;
  return {
    channels: {
      openai: {
        baseUrl: openai?.baseUrl ?? '',
        model: openai?.model ?? '',
        apiKey: openai?.apiKey ?? '',
        customHeadersText: openai?.customHeaders
          ? JSON.stringify(openai.customHeaders, null, 2)
          : '',
      },
      claude: {
        baseUrl: claude?.baseUrl ?? '',
        model: claude?.model ?? '',
        apiKey: claude?.apiKey ?? '',
        customHeadersText: claude?.customHeaders
          ? JSON.stringify(claude.customHeaders, null, 2)
          : '',
      },
      gemini: {
        baseUrl: gemini?.baseUrl ?? '',
        model: gemini?.model ?? '',
        apiKey: gemini?.apiKey ?? '',
        customHeadersText: gemini?.customHeaders
          ? JSON.stringify(gemini.customHeaders, null, 2)
          : '',
      },
    },
    keywordProvider: settings.keywordProvider,
    translationProvider: settings.translationProvider,
    channelConcurrencyLimits: {
      openai: settings.channelConcurrencyLimits.openai
        ? String(settings.channelConcurrencyLimits.openai)
        : '',
      claude: settings.channelConcurrencyLimits.claude
        ? String(settings.channelConcurrencyLimits.claude)
        : '',
      gemini: settings.channelConcurrencyLimits.gemini
        ? String(settings.channelConcurrencyLimits.gemini)
        : '',
      google: settings.channelConcurrencyLimits.google
        ? String(settings.channelConcurrencyLimits.google)
        : '',
      bing: settings.channelConcurrencyLimits.bing
        ? String(settings.channelConcurrencyLimits.bing)
        : '',
    },
    nativeLanguage: settings.nativeLanguage,
    targetLanguage: settings.targetLanguage,
    proficiencyLevel: settings.proficiencyLevel,
    siteMode: settings.siteMode,
    excludedSites: settings.excludedSites,
    allowedSites: settings.allowedSites,
  };
}

function parseCustomHeaders(
  rawText: string
): { ok: true; value: Record<string, string> | undefined } | { ok: false; errorKey: FieldErrorKey } {
  const text = rawText.trim();
  if (!text) return { ok: true, value: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errorKey: 'optionsProviderCustomHeadersInvalidJson' };
  }

  const result = z.record(z.string()).safeParse(parsed);
  if (!result.success) {
    return { ok: false, errorKey: 'optionsProviderCustomHeadersInvalidFormat' };
  }
  return { ok: true, value: result.data };
}

function parseConcurrencyLimit(
  rawText: string
): { ok: true; value: number | undefined } | { ok: false; errorKey: FieldErrorKey } {
  const text = rawText.trim();
  if (!text) return { ok: true, value: undefined };

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    return { ok: false, errorKey: 'optionsConcurrencyInvalidNumber' };
  }
  return { ok: true, value: parsed };
}

function hasAnyChannelInput(form: ChannelFormState): boolean {
  return Boolean(
    form.baseUrl.trim() ||
      form.model.trim() ||
      form.apiKey.trim() ||
      form.customHeadersText.trim()
  );
}

// --- Config Builders ---

function buildOpenAIConfig(
  form: ChannelFormState,
  required: boolean
): { ok: true; config: ProviderConfig | undefined } | { ok: false; errors: ChannelFieldErrors } {
  const errors: ChannelFieldErrors = {};
  const hasInput = hasAnyChannelInput(form);
  if (!required && !hasInput) return { ok: true, config: undefined };

  const baseUrl = form.baseUrl.trim();
  if (!baseUrl) {
    errors.baseUrl = 'optionsProviderBaseUrlRequired';
  } else if (!z.string().url().safeParse(baseUrl).success) {
    errors.baseUrl = 'optionsProviderBaseUrlInvalid';
  }

  const model = form.model.trim();
  if (!model) {
    errors.model = 'optionsProviderModelRequired';
  }

  const customHeadersResult = parseCustomHeaders(form.customHeadersText);
  if (!customHeadersResult.ok) {
    errors.customHeadersText = customHeadersResult.errorKey;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const candidate: ProviderConfig = {
    baseUrl,
    model,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    ...(customHeadersResult.ok && customHeadersResult.value
      ? { customHeaders: customHeadersResult.value }
      : {}),
  };

  const parsed = ProviderConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: { baseUrl: 'optionsProviderBaseUrlInvalid' } };
  }

  return { ok: true, config: parsed.data };
}

function buildClaudeConfig(
  form: ChannelFormState,
  required: boolean
): { ok: true; config: ClaudeProviderConfig | undefined } | { ok: false; errors: ChannelFieldErrors } {
  const errors: ChannelFieldErrors = {};
  const hasInput = hasAnyChannelInput(form);
  if (!required && !hasInput) return { ok: true, config: undefined };

  const model = form.model.trim();
  if (!model) errors.model = 'optionsProviderModelRequired';

  const apiKey = form.apiKey.trim();
  if (!apiKey) errors.apiKey = 'optionsProviderApiKeyRequired';

  const baseUrl = form.baseUrl.trim();
  if (baseUrl && !z.string().url().safeParse(baseUrl).success) {
    errors.baseUrl = 'optionsProviderBaseUrlInvalid';
  }

  const customHeadersResult = parseCustomHeaders(form.customHeadersText);
  if (!customHeadersResult.ok) {
    errors.customHeadersText = customHeadersResult.errorKey;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const candidate: ClaudeProviderConfig = {
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(customHeadersResult.ok && customHeadersResult.value
      ? { customHeaders: customHeadersResult.value }
      : {}),
  };

  const parsed = ClaudeProviderConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: {} };
  }

  return { ok: true, config: parsed.data };
}

function buildGeminiConfig(
  form: ChannelFormState,
  required: boolean
): { ok: true; config: GeminiProviderConfig | undefined } | { ok: false; errors: ChannelFieldErrors } {
  const errors: ChannelFieldErrors = {};
  const hasInput = hasAnyChannelInput(form);
  if (!required && !hasInput) return { ok: true, config: undefined };

  const model = form.model.trim();
  if (!model) errors.model = 'optionsProviderModelRequired';

  const apiKey = form.apiKey.trim();
  if (!apiKey) errors.apiKey = 'optionsProviderApiKeyRequired';

  const baseUrl = form.baseUrl.trim();
  if (baseUrl && !z.string().url().safeParse(baseUrl).success) {
    errors.baseUrl = 'optionsProviderBaseUrlInvalid';
  }

  const customHeadersResult = parseCustomHeaders(form.customHeadersText);
  if (!customHeadersResult.ok) {
    errors.customHeadersText = customHeadersResult.errorKey;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const candidate: GeminiProviderConfig = {
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(customHeadersResult.ok && customHeadersResult.value
      ? { customHeaders: customHeadersResult.value }
      : {}),
  };

  const parsed = GeminiProviderConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: {} };
  }

  return { ok: true, config: parsed.data };
}

function buildSettingsPatch(form: FormState): {
  ok: true;
  patch: Partial<Settings>;
  errors: FieldErrors;
} | {
  ok: false;
  patch?: undefined;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};

  const requiredLLM = new Set<LLMProviderChannel>();
  requiredLLM.add(form.keywordProvider);
  const translationLLM = LLMProviderChannelSchema.safeParse(form.translationProvider);
  if (translationLLM.success) {
    requiredLLM.add(translationLLM.data);
  }

  const openaiResult = buildOpenAIConfig(form.channels.openai, requiredLLM.has('openai'));
  if (!openaiResult.ok) errors.openai = openaiResult.errors;

  const claudeResult = buildClaudeConfig(form.channels.claude, requiredLLM.has('claude'));
  if (!claudeResult.ok) errors.claude = claudeResult.errors;

  const geminiResult = buildGeminiConfig(form.channels.gemini, requiredLLM.has('gemini'));
  if (!geminiResult.ok) errors.gemini = geminiResult.errors;

  if (requiredLLM.has(form.keywordProvider)) {
    const configured = (() => {
      switch (form.keywordProvider) {
        case 'openai':
          return openaiResult.ok && Boolean(openaiResult.config);
        case 'claude':
          return claudeResult.ok && Boolean(claudeResult.config);
        case 'gemini':
          return geminiResult.ok && Boolean(geminiResult.config);
      }
    })();
    if (!configured) errors.keywordProvider = 'optionsKeywordProviderNotConfigured';
  }

  if (translationLLM.success) {
    const configured = (() => {
      switch (translationLLM.data) {
        case 'openai':
          return openaiResult.ok && Boolean(openaiResult.config);
        case 'claude':
          return claudeResult.ok && Boolean(claudeResult.config);
        case 'gemini':
          return geminiResult.ok && Boolean(geminiResult.config);
      }
    })();
    if (!configured) errors.translationProvider = 'optionsTranslationProviderNotConfigured';
  }

  const concurrencyErrors: Partial<Record<TranslationProvider, FieldErrorKey>> = {};
  const concurrency: Partial<Record<TranslationProvider, number>> = {};
  (TranslationProviderSchema.options as TranslationProvider[]).forEach((channel) => {
    const parsed = parseConcurrencyLimit(form.channelConcurrencyLimits[channel]);
    if (!parsed.ok) {
      concurrencyErrors[channel] = parsed.errorKey;
      return;
    }
    if (typeof parsed.value === 'number') {
      concurrency[channel] = parsed.value;
    }
  });
  if (Object.keys(concurrencyErrors).length > 0) {
    errors.concurrency = concurrencyErrors;
  }

  const excludedSites = dedupeStrings(
    form.excludedSites
      .map(normalizeSiteEntry)
      .filter((value): value is string => value !== null)
  );
  const allowedSites = dedupeStrings(
    form.allowedSites
      .map(normalizeSiteEntry)
      .filter((value): value is string => value !== null)
  );

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const channels: Settings['channels'] = {};
  if (openaiResult.ok && openaiResult.config) channels.openai = openaiResult.config;
  if (claudeResult.ok && claudeResult.config) channels.claude = claudeResult.config;
  if (geminiResult.ok && geminiResult.config) channels.gemini = geminiResult.config;

  const patch: Partial<Settings> = {
    channels,
    keywordProvider: form.keywordProvider,
    translationProvider: form.translationProvider,
    channelConcurrencyLimits: concurrency,
    nativeLanguage: form.nativeLanguage,
    targetLanguage: form.targetLanguage,
    proficiencyLevel: form.proficiencyLevel,
    siteMode: form.siteMode,
    excludedSites,
    allowedSites,
  };

  const patchParsed = SettingsSchema.partial().strict().safeParse(patch);
  if (!patchParsed.success) {
    return { ok: false, errors: {} };
  }

  return { ok: true, patch, errors: {} };
}

// --- Internal Components ---

function ListEditor(props: {
  titleKey: string;
  descriptionKey?: string;
  placeholderKey: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function addItem() {
    const normalized = normalizeSiteEntry(draft);
    if (!normalized) return;
    const next = dedupeStrings([...props.items, normalized]);
    props.onChange(next);
    setDraft('');
  }

  function removeItem(item: string) {
    props.onChange(props.items.filter((existing) => existing !== item));
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>{t(props.titleKey)}</Label>
        {props.descriptionKey ? (
          <p className="text-sm text-muted-foreground">{t(props.descriptionKey)}</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t(props.placeholderKey)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addItem();
            }
          }}
        />
        <Button onClick={addItem} size="icon" variant="outline">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="h-24 w-full rounded-md border p-4">
        {props.items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {props.items.map((item) => (
              <Badge key={item} variant="secondary" className="pl-2 pr-1 py-1 flex items-center gap-1">
                {item}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 rounded-full p-0 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => removeItem(item)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('optionsListEmpty')}</p>
        )}
      </ScrollArea>
    </div>
  );
}

// --- Main Options Component ---

export function Options(): React.ReactNode {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  // Options Data
  const nativeLanguageOptions = useMemo(
    () =>
      NativeLanguageSchema.options.map((value) => ({
        value,
        labelKey: `languageNative_${value.replace('-', '_')}`,
      })),
    []
  );
  const targetLanguageOptions = useMemo(
    () =>
      SupportedLanguageSchema.options.map((value) => ({
        value,
        labelKey: `languageTarget_${value}`,
      })),
    []
  );
  const proficiencyOptions = useMemo(
    () =>
      CEFRLevelSchema.options.map((value) => ({
        value,
        labelKey: `proficiency_${value}`,
      })),
    []
  );

  const providerChannelOptions = useMemo(
    () =>
      LLMProviderChannelSchema.options.map((value) => ({
        value,
        labelKey: `providerChannel_${value}`,
      })),
    []
  );

  const translationProviderOptions = useMemo(
    () =>
      TranslationProviderSchema.options.map((value) => ({
        value,
        labelKey: `translationProvider_${value}`,
      })),
    []
  );

  const requiredLLM = useMemo(() => {
    if (!form) return new Set<LLMProviderChannel>();
    const required = new Set<LLMProviderChannel>([form.keywordProvider]);
    if (LLMProviderChannelSchema.safeParse(form.translationProvider).success) {
      required.add(form.translationProvider as LLMProviderChannel);
    }
    return required;
  }, [form]);

  useEffect(() => {
    async function loadSettings() {
      const response = await sendMessage('GET_SETTINGS', undefined);
      if (response.ok) {
        setSettings(response.value);
        setForm(settingsToFormState(response.value));
      } else {
        console.error('[LexiPath] Failed to get settings:', response.error);
        toast({
          variant: "destructive",
          title: t('optionsLoadError'),
          description: response.error.message
        });
      }
      setLoading(false);
    }
    loadSettings();
  }, [toast]);

  function updateChannel(channel: keyof FormState['channels'], patch: Partial<ChannelFormState>) {
    if (!form) return;
    setForm({
      ...form,
      channels: {
        ...form.channels,
        [channel]: { ...form.channels[channel], ...patch },
      },
    });
  }

  function updateConcurrency(channel: keyof ConcurrencyFormState, value: string) {
    if (!form) return;
    setForm({
      ...form,
      channelConcurrencyLimits: { ...form.channelConcurrencyLimits, [channel]: value },
    });
  }

  async function testProviderConnection(payload: TestProviderConnectionPayload) {
    setTesting(true);
    try {
      const response = await sendMessage('TEST_PROVIDER_CONNECTION', payload);

      if (response.ok) {
        toast({
          title: t('optionsProviderTestSuccess'),
          className: "bg-green-100 border-green-200 text-green-900"
        });
        return;
      }

      if (response.error.code === 'PERMISSION_DENIED') {
        toast({ variant: "destructive", title: t('optionsPermissionDenied') });
        return;
      }
      if (response.error.code === 'PERMISSION_REQUEST_FAILED') {
        toast({ variant: "destructive", title: t('optionsPermissionRequestFailed') });
        return;
      }

      const providerErrorKey = `providerError_${response.error.code}`;
      const providerErrorText = t(providerErrorKey);
      const substitution =
        providerErrorText !== providerErrorKey
          ? providerErrorText
          : response.error.message || t('optionsProviderTestFailedUnknown');

      toast({
        variant: "destructive",
        title: t('optionsProviderTestFailed'),
        description: substitution
      });
    } finally {
      setTesting(false);
    }
  }

  async function testChannel(channel: TranslationProvider) {
    if (!form) return;
    
    const channelErrors: FieldErrors = {};
    const payload = (() => {
      switch (channel) {
        case 'openai': {
          const result = buildOpenAIConfig(form.channels.openai, true);
          if (!result.ok || !result.config) {
            channelErrors.openai = result.ok ? { baseUrl: 'optionsProviderBaseUrlRequired' } : result.errors;
            return null;
          }
          return { type: 'openai', config: result.config } satisfies TestProviderConnectionPayload;
        }
        case 'claude': {
          const result = buildClaudeConfig(form.channels.claude, true);
          if (!result.ok || !result.config) {
            channelErrors.claude = result.ok ? { apiKey: 'optionsProviderApiKeyRequired' } : result.errors;
            return null;
          }
          return { type: 'claude', config: result.config } satisfies TestProviderConnectionPayload;
        }
        case 'gemini': {
          const result = buildGeminiConfig(form.channels.gemini, true);
          if (!result.ok || !result.config) {
            channelErrors.gemini = result.ok ? { apiKey: 'optionsProviderApiKeyRequired' } : result.errors;
            return null;
          }
          return { type: 'gemini', config: result.config } satisfies TestProviderConnectionPayload;
        }
        case 'google':
          return { type: 'google' } satisfies TestProviderConnectionPayload;
        case 'bing':
          return { type: 'bing' } satisfies TestProviderConnectionPayload;
      }
    })();

    if (!payload) {
      setFieldErrors(channelErrors);
      toast({ variant: "destructive", title: t('optionsValidationError') });
      return;
    }

    setFieldErrors({});
    await testProviderConnection(payload);
  }

  async function save() {
    if (!form) return;

    const result = buildSettingsPatch(form);
    setFieldErrors(result.errors);
    if (!result.ok) {
      toast({ variant: "destructive", title: t('optionsValidationError') });
      return;
    }

    setSaving(true);
    try {
      const response = await sendMessage('SET_SETTINGS', result.patch);
      if (!response.ok) {
        console.error('[LexiPath] Failed to update settings:', response.error);
        toast({ 
          variant: "destructive", 
          title: t('optionsSaveError'), 
          description: response.error.message 
        });
        return;
      }

      if (settings) {
        const merged = SettingsSchema.parse({ ...settings, ...result.patch });
        setSettings(merged);
        setForm(settingsToFormState(merged));
      }

      toast({ title: t('optionsSaveSuccess'), className: "bg-green-50 border-green-200 text-green-900" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
          <p className="text-sm text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 py-8">
      <div className="container mx-auto max-w-5xl px-4">
        <Card className="border border-purple-200/50 shadow-2xl overflow-hidden bg-white/80 backdrop-blur-sm">
          <CardHeader className="border-b border-purple-200/50 bg-gradient-to-r from-white/90 via-purple-50/80 to-white/90 pb-6 pt-8">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
                <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <CardTitle className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  {t('settingsTitle')}
                </CardTitle>
                <CardDescription className="mt-1 text-sm text-gray-600">
                  Configure your LexiPath experience.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 pb-8">
            <Tabs defaultValue="general" className="w-full">
              <TabsList className="grid w-full grid-cols-4 bg-purple-50/50 p-1 rounded-lg shadow-sm border border-purple-200/50">
                <TabsTrigger value="general" className="data-[state=active]:bg-gradient-to-br data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200">
                  {t('languageSettings')}
                </TabsTrigger>
                <TabsTrigger value="providers" className="data-[state=active]:bg-gradient-to-br data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200">
                  {t('providerSettings')}
                </TabsTrigger>
                <TabsTrigger value="routing" className="data-[state=active]:bg-gradient-to-br data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200">
                  {t('optionsRoutingTitle')}
                </TabsTrigger>
                <TabsTrigger value="rules" className="data-[state=active]:bg-gradient-to-br data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200">
                  {t('siteRules')}
                </TabsTrigger>
              </TabsList>

            {/* --- GENERAL TAB --- */}
            <TabsContent value="general" className="space-y-6 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="native-language">{t('optionsNativeLanguageLabel')}</Label>
                  <Select
                    value={form.nativeLanguage}
                    onValueChange={(value) => setForm({ ...form, nativeLanguage: value as Settings['nativeLanguage'] })}
                  >
                    <SelectTrigger id="native-language">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      {nativeLanguageOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="target-language">{t('optionsTargetLanguageLabel')}</Label>
                  <Select
                    value={form.targetLanguage}
                    onValueChange={(value) => setForm({ ...form, targetLanguage: value as Settings['targetLanguage'] })}
                  >
                    <SelectTrigger id="target-language">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      {targetLanguageOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proficiency-level">{t('optionsProficiencyLevelLabel')}</Label>
                  <Select
                    value={form.proficiencyLevel}
                    onValueChange={(value) => setForm({ ...form, proficiencyLevel: value as Settings['proficiencyLevel'] })}
                  >
                    <SelectTrigger id="proficiency-level">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      {proficiencyOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            {/* --- PROVIDERS TAB --- */}
            <TabsContent value="providers" className="pt-4">
               <Tabs defaultValue="openai" className="w-full">
                  <div className="flex gap-4">
                     <TabsList className="flex flex-col h-auto w-40 items-start justify-start gap-1 p-1 bg-muted/50">
                        <TabsTrigger value="openai" className="w-full justify-start">OpenAI</TabsTrigger>
                        <TabsTrigger value="claude" className="w-full justify-start">Claude</TabsTrigger>
                        <TabsTrigger value="gemini" className="w-full justify-start">Gemini</TabsTrigger>
                     </TabsList>
                     
                     <div className="flex-1 space-y-4">
                        <TabsContent value="openai" className="mt-0 space-y-4">
                           <div className="flex justify-between items-center">
                              <div>
                                 <h3 className="text-lg font-medium">OpenAI</h3>
                                 <p className="text-sm text-muted-foreground">{t('optionsChannelOpenAIDesc')}</p>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => testChannel('openai')} disabled={testing}>
                                 {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                 {t('optionsProviderTestButton')}
                              </Button>
                           </div>
                           
                           <div className="space-y-2">
                              <Label htmlFor="openai-base-url">{t('optionsProviderBaseUrlLabel')}</Label>
                              <Input 
                                 id="openai-base-url"
                                 value={form.channels.openai.baseUrl}
                                 onChange={(e) => updateChannel('openai', { baseUrl: e.target.value })}
                                 placeholder={t('optionsProviderBaseUrlPlaceholder')}
                                 className={fieldErrors.openai?.baseUrl ? "border-destructive" : ""}
                              />
                              {fieldErrors.openai?.baseUrl && <p className="text-xs text-destructive">{t(fieldErrors.openai.baseUrl)}</p>}
                           </div>
                           
                           <div className="space-y-2">
                              <Label htmlFor="openai-model">{t('optionsProviderModelLabel')}</Label>
                              <Input 
                                 id="openai-model"
                                 value={form.channels.openai.model}
                                 onChange={(e) => updateChannel('openai', { model: e.target.value })}
                                 placeholder={t('optionsProviderModelPlaceholder')}
                                 className={fieldErrors.openai?.model ? "border-destructive" : ""}
                              />
                              {fieldErrors.openai?.model && <p className="text-xs text-destructive">{t(fieldErrors.openai.model)}</p>}
                           </div>

                           <div className="space-y-2">
                              <Label htmlFor="openai-api-key">{t('optionsProviderApiKeyLabel')}</Label>
                              <Input 
                                 id="openai-api-key"
                                 type="password"
                                 value={form.channels.openai.apiKey}
                                 onChange={(e) => updateChannel('openai', { apiKey: e.target.value })}
                                 placeholder={t('optionsProviderApiKeyPlaceholder')}
                              />
                           </div>

                           <div className="space-y-2">
                              <Label htmlFor="openai-custom-headers">{t('optionsProviderCustomHeadersLabel')}</Label>
                              <Textarea 
                                 id="openai-custom-headers"
                                 value={form.channels.openai.customHeadersText}
                                 onChange={(e) => updateChannel('openai', { customHeadersText: e.target.value })}
                                 placeholder={t('optionsProviderCustomHeadersPlaceholder')}
                                 rows={4}
                                 className={fieldErrors.openai?.customHeadersText ? "border-destructive font-mono" : "font-mono"}
                              />
                              {fieldErrors.openai?.customHeadersText && <p className="text-xs text-destructive">{t(fieldErrors.openai.customHeadersText)}</p>}
                           </div>
                        </TabsContent>

                        <TabsContent value="claude" className="mt-0 space-y-4">
                           <div className="flex justify-between items-center">
                              <div>
                                 <h3 className="text-lg font-medium">Claude</h3>
                                 <p className="text-sm text-muted-foreground">{t('optionsChannelClaudeDesc')}</p>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => testChannel('claude')} disabled={testing}>
                                 {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                 {t('optionsProviderTestButton')}
                              </Button>
                           </div>
                           
                           <div className="space-y-2">
                              <Label htmlFor="claude-model">{t('optionsProviderModelLabel')}</Label>
                              <Input 
                                 id="claude-model"
                                 value={form.channels.claude.model}
                                 onChange={(e) => updateChannel('claude', { model: e.target.value })}
                                 placeholder={t('optionsClaudeModelPlaceholder')}
                                 className={fieldErrors.claude?.model ? "border-destructive" : ""}
                              />
                              {fieldErrors.claude?.model && <p className="text-xs text-destructive">{t(fieldErrors.claude.model)}</p>}
                           </div>

                           <div className="space-y-2">
                              <Label htmlFor="claude-api-key">{t('optionsProviderApiKeyLabel')}</Label>
                              <Input 
                                 id="claude-api-key"
                                 type="password"
                                 value={form.channels.claude.apiKey}
                                 onChange={(e) => updateChannel('claude', { apiKey: e.target.value })}
                                 placeholder={t('optionsProviderApiKeyPlaceholder')}
                                 className={fieldErrors.claude?.apiKey ? "border-destructive" : ""}
                              />
                               {fieldErrors.claude?.apiKey && <p className="text-xs text-destructive">{t(fieldErrors.claude.apiKey)}</p>}
                           </div>

                           <div className="space-y-2">
                              <Label htmlFor="claude-base-url">{t('optionsProviderBaseUrlLabel')}</Label>
                              <Input 
                                 id="claude-base-url"
                                 value={form.channels.claude.baseUrl}
                                 onChange={(e) => updateChannel('claude', { baseUrl: e.target.value })}
                                 placeholder={t('optionsClaudeBaseUrlPlaceholder')}
                              />
                           </div>
                        </TabsContent>

                        <TabsContent value="gemini" className="mt-0 space-y-4">
                           <div className="flex justify-between items-center">
                              <div>
                                 <h3 className="text-lg font-medium">Gemini</h3>
                                 <p className="text-sm text-muted-foreground">{t('optionsChannelGeminiDesc')}</p>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => testChannel('gemini')} disabled={testing}>
                                 {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                 {t('optionsProviderTestButton')}
                              </Button>
                           </div>
                           
                           <div className="space-y-2">
                              <Label htmlFor="gemini-model">{t('optionsProviderModelLabel')}</Label>
                              <Input 
                                 id="gemini-model"
                                 value={form.channels.gemini.model}
                                 onChange={(e) => updateChannel('gemini', { model: e.target.value })}
                                 placeholder={t('optionsGeminiModelPlaceholder')}
                                 className={fieldErrors.gemini?.model ? "border-destructive" : ""}
                              />
                              {fieldErrors.gemini?.model && <p className="text-xs text-destructive">{t(fieldErrors.gemini.model)}</p>}
                           </div>

                           <div className="space-y-2">
                              <Label htmlFor="gemini-api-key">{t('optionsProviderApiKeyLabel')}</Label>
                              <Input 
                                 id="gemini-api-key"
                                 type="password"
                                 value={form.channels.gemini.apiKey}
                                 onChange={(e) => updateChannel('gemini', { apiKey: e.target.value })}
                                 placeholder={t('optionsProviderApiKeyPlaceholder')}
                                 className={fieldErrors.gemini?.apiKey ? "border-destructive" : ""}
                              />
                               {fieldErrors.gemini?.apiKey && <p className="text-xs text-destructive">{t(fieldErrors.gemini.apiKey)}</p>}
                           </div>
                           
                           <div className="space-y-2">
                              <Label htmlFor="gemini-base-url">{t('optionsProviderBaseUrlLabel')}</Label>
                              <Input 
                                 id="gemini-base-url"
                                 value={form.channels.gemini.baseUrl}
                                 onChange={(e) => updateChannel('gemini', { baseUrl: e.target.value })}
                                 placeholder={t('optionsGeminiBaseUrlPlaceholder')}
                              />
                           </div>
                        </TabsContent>
                     </div>
                  </div>
               </Tabs>
            </TabsContent>

            {/* --- ROUTING & LIMITS TAB --- */}
            <TabsContent value="routing" className="space-y-8 pt-4">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">{t('optionsRoutingTitle')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="keyword-provider">{t('optionsKeywordProviderLabel')}</Label>
                    <Select
                      value={form.keywordProvider}
                      onValueChange={(value) => setForm({ ...form, keywordProvider: value as LLMProviderChannel })}
                    >
                      <SelectTrigger id="keyword-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {providerChannelOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="translation-provider">{t('optionsTranslationProviderLabel')}</Label>
                    <Select
                      value={form.translationProvider}
                      onValueChange={(value) => setForm({ ...form, translationProvider: value as TranslationProvider })}
                    >
                      <SelectTrigger id="translation-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {translationProviderOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                 <div className="flex gap-2">
                     <Button variant="outline" size="sm" onClick={() => testChannel('google')} disabled={testing}>
                        {t('optionsTestGoogleTranslate')}
                     </Button>
                     <Button variant="outline" size="sm" onClick={() => testChannel('bing')} disabled={testing}>
                        {t('optionsTestBingTranslate')}
                     </Button>
                 </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h3 className="text-lg font-medium">{t('optionsAdvancedTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('optionsConcurrencyDesc')}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {['openai', 'claude', 'gemini', 'google', 'bing'].map((channel) => (
                     <div key={channel} className="space-y-2">
                        <Label htmlFor={`concurrency-${channel}`}>{t(`optionsConcurrencyChannel_${channel}`)}</Label>
                        <Input 
                           id={`concurrency-${channel}`}
                           type="number"
                           min={1}
                           max={500}
                           value={form.channelConcurrencyLimits[channel as keyof ConcurrencyFormState]}
                           onChange={(e) => updateConcurrency(channel as keyof ConcurrencyFormState, e.target.value)}
                        />
                     </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* --- RULES TAB --- */}
            <TabsContent value="rules" className="space-y-6 pt-4">
               <div className="space-y-3">
                  <Label>{t('optionsSiteModeLabel')}</Label>
                  <Tabs 
                     value={form.siteMode} 
                     onValueChange={(val) => setForm({ ...form, siteMode: val as SiteMode })}
                     className="w-full"
                  >
                     <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                        <TabsTrigger value="all">{t('optionsSiteModeAll')}</TabsTrigger>
                        <TabsTrigger value="whitelist">{t('optionsSiteModeWhitelist')}</TabsTrigger>
                     </TabsList>
                  </Tabs>
                  <p className="text-sm text-muted-foreground">{t('optionsSiteModeDesc')}</p>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ListEditor
                     titleKey="optionsExcludedSitesLabel"
                     descriptionKey="optionsExcludedSitesDesc"
                     placeholderKey="optionsSiteEntryPlaceholder"
                     items={form.excludedSites}
                     onChange={(items) => setForm({ ...form, excludedSites: items })}
                  />
                  <ListEditor
                     titleKey="optionsAllowedSitesLabel"
                     descriptionKey="optionsAllowedSitesDesc"
                     placeholderKey="optionsSiteEntryPlaceholder"
                     items={form.allowedSites}
                     onChange={(items) => setForm({ ...form, allowedSites: items })}
                  />
               </div>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-end border-t border-purple-200/50 pt-6 bg-gradient-to-r from-gray-50 to-purple-50/30">
           <Button
             onClick={save}
             disabled={saving}
             className="shadow-lg hover:shadow-xl transition-all duration-200 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-8"
           >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saving ? t('optionsSaving') : t('optionsSaveButton')}
           </Button>
        </CardFooter>
      </Card>
      <Toaster />
    </div>
    </div>
  );
}
