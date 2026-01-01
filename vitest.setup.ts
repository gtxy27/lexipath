// MUST be the FIRST thing - setup chrome before ANY imports
if (typeof globalThis !== 'undefined') {
  (globalThis as any).chrome = {
    runtime: { id: 'test-extension-id' },
  };
}

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});
