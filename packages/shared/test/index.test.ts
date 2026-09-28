import { describe, expect, it } from 'vitest';

import { SHARED_VERSION } from '../src/index.js';

describe('@cane/shared', () => {
  it('exports SHARED_VERSION', () => {
    expect(SHARED_VERSION).toBe('0.0.0');
  });
});
