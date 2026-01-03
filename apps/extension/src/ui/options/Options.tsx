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

type Notice =
  | { kind: 'success'; messageKey: string; substitutions?: string | string[] }
  | { kind: 'error'; messageKey: string; substitutions?: string | string[] };

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

function InputField(props: {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey?: string;
  type?: 'text' | 'password' | 'url' | 'number';
  value: string;
  onChange: (value: string) => void;
  errorKey?: FieldErrorKey | undefined;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {t(props.labelKey)}{props.required ? <span className="text-red-600"> *</span> : null}
      </label>
      {props.descriptionKey ? (
        <p className="text-xs text-gray-500">{t(props.descriptionKey)}</p>
      ) : null}
      <input
        id={props.id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholderKey ? t(props.placeholderKey) : undefined}
        min={props.min}
        max={props.max}
        step={props.step}
        className={`w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          props.errorKey ? 'border-red-500' : 'border-gray-200'
        }`}
      />
      {props.errorKey ? (
        <p className="text-sm text-red-600">{t(props.errorKey)}</p>
      ) : null}
    </div>
  );
}

function TextareaField(props: {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey?: string;
  value: string;
  onChange: (value: string) => void;
  errorKey?: FieldErrorKey | undefined;
  rows?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {t(props.labelKey)}
      </label>
      {props.descriptionKey ? (
        <p className="text-xs text-gray-500">{t(props.descriptionKey)}</p>
      ) : null}
      <textarea
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholderKey ? t(props.placeholderKey) : undefined}
        rows={props.rows ?? 6}
        className={`w-full px-3 py-2 border rounded-lg bg-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          props.errorKey ? 'border-red-500' : 'border-gray-200'
        }`}
      />
      {props.errorKey ? (
        <p className="text-sm text-red-600">{t(props.errorKey)}</p>
      ) : null}
    </div>
  );
}

function SelectField<TValue extends string>(props: {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  value: TValue;
  onChange: (value: TValue) => void;
  options: Array<{ value: TValue; labelKey: string }>;
  errorKey?: FieldErrorKey | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {t(props.labelKey)}
      </label>
      {props.descriptionKey ? (
        <p className="text-xs text-gray-500">{t(props.descriptionKey)}</p>
      ) : null}
      <select
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as TValue)}
        className={`w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          props.errorKey ? 'border-red-500' : 'border-gray-200'
        }`}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey)}
          </option>
        ))}
      </select>
      {props.errorKey ? (
        <p className="text-sm text-red-600">{t(props.errorKey)}</p>
      ) : null}
    </div>
  );
}

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
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{t(props.titleKey)}</h3>
        {props.descriptionKey ? (
          <p className="text-xs text-gray-500 mt-1">{t(props.descriptionKey)}</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t(props.placeholderKey)}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addItem();
            }
          }}
        />
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          {t('optionsListAdd')}
        </button>
      </div>

      {props.items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.items.map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-100 border border-gray-200"
            >
              <span className="text-xs font-mono">{item}</span>
              <button
                type="button"
                onClick={() => removeItem(item)}
                className="text-xs text-gray-600 hover:text-gray-900"
                aria-label={t('optionsListRemoveAria', item)}
              >
                {t('optionsListRemove')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500">{t('optionsListEmpty')}</p>
      )}
    </div>
  );
}

