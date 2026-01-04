import '@testing-library/jest-dom/vitest';
import type matchers from '@testing-library/jest-dom/matchers';

declare global {
  namespace Chai {
    // Vitest v1's `expect()` assertions are based on Chai.
    // @testing-library/jest-dom provides matcher typings via `TestingLibraryMatchers`.
    interface Assertion extends matchers.TestingLibraryMatchers<any, Assertion> {}
  }
}

export {};
