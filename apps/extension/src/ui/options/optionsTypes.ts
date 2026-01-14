import type {
  CEFRLevel,
  ChannelTypeId,
  ProficiencyPreference,
  RouteKind,
  Settings,
} from "@lexipath/core";

export type SiteMode = "all" | "whitelist";

export type BehaviorKey =
  | "select_keywords"
  | "translate"
  | "translate_keywords"
  | "dictionary"
  | "adapt_subtitle"
  | "english_correction"
  | "chat";

export type ChannelFormState = {
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

export type RouteFormState = {
  kind: RouteKind;
  channelId: number | null;
  extra: Record<string, unknown>;
  followTranslate: boolean;
};

export type FormState = {
  channels: ChannelFormState[];
  behaviorRoutes: Record<BehaviorKey, RouteFormState>;
  nativeLanguage: Settings["nativeLanguage"];
  targetLanguage: Settings["targetLanguage"];
  proficiencyLevel: CEFRLevel;
  proficiencyPreference?: Settings["proficiencyPreference"];
  targetProficiencyLevel: CEFRLevel;
  targetProficiencyPreference?: Settings["targetProficiencyPreference"];
  theme: Settings["theme"];
  promptStyle: Settings["promptStyle"];
  llmContextSentences: Settings["llmContextSentences"];
  enabled: boolean;
  autoEnhance: boolean;
  webEnhanceMode: Settings["webEnhanceMode"];
  webEnhanceModeNative: Settings["webEnhanceModeNative"];
  webShowOriginal: Settings["webShowOriginal"];
  webStyleMapping: Settings["webStyleMapping"];
  webCustomCss: Settings["webCustomCss"];
  scenesEnabled: Settings["scenesEnabled"];
  hasCompletedOnboarding: Settings["hasCompletedOnboarding"];
  floatingButtonEnabled: Settings["floatingButtonEnabled"];
  webSelectionExplainEnabled: Settings["webSelectionExplainEnabled"];
  wordCardSectionsOrder: Settings["wordCardSectionsOrder"];
  wordCardAutoPronounce: Settings["wordCardAutoPronounce"];
  wordCardEnglishAccent: Settings["wordCardEnglishAccent"];
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

export type FieldErrorKey =
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

export type ChannelFieldErrors = Partial<{
  name: FieldErrorKey;
  baseUrl: FieldErrorKey;
  model: FieldErrorKey;
  apiKey: FieldErrorKey;
  customHeadersText: FieldErrorKey;
  iconUrl: FieldErrorKey;
}>;

export type WebDAVFieldErrors = Partial<{
  url: FieldErrorKey;
  username: FieldErrorKey;
  password: FieldErrorKey;
}>;

export type FieldErrors = Partial<{
  channels: Record<number, ChannelFieldErrors>;
  routes: Partial<Record<BehaviorKey, FieldErrorKey>>;
  webdav: WebDAVFieldErrors;
}>;
