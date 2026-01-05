import { StorageService } from '@lexipath/storage';

let singleton: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!singleton) {
    singleton = new StorageService();
  }
  return singleton;
}

