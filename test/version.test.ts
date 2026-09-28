import { describe, it, expect } from 'vitest';
import pkg from '../package.json';
import { VERSION } from '../src/index.js';

describe('VERSION', () => {
  it('matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
