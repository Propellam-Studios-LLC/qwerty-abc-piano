import { describe, it } from 'vitest';

// Smoke test for the test harness itself: if this file runs, vitest found the
// config and loaded the test environment. It makes no assertions about the
// library.

describe('setup', () => {
  it('test environment is configured', () => {
    // Intentionally empty: passing means the environment started.
  });
});
