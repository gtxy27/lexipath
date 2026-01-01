export interface TtsSpeakOptions {
  rate?: number;
  voiceURI?: string;
  voiceName?: string;
  volume?: number;
  pitch?: number;
}

type SpeakRequest = {
  text: string;
  lang: string;
  options?: TtsSpeakOptions;
  resolve: () => void;
  reject: (error: unknown) => void;
};

class TtsStoppedError extends Error {
  constructor() {
    super('TTS stopped');
    this.name = 'TtsStoppedError';
  }
}

function getSpeechSynthesis(): SpeechSynthesis | null {
  const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return synth ?? null;
}

function isVoiceLanguageMatch(voiceLang: string, requestedLang: string): boolean {
  if (!voiceLang || !requestedLang) return false;
  if (voiceLang.toLowerCase() === requestedLang.toLowerCase()) return true;
  const voiceBase = voiceLang.split('-')[0]?.toLowerCase();
  const requestedBase = requestedLang.split('-')[0]?.toLowerCase();
  return Boolean(voiceBase && requestedBase && voiceBase === requestedBase);
}

function pickVoice(params: {
  voices: SpeechSynthesisVoice[];
  lang: string;
  voiceURI?: string;
  voiceName?: string;
}): SpeechSynthesisVoice | null {
  const { voices, lang, voiceURI, voiceName } = params;
  if (!voices.length) return null;

  if (voiceURI) {
    const match = voices.find((v) => v.voiceURI === voiceURI);
    if (match) return match;
  }

  if (voiceName) {
    const match = voices.find((v) => v.name === voiceName);
    if (match) return match;
  }

  const exact = voices.filter((v) => v.lang?.toLowerCase() === lang.toLowerCase());
  const exactDefault = exact.find((v) => v.default);
  if (exactDefault) return exactDefault;
  if (exact.length) return exact[0] ?? null;

  const base = voices.filter((v) => isVoiceLanguageMatch(v.lang, lang));
  const baseDefault = base.find((v) => v.default);
  if (baseDefault) return baseDefault;
  if (base.length) return base[0] ?? null;

  const anyDefault = voices.find((v) => v.default);
  return anyDefault ?? voices[0] ?? null;
}

function getVoicesInternal(lang?: string): SpeechSynthesisVoice[] {
  const synth = getSpeechSynthesis();
  if (!synth) return [];

  const voices = synth.getVoices();
  if (!lang) return voices;
  return voices.filter((v) => isVoiceLanguageMatch(v.lang, lang));
}

function waitForVoices(timeoutMs = 750): Promise<void> {
  const synth = getSpeechSynthesis();
  if (!synth) return Promise.resolve();

  if (synth.getVoices().length) return Promise.resolve();

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      resolve();
    };
    const onVoicesChanged = () => finish();
    synth.addEventListener('voiceschanged', onVoicesChanged);
    setTimeout(finish, timeoutMs);
  });
}

let queue: SpeakRequest[] = [];
let processing = false;
let stopToken = 0;
let activeReject: ((error: unknown) => void) | null = null;

async function speakOnce(text: string, lang: string, options?: TtsSpeakOptions): Promise<void> {
  const synth = getSpeechSynthesis();
  if (!synth) {
    throw new Error('SpeechSynthesis is not available in this environment');
  }

  await waitForVoices();
  const voices = getVoicesInternal();
  const voicePickParams: Parameters<typeof pickVoice>[0] = { voices, lang };
  if (options?.voiceURI) voicePickParams.voiceURI = options.voiceURI;
  if (options?.voiceName) voicePickParams.voiceName = options.voiceName;
  const voice = pickVoice(voicePickParams);

  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;

    if (options?.rate != null) utterance.rate = options.rate;
    if (options?.pitch != null) utterance.pitch = options.pitch;
    if (options?.volume != null) utterance.volume = options.volume;

    let settled = false;

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      if (activeReject === settleReject) activeReject = null;
      resolve();
    };

    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (activeReject === settleReject) activeReject = null;
      reject(error);
    };

    activeReject = settleReject;

    utterance.onend = () => settleResolve();
    utterance.onerror = (event) => {
      const message = event.error || 'Speech synthesis error';
      settleReject(new Error(message));
    };

    synth.speak(utterance);
  });
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  const localStopToken = stopToken;
  try {
    while (queue.length) {
      if (stopToken !== localStopToken) break;

      const request = queue.shift();
      if (!request) break;

      try {
        await speakOnce(request.text, request.lang, request.options);
        request.resolve();
      } catch (error) {
        request.reject(error);
      }
    }
  } finally {
    if (stopToken === localStopToken) {
      processing = false;
    } else {
      processing = false;
    }
  }
}

/**
 * Speak text in a given language, with internal queueing to avoid overlapping playback.
 */
export function speak(text: string, lang: string): Promise<void>;
export function speak(text: string, lang: string, options?: TtsSpeakOptions): Promise<void>;
export function speak(text: string, lang: string, options?: TtsSpeakOptions): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (options) {
      queue.push({ text: trimmed, lang, options, resolve, reject });
    } else {
      queue.push({ text: trimmed, lang, resolve, reject });
    }
    void processQueue();
  });
}

/**
 * Stop current speech and clear any queued utterances.
 */
export function stop(): void {
  stopToken++;
  const synth = getSpeechSynthesis();
  const pending = queue;
  queue = [];

  const error = new TtsStoppedError();
  for (const item of pending) {
    item.reject(error);
  }
  activeReject?.(error);

  synth?.cancel();
}

/**
 * List available voices, optionally filtered by language.
 */
export function getVoices(lang?: string): SpeechSynthesisVoice[] {
  return getVoicesInternal(lang);
}