export function Options(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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
        setNotice({ kind: 'error', messageKey: 'optionsLoadError', substitutions: response.error.message });
      }
      setLoading(false);
    }
    loadSettings();
  }, []);

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
        setNotice({ kind: 'success', messageKey: 'optionsProviderTestSuccess' });
        return;
      }

      if (response.error.code === 'PERMISSION_DENIED') {
        setNotice({ kind: 'error', messageKey: 'optionsPermissionDenied' });
        return;
      }
      if (response.error.code === 'PERMISSION_REQUEST_FAILED') {
        setNotice({ kind: 'error', messageKey: 'optionsPermissionRequestFailed' });
        return;
      }

      const providerErrorKey = `providerError_${response.error.code}`;
      const providerErrorText = t(providerErrorKey);
      const substitution =
        providerErrorText !== providerErrorKey
          ? providerErrorText
          : response.error.message || t('optionsProviderTestFailedUnknown');

      setNotice({ kind: 'error', messageKey: 'optionsProviderTestFailed', substitutions: substitution });
    } finally {
      setTesting(false);
    }
  }

  async function testChannel(channel: TranslationProvider) {
    if (!form) return;

    setNotice(null);
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
      setNotice({ kind: 'error', messageKey: 'optionsValidationError' });
      return;
    }

    setFieldErrors({});
    await testProviderConnection(payload);
  }

  async function save() {
    if (!form) return;

    setNotice(null);
    const result = buildSettingsPatch(form);
    setFieldErrors(result.errors);
    if (!result.ok) {
      setNotice({ kind: 'error', messageKey: 'optionsValidationError' });
      return;
    }

    setSaving(true);
    try {
      const response = await sendMessage('SET_SETTINGS', result.patch);
      if (!response.ok) {
        console.error('[LexiPath] Failed to update settings:', response.error);
        setNotice({ kind: 'error', messageKey: 'optionsSaveError', substitutions: response.error.message });
        return;
      }

      if (settings) {
        const merged = SettingsSchema.parse({ ...settings, ...result.patch });
        setSettings(merged);
        setForm(settingsToFormState(merged));
      }

      setNotice({ kind: 'success', messageKey: 'optionsSaveSuccess' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <p className="text-gray-500">{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">
        {t('settingsTitle')}
      </h1>

      {notice ? (
        <div
          className={`mb-6 px-4 py-3 rounded-lg border ${
            notice.kind === 'success'
              ? 'bg-green-50 border-green-200 text-green-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
          role="status"
        >
          {t(notice.messageKey, notice.substitutions)}
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {t('providerSettings')}
        </h2>
        <p className="text-gray-500 mb-6">{t('providerSettingsDesc')}</p>

        {form ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('optionsChannelOpenAI')}</h3>
                  <p className="text-xs text-gray-500 mt-1">{t('optionsChannelOpenAIDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => testChannel('openai')}
                  disabled={testing}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    testing ? 'bg-gray-200 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'
                  }`}
                >
                  {testing ? t('optionsProviderTesting') : t('optionsProviderTestButton')}
                </button>
              </div>

              <div className="space-y-4">
                <InputField
                  id="openai-base-url"
                  labelKey="optionsProviderBaseUrlLabel"
                  descriptionKey="optionsProviderBaseUrlDesc"
                  placeholderKey="optionsProviderBaseUrlPlaceholder"
                  type="url"
                  required={requiredLLM.has('openai')}
                  value={form.channels.openai.baseUrl}
                  onChange={(value) => updateChannel('openai', { baseUrl: value })}
                  errorKey={fieldErrors.openai?.baseUrl}
                />

                <InputField
                  id="openai-model"
                  labelKey="optionsProviderModelLabel"
                  placeholderKey="optionsProviderModelPlaceholder"
                  required={requiredLLM.has('openai')}
                  value={form.channels.openai.model}
                  onChange={(value) => updateChannel('openai', { model: value })}
                  errorKey={fieldErrors.openai?.model}
                />

                <InputField
                  id="openai-api-key"
                  labelKey="optionsProviderApiKeyLabel"
                  descriptionKey="optionsProviderApiKeyDesc"
                  placeholderKey="optionsProviderApiKeyPlaceholder"
                  type="password"
                  value={form.channels.openai.apiKey}
                  onChange={(value) => updateChannel('openai', { apiKey: value })}
                />

                <TextareaField
                  id="openai-custom-headers"
                  labelKey="optionsProviderCustomHeadersLabel"
                  descriptionKey="optionsProviderCustomHeadersDesc"
                  placeholderKey="optionsProviderCustomHeadersPlaceholder"
                  value={form.channels.openai.customHeadersText}
                  onChange={(value) => updateChannel('openai', { customHeadersText: value })}
                  errorKey={fieldErrors.openai?.customHeadersText}
                  rows={7}
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('optionsChannelClaude')}</h3>
                  <p className="text-xs text-gray-500 mt-1">{t('optionsChannelClaudeDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => testChannel('claude')}
                  disabled={testing}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    testing ? 'bg-gray-200 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'
                  }`}
                >
                  {testing ? t('optionsProviderTesting') : t('optionsProviderTestButton')}
                </button>
              </div>

              <div className="space-y-4">
                <InputField
                  id="claude-model"
                  labelKey="optionsProviderModelLabel"
                  placeholderKey="optionsClaudeModelPlaceholder"
                  required={requiredLLM.has('claude')}
                  value={form.channels.claude.model}
                  onChange={(value) => updateChannel('claude', { model: value })}
                  errorKey={fieldErrors.claude?.model}
                />

                <InputField
                  id="claude-api-key"
                  labelKey="optionsProviderApiKeyLabel"
                  descriptionKey="optionsClaudeApiKeyDesc"
                  placeholderKey="optionsProviderApiKeyPlaceholder"
                  type="password"
                  required={requiredLLM.has('claude')}
                  value={form.channels.claude.apiKey}
                  onChange={(value) => updateChannel('claude', { apiKey: value })}
                  errorKey={fieldErrors.claude?.apiKey}
                />

                <InputField
                  id="claude-base-url"
                  labelKey="optionsProviderBaseUrlLabel"
                  descriptionKey="optionsClaudeBaseUrlDesc"
                  placeholderKey="optionsClaudeBaseUrlPlaceholder"
                  type="url"
                  value={form.channels.claude.baseUrl}
                  onChange={(value) => updateChannel('claude', { baseUrl: value })}
                  errorKey={fieldErrors.claude?.baseUrl}
                />

                <TextareaField
                  id="claude-custom-headers"
                  labelKey="optionsProviderCustomHeadersLabel"
                  descriptionKey="optionsProviderCustomHeadersDesc"
                  placeholderKey="optionsProviderCustomHeadersPlaceholder"
                  value={form.channels.claude.customHeadersText}
                  onChange={(value) => updateChannel('claude', { customHeadersText: value })}
                  errorKey={fieldErrors.claude?.customHeadersText}
                  rows={7}
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('optionsChannelGemini')}</h3>
                  <p className="text-xs text-gray-500 mt-1">{t('optionsChannelGeminiDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => testChannel('gemini')}
                  disabled={testing}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    testing ? 'bg-gray-200 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'
                  }`}
                >
                  {testing ? t('optionsProviderTesting') : t('optionsProviderTestButton')}
                </button>
              </div>

              <div className="space-y-4">
                <InputField
                  id="gemini-model"
                  labelKey="optionsProviderModelLabel"
                  placeholderKey="optionsGeminiModelPlaceholder"
                  required={requiredLLM.has('gemini')}
                  value={form.channels.gemini.model}
                  onChange={(value) => updateChannel('gemini', { model: value })}
                  errorKey={fieldErrors.gemini?.model}
                />

                <InputField
                  id="gemini-api-key"
                  labelKey="optionsProviderApiKeyLabel"
                  descriptionKey="optionsGeminiApiKeyDesc"
                  placeholderKey="optionsProviderApiKeyPlaceholder"
                  type="password"
                  required={requiredLLM.has('gemini')}
                  value={form.channels.gemini.apiKey}
                  onChange={(value) => updateChannel('gemini', { apiKey: value })}
                  errorKey={fieldErrors.gemini?.apiKey}
                />

                <InputField
                  id="gemini-base-url"
                  labelKey="optionsProviderBaseUrlLabel"
                  descriptionKey="optionsGeminiBaseUrlDesc"
                  placeholderKey="optionsGeminiBaseUrlPlaceholder"
                  type="url"
                  value={form.channels.gemini.baseUrl}
                  onChange={(value) => updateChannel('gemini', { baseUrl: value })}
                  errorKey={fieldErrors.gemini?.baseUrl}
                />

                <TextareaField
                  id="gemini-custom-headers"
                  labelKey="optionsProviderCustomHeadersLabel"
                  descriptionKey="optionsProviderCustomHeadersDesc"
                  placeholderKey="optionsProviderCustomHeadersPlaceholder"
                  value={form.channels.gemini.customHeadersText}
                  onChange={(value) => updateChannel('gemini', { customHeadersText: value })}
                  errorKey={fieldErrors.gemini?.customHeadersText}
                  rows={7}
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">{t('optionsRoutingTitle')}</h3>
                <p className="text-xs text-gray-500 mt-1">{t('optionsRoutingDesc')}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SelectField
                  id="keyword-provider"
                  labelKey="optionsKeywordProviderLabel"
                  descriptionKey="optionsKeywordProviderDesc"
                  value={form.keywordProvider}
                  onChange={(value) => setForm({ ...form, keywordProvider: value })}
                  options={providerChannelOptions}
                  errorKey={fieldErrors.keywordProvider}
                />
                <SelectField
                  id="translation-provider"
                  labelKey="optionsTranslationProviderLabel"
                  descriptionKey="optionsTranslationProviderDesc"
                  value={form.translationProvider}
                  onChange={(value) => setForm({ ...form, translationProvider: value })}
                  options={translationProviderOptions}
                  errorKey={fieldErrors.translationProvider}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => testChannel('google')}
                  disabled={testing}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    testing ? 'bg-gray-100 text-gray-500' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {t('optionsTestGoogleTranslate')}
                </button>
                <button
                  type="button"
                  onClick={() => testChannel('bing')}
                  disabled={testing}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    testing ? 'bg-gray-100 text-gray-500' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {t('optionsTestBingTranslate')}
                </button>
                <p className="text-xs text-gray-500">{t('optionsProviderTestHint')}</p>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {t('optionsAdvancedTitle')}
        </h2>
        <p className="text-gray-500 mb-6">{t('optionsConcurrencyDesc')}</p>

        {form ? (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <InputField
              id="concurrency-openai"
              labelKey="optionsConcurrencyChannel_openai"
              type="number"
              min={1}
              max={500}
              step={1}
              value={form.channelConcurrencyLimits.openai}
              onChange={(value) => updateConcurrency('openai', value)}
              errorKey={fieldErrors.concurrency?.openai}
            />

            <InputField
              id="concurrency-claude"
              labelKey="optionsConcurrencyChannel_claude"
              type="number"
              min={1}
              max={500}
              step={1}
              value={form.channelConcurrencyLimits.claude}
              onChange={(value) => updateConcurrency('claude', value)}
              errorKey={fieldErrors.concurrency?.claude}
            />

            <InputField
              id="concurrency-gemini"
              labelKey="optionsConcurrencyChannel_gemini"
              type="number"
              min={1}
              max={500}
              step={1}
              value={form.channelConcurrencyLimits.gemini}
              onChange={(value) => updateConcurrency('gemini', value)}
              errorKey={fieldErrors.concurrency?.gemini}
            />

            <InputField
              id="concurrency-google"
              labelKey="optionsConcurrencyChannel_google"
              type="number"
              min={1}
              max={500}
              step={1}
              value={form.channelConcurrencyLimits.google}
              onChange={(value) => updateConcurrency('google', value)}
              errorKey={fieldErrors.concurrency?.google}
            />

            <InputField
              id="concurrency-bing"
              labelKey="optionsConcurrencyChannel_bing"
              type="number"
              min={1}
              max={500}
              step={1}
              value={form.channelConcurrencyLimits.bing}
              onChange={(value) => updateConcurrency('bing', value)}
              errorKey={fieldErrors.concurrency?.bing}
            />

            <p className="text-xs text-gray-500">{t('optionsConcurrencyHint')}</p>
          </div>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {t('languageSettings')}
        </h2>
        {form ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SelectField
              id="native-language"
              labelKey="optionsNativeLanguageLabel"
              value={form.nativeLanguage}
              onChange={(value) => setForm({ ...form, nativeLanguage: value })}
              options={nativeLanguageOptions}
            />
            <SelectField
              id="target-language"
              labelKey="optionsTargetLanguageLabel"
              value={form.targetLanguage}
              onChange={(value) => setForm({ ...form, targetLanguage: value })}
              options={targetLanguageOptions}
            />
            <SelectField
              id="proficiency-level"
              labelKey="optionsProficiencyLevelLabel"
              value={form.proficiencyLevel}
              onChange={(value) => setForm({ ...form, proficiencyLevel: value })}
              options={proficiencyOptions}
            />
          </div>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {t('siteRules')}
        </h2>
        {form ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('optionsSiteModeLabel')}</h3>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, siteMode: 'all' })}
                  className={`px-4 py-2 text-sm ${
                    form.siteMode === 'all'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t('optionsSiteModeAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, siteMode: 'whitelist' })}
                  className={`px-4 py-2 text-sm border-l border-gray-200 ${
                    form.siteMode === 'whitelist'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t('optionsSiteModeWhitelist')}
                </button>
              </div>
              <p className="text-xs text-gray-500">{t('optionsSiteModeDesc')}</p>
            </div>

            <div className="grid grid-cols-1 gap-6">
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
          </div>
        ) : null}
      </section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t">
        <button
          type="button"
          onClick={save}
          disabled={saving || !form}
          className={`mt-6 px-5 py-2.5 rounded-lg font-semibold ${
            saving || !form
              ? 'bg-gray-200 text-gray-500'
              : 'bg-primary-500 text-white hover:bg-primary-600'
          }`}
        >
          {saving ? t('optionsSaving') : t('optionsSaveButton')}
        </button>
      </div>
    </div>
  );
}
