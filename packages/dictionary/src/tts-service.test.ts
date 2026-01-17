import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lexipath/core/log', () => {
  return {
    createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
    getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

import { getVoices, speak, stop } from './tts-service';

type FakeVoice = {
  name?: string;
  voiceURI?: string;
  lang?: string;
  default?: boolean;
  localService?: boolean;
};

type FakeUtterance = {
  text: string;
  lang: string;
  voice?: FakeVoice;
  rate?: number;
  pitch?: number;
  volume?: number;
  onend: null | (() => void);
  onerror: null | ((event: { error?: string }) => void);
};

class FakeSpeechSynthesisUtterance {
  text: string;
  lang = '';
  voice: any;
  rate?: number;
  pitch?: number;
  volume?: number;
  onend: FakeUtterance['onend'] = null;
  onerror: FakeUtterance['onerror'] = null;

  constructor(text: string) {
    this.text = text;
  }
}

function installFakeSpeechSynthesis(voices: FakeVoice[] = []) {
  const utterances: FakeSpeechSynthesisUtterance[] = [];

  const listeners = new Map<string, Set<() => void>>();

  const synth = {
    speak: vi.fn((u: FakeSpeechSynthesisUtterance) => {
      utterances.push(u);
      // Resolve on next microtask by default.
      queueMicrotask(() => u.onend?.());
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices as any),
    addEventListener: vi.fn((name: string, fn: any) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
    }),
    removeEventListener: vi.fn((name: string, fn: any) => {
      listeners.get(name)?.delete(fn);
    }),
    _emit: (name: string) => {
      for (const fn of listeners.get(name) ?? []) fn();
    },
    _utterances: utterances,
  };

  (globalThis as any).speechSynthesis = synth;
  (globalThis as any).SpeechSynthesisUtterance = FakeSpeechSynthesisUtterance;

  return synth as any;
}

afterEach(() => {
  // Ensure the module-level queue doesn't leak across tests.
  // Delete the synth first so cleanup doesn't count as a cancel() call.
  delete (globalThis as any).speechSynthesis;
  delete (globalThis as any).SpeechSynthesisUtterance;

  try {
    stop();
  } catch {
    // ignore
  }
});

async function nextMicrotask(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('tts-service', () => {
  it('getVoices returns empty when SpeechSynthesis unavailable', () => {
    expect(getVoices()).toEqual([]);
  });

  it('speak resolves immediately for blank text', async () => {
    installFakeSpeechSynthesis([]);
    await expect(speak('   ', 'en-US')).resolves.toBeUndefined();
  });

  it('speak enqueues and calls speechSynthesis.speak sequentially', async () => {
    const synth = installFakeSpeechSynthesis([{ name: 'Ava', lang: 'en-US' }]);

    const p1 = speak('one', 'en-US');
    const p2 = speak('two', 'en-US');

    await expect(Promise.all([p1, p2])).resolves.toEqual([undefined, undefined]);

    expect(synth.speak).toHaveBeenCalledTimes(2);
    const utterances = synth._utterances as FakeSpeechSynthesisUtterance[];
    expect(utterances.map((u) => u.text)).toEqual(['one', 'two']);
  });

  it('stop rejects pending and active requests and cancels synth', async () => {
    // Make speak never resolve on its own.
    const synth = installFakeSpeechSynthesis([{ name: 'Ava', lang: 'en-US' }]);
    (synth.speak as any).mockImplementation((u: FakeSpeechSynthesisUtterance) => {
      (synth._utterances as FakeSpeechSynthesisUtterance[]).push(u);
    });

    const p1 = speak('one', 'en-US');
    // Give the queue a microtask to start processing p1 and set activeReject.
    await nextMicrotask();
    const p2 = speak('two', 'en-US');

    // Attach rejection handlers first so stop() doesn't trigger
    // an unhandled rejection before our assertions run.
    const e1 = expect(p1).rejects.toHaveProperty('name', 'TtsStoppedError');
    const e2 = expect(p2).rejects.toHaveProperty('name', 'TtsStoppedError');

    stop();

    await e1;
    await e2;
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('prefers voiceURI and voiceName selection when provided', async () => {
    const voices: FakeVoice[] = [
      { name: 'Male', lang: 'en-US', voiceURI: 'v1' },
      { name: 'Ava', lang: 'en-US', voiceURI: 'v2' },
    ];
    const synth = installFakeSpeechSynthesis(voices);

    await speak('hello', 'en-US', { voiceURI: 'v2' });
    const u1 = (synth._utterances as FakeSpeechSynthesisUtterance[])[0];
    expect(u1?.voice?.voiceURI).toBe('v2');

    stop();
    (synth._utterances as FakeSpeechSynthesisUtterance[]).length = 0;

    await speak('hello', 'en-US', { voiceName: 'Male' });
    const u2 = (synth._utterances as FakeSpeechSynthesisUtterance[])[0];
    expect(u2?.voice?.name).toBe('Male');
  });

  it('prefers female-sounding voice for matching language when no explicit choice', async () => {
    const voices: FakeVoice[] = [
      { name: 'David', lang: 'en-US' },
      { name: 'Ava', lang: 'en-US' },
    ];
    const synth = installFakeSpeechSynthesis(voices);

    await speak('hello', 'en-US');
    const u = (synth._utterances as FakeSpeechSynthesisUtterance[])[0];
    expect(u?.voice?.name).toBe('Ava');
  });
});
