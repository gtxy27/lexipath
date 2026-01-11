import { WebDAVProvider } from '@lexipath/storage';

import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';
import { recordExposureValid } from '../../shared/familiarity';
import { getStorageService } from '../../shared/storage-service';
import { bumpDailyUsage } from '../usage-summary';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

export function registerStorageFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('EXPORT_DATA', async () => {
    const storageService = getStorageService();
    return storageService.exportAll();
  });

  registry.register('IMPORT_DATA', async (payload) => {
    const storageService = getStorageService();
    await storageService.importAll(payload);
    return { ok: true };
  });

  registry.register('SEARCH_MESSAGES', async (payload) => {
    const storageService = getStorageService();
    const limitOption = typeof payload.limit === 'number' ? { limit: payload.limit } : {};
    return storageService.searchMessages(payload.query, limitOption);
  });

  registry.register('TEST_WEBDAV_CONNECTION', async (payload) => {
    const provider = new WebDAVProvider(payload);
    const result = await provider.testConnection();
    if (result.ok) return { ok: true };
    throw new MessageError(result.error);
  });

  registry.register('WEBDAV_UPLOAD', async (payload) => {
    const storageService = getStorageService();
    const data = await storageService.exportAll();
    const provider = new WebDAVProvider(payload);
    const result = await provider.upload(data);
    if (!result.ok) {
      throw new MessageError(result.error);
    }
    return { ok: true };
  });

  registry.register('WEBDAV_DOWNLOAD', async (payload) => {
    const provider = new WebDAVProvider(payload);
    const result = await provider.download();
    if (!result.ok) {
      throw new MessageError(result.error);
    }
    if (result.value) {
      const storageService = getStorageService();
      await storageService.importAll(result.value, { strategy: 'merge' });
    }
    return { ok: true };
  });

  registry.register('BATCH_GET_WORD_FAMILIARITY', async (payload: { words: string[] }) => {
    const words = payload.words.map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length === 0) return [];

    const storageService = getStorageService();
    const records = await storageService.batchGetWordFamiliarity(Array.from(new Set(words)));
    return Array.from(records.values());
  });

  registry.register('RECORD_EXPOSURE_VALID', async (payload: { words: string[] }) => {
    const words = payload.words.map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) return null;
    await Promise.all(words.map((word) => recordExposureValid(word)));
    void bumpDailyUsage({ task: 'exposure_valid', words: words.length, apiEvent: false });
    return null;
  });
}

