import { describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/index.js';

describe('@cane/core', () => {
  it('exports CORE_VERSION', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});
