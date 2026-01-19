import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { seedDictionaryFromPublicData } from './dictionary-seed';
import { dictionaryService } from './services/dictionary';

describe('dictionary seed', () => {
  beforeEach(async () => {
    // Keep tests isolated from any existing IndexedDB state.
    dictionaryService.close();

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });


  it('skips seeding when signature matches', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    const mkTextResponse = (text: string): Pick<Response, 'ok' | 'text'> => ({
      ok: true,
      text: async () => text,
    });

    const mkArrayBufferResponse = (buf: ArrayBuffer): Pick<Response, 'ok' | 'arrayBuffer'> => ({
      ok: true,
      arrayBuffer: async () => buf,
    });

    fetchMock
      .mockResolvedValueOnce(
        mkTextResponse(
          JSON.stringify({ version: 1, buildAt: 'x', files: { 'words_en.json.gz': { sha256: 'abc' } }, counts: {} }),
        ) as unknown as Response,
      )
      .mockResolvedValueOnce(mkArrayBufferResponse(new ArrayBuffer(0)) as unknown as Response);


    const initSpy = vi.spyOn(dictionaryService, 'init').mockResolvedValue();
    const getMetaSpy = vi
      .spyOn(dictionaryService, 'getMeta')
      .mockResolvedValueOnce('v1|words_en.json.gz:abc')
      .mockResolvedValueOnce('1');

    const clearSpy = vi.spyOn(dictionaryService, 'clearStores').mockResolvedValue();
    const importSpy = vi.spyOn(dictionaryService, 'importRecords').mockResolvedValue(0);
    const setMetaSpy = vi.spyOn(dictionaryService, 'setMeta').mockResolvedValue();

    const result = await seedDictionaryFromPublicData();

    expect(result).toEqual({ seeded: false });
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(getMetaSpy).toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(importSpy).not.toHaveBeenCalled();
    expect(setMetaSpy).not.toHaveBeenCalled();
  });
});
