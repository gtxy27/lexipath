import type { ExplainWordOutput } from '@lexipath/core';
import type { ExplainWordRequest } from './types';

export type TranslateFn = (text: string, options: { from: string; to: string; timeout?: number }) => Promise<string>;

export class TranslateDictionaryProvider {
  private readonly translate: TranslateFn;

  constructor(options: { translate: TranslateFn }) {
    this.translate = options.translate;
  }

  async explainWord(request: ExplainWordRequest, options: { timeout?: number } = {}): Promise<ExplainWordOutput> {
    const word = request.word.trim();
    if (!word) {
      throw new Error('Invalid dictionary request: word is empty');
    }

    const translated = await this.translate(word, {
      from: String(request.sourceLang),
      to: String(request.targetLang),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    });

    const definition = translated?.trim();
    if (!definition) {
      throw new Error('Translate dictionary response is empty');
    }

    return {
      word,
      definition,
      targets: [definition],
      meta: { origin: 'online', provider: 'translate' },
    };
  }
}

