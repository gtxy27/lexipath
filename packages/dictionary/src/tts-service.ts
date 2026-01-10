import { createLogger, getErrorMessage } from '@lexipath/core/log';

const log = createLogger('dictionary:tts');

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

  const normalize = (value: string) => value.trim().toLowerCase();
  const isFemaleName = (name: string, requestedLang: string) => {
    const n = normalize(name);
    const base = requestedLang.split('-')[0]?.toLowerCase();

    if (/\bfemale\b/.test(n)) return true;

    // Heuristics for common high-quality voices across platforms.
    const commonFemale = [
      'zira',
      'huihui',
      'yaoyao',
      'tingting',
      'samantha',
      'victoria',
      'karen',
      'tessa',
      'serena',
      'allison',
      'ava',
      'emma',
      'olivia',
      'joanna',
      'ivy',
      'kimberly',
      'salli',
      'amy',
      'lisa',
      'kyoko',
      'seoyeon',
      'milena',
    ];
    if (commonFemale.some((token) => n.includes(token))) return true;

    // Google voices often encode gender explicitly, but keep a mild language-aware fallback.
    if (n.includes('google') && n.includes('english') && n.includes('uk') && !n.includes('male')) {
      return true;
    }

    // Some locales ship with a single prominent female voice name.
    if (base === 'en' && n.includes('susan')) return true;
    if (base === 'zh' && (n.includes('xiaoxiao') || n.includes('xiaoyi'))) return true;

    return false;
  };

  const isLikelyMaleName = (name: string) => {
    const n = normalize(name);
    if (/\bmale\b/.test(n)) return true;
    const commonMale = ['david', 'mark', 'alex', 'fred', 'daniel', 'george', 'thomas'];
    return commonMale.some((token) => n.includes(token));
  };

  const pickPreferredFrom = (candidates: SpeechSynthesisVoice[]) => {
    if (!candidates.length) return null;
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -Infinity;

    for (const v of candidates) {
      const name = v.name ?? '';
      let score = 0;

      if (v.localService) score += 2;
      if (v.default) score += 5;

      // Prefer nicer female-sounding voices when available.
      if (isFemaleName(name, lang)) score += 100;
      if (isLikelyMaleName(name)) score -= 30;

      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }

    return best ?? candidates[0] ?? null;
  };

  if (voiceURI) {
    const match = voices.find((v) => v.voiceURI === voiceURI);
    if (match) return match;
  }

  if (voiceName) {
    const match = voices.find((v) => v.name === voiceName);
    if (match) return match;
  }

  const exact = voices.filter((v) => v.lang?.toLowerCase() === lang.toLowerCase());
  const exactPick = pickPreferredFrom(exact);
  if (exactPick) return exactPick;

  const base = voices.filter((v) => isVoiceLanguageMatch(v.lang, lang));
  const basePick = pickPreferredFrom(base);
  if (basePick) return basePick;

  const anyPick = pickPreferredFrom(voices);
  return anyPick ?? null;
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
        if (error instanceof TtsStoppedError) {
          log.debug('TTS stopped', { message: getErrorMessage(error) });
        } else {
          log.warn('TTS speakOnce failed', { message: getErrorMessage(error) });
        }
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
