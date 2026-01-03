import React, { useEffect, useMemo, useState } from 'react';
import browser from 'webextension-polyfill';
import { z } from 'zod';
import {
  CEFRLevelSchema,
  NativeLanguageSchema,
  ProviderConfigSchema,
  SettingsSchema,
  SupportedLanguageSchema,
  type ProviderConfig,
  type Settings,
} from '@lexipath/core';
import { sendMessage } from '../../shared/messages';

type SiteMode = 'all' | 'whitelist';

type FormState = {
  providerBaseUrl: string;
  providerModel: string;
  providerApiKey: string;
  providerCustomHeadersText: string;
  modelConcurrencyLimitsText: string;
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
  | 'optionsProviderCustomHeadersInvalidJson'
  | 'optionsProviderCustomHeadersInvalidFormat'
  | 'optionsConcurrencyInvalidJson'
  | 'optionsConcurrencyInvalidFormat';

type FieldErrors = Partial<{
  providerBaseUrl: FieldErrorKey;
  providerModel: FieldErrorKey;
  providerCustomHeadersText: FieldErrorKey;
  modelConcurrencyLimitsText: FieldErrorKey;
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
  return {
    providerBaseUrl: settings.provider?.baseUrl ?? '',
    providerModel: settings.provider?.model ?? '',
    providerApiKey: settings.provider?.apiKey ?? '',
    providerCustomHeadersText: settings.provider?.customHeaders
      ? JSON.stringify(settings.provider.customHeaders, null, 2)
      : '',
    modelConcurrencyLimitsText: JSON.stringify(settings.modelConcurrencyLimits ?? {}, null, 2),
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

function parseModelConcurrencyLimits(
  rawText: string
): { ok: true; value: Record<string, number> } | { ok: false; errorKey: FieldErrorKey } {
  const text = rawText.trim();
  if (!text) return { ok: true, value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errorKey: 'optionsConcurrencyInvalidJson' };
  }

  const result = z.record(z.number().int().min(1).max(500)).safeParse(parsed);
  if (!result.success) {
    return { ok: false, errorKey: 'optionsConcurrencyInvalidFormat' };
  }
  return { ok: true, value: result.data };
}

function buildSettingsPatch(form: FormState): {
  ok: true;
  patch: Partial<Settings>;
  errors: FieldErrors;
  provider: ProviderConfig;
} | {
  ok: false;
  patch?: undefined;
  errors: FieldErrors;
  provider?: undefined;
} {
  const errors: FieldErrors = {};

  const providerBaseUrl = form.providerBaseUrl.trim();
  if (!providerBaseUrl) {
    errors.providerBaseUrl = 'optionsProviderBaseUrlRequired';
  } else if (!z.string().url().safeParse(providerBaseUrl).success) {
    errors.providerBaseUrl = 'optionsProviderBaseUrlInvalid';
  }

  const providerModel = form.providerModel.trim();
  if (!providerModel) {
    errors.providerModel = 'optionsProviderModelRequired';
  }

  const customHeadersResult = parseCustomHeaders(form.providerCustomHeadersText);
  const customHeaders = customHeadersResult.ok ? customHeadersResult.value : undefined;
  if (!customHeadersResult.ok) {
    errors.providerCustomHeadersText = customHeadersResult.errorKey;
  }

  const concurrencyResult = parseModelConcurrencyLimits(form.modelConcurrencyLimitsText);
  if (!concurrencyResult.ok) {
    errors.modelConcurrencyLimitsText = concurrencyResult.errorKey;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const providerCandidate: ProviderConfig = {
    baseUrl: providerBaseUrl,
    model: providerModel,
    ...(form.providerApiKey.trim()
      ? { apiKey: form.providerApiKey.trim() }
      : {}),
    ...(customHeaders ? { customHeaders } : {}),
  };

  const providerParsed = ProviderConfigSchema.safeParse(providerCandidate);
  if (!providerParsed.success) {
    return { ok: false, errors: { providerBaseUrl: 'optionsProviderBaseUrlInvalid' } };
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

  const patch: Partial<Settings> = {
    provider: providerParsed.data,
    modelConcurrencyLimits: concurrencyResult.ok ? concurrencyResult.value : {},
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

  return { ok: true, patch, errors: {}, provider: providerParsed.data };
}

function InputField(props: {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey?: string;
  type?: 'text' | 'password' | 'url';
  value: string;
  onChange: (value: string) => void;
  errorKey?: FieldErrorKey | undefined;
  required?: boolean;
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
  value: TValue;
  onChange: (value: TValue) => void;
  options: Array<{ value: TValue; labelKey: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {t(props.labelKey)}
      </label>
      <select
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as TValue)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey)}
          </option>
        ))}
      </select>
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

  async function testConnection() {
    if (!form) return;

    setNotice(null);
    const result = buildSettingsPatch(form);
    setFieldErrors(result.errors);
    if (!result.ok) {
      setNotice({ kind: 'error', messageKey: 'optionsValidationError' });
      return;
    }

    setTesting(true);
    try {
      const response = await sendMessage('TEST_PROVIDER_CONNECTION', { provider: result.provider });

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
        providerErrorText !== providerErrorKey ? providerErrorText : response.error.message || t('optionsProviderTestFailedUnknown');

      setNotice({ kind: 'error', messageKey: 'optionsProviderTestFailed', substitutions: substitution });
    } finally {
      setTesting(false);
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
          <div className="space-y-4">
            <InputField
              id="provider-base-url"
              labelKey="optionsProviderBaseUrlLabel"
              descriptionKey="optionsProviderBaseUrlDesc"
              placeholderKey="optionsProviderBaseUrlPlaceholder"
              type="url"
              required
              value={form.providerBaseUrl}
              onChange={(value) => setForm({ ...form, providerBaseUrl: value })}
              errorKey={fieldErrors.providerBaseUrl}
            />

            <InputField
              id="provider-model"
              labelKey="optionsProviderModelLabel"
              placeholderKey="optionsProviderModelPlaceholder"
              required
              value={form.providerModel}
              onChange={(value) => setForm({ ...form, providerModel: value })}
              errorKey={fieldErrors.providerModel}
            />

            <InputField
              id="provider-api-key"
              labelKey="optionsProviderApiKeyLabel"
              descriptionKey="optionsProviderApiKeyDesc"
              placeholderKey="optionsProviderApiKeyPlaceholder"
              type="password"
              value={form.providerApiKey}
              onChange={(value) => setForm({ ...form, providerApiKey: value })}
            />

            <TextareaField
              id="provider-custom-headers"
              labelKey="optionsProviderCustomHeadersLabel"
              descriptionKey="optionsProviderCustomHeadersDesc"
              placeholderKey="optionsProviderCustomHeadersPlaceholder"
              value={form.providerCustomHeadersText}
              onChange={(value) => setForm({ ...form, providerCustomHeadersText: value })}
              errorKey={fieldErrors.providerCustomHeadersText}
              rows={7}
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={testConnection}
                disabled={testing}
                className={`px-4 py-2 rounded-lg font-medium ${
                  testing ? 'bg-gray-200 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'
                }`}
              >
                {testing ? t('optionsProviderTesting') : t('optionsProviderTestButton')}
              </button>
              <p className="text-xs text-gray-500">{t('optionsProviderTestHint')}</p>
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
          <div className="space-y-4">
            <TextareaField
              id="model-concurrency-limits"
              labelKey="optionsConcurrencyLabel"
              descriptionKey="optionsConcurrencyHint"
              placeholderKey="optionsConcurrencyPlaceholder"
              value={form.modelConcurrencyLimitsText}
              onChange={(value) => setForm({ ...form, modelConcurrencyLimitsText: value })}
              errorKey={fieldErrors.modelConcurrencyLimitsText}
              rows={6}
            />
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
