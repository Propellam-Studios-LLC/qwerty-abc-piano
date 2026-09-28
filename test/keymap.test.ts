import { describe, it, expect } from 'vitest';
import {
  WHITE_KEYS,
  BLACK_KEYS,
  DURATION_MAP,
  DOTTED_DURATION_MAP,
  DURATION_BEATS,
  NOTE_KEYS,
} from '../src/keymap.js';

describe('WHITE_KEYS', () => {
  it('maps all 11 home-row keys', () => {
    expect(Object.keys(WHITE_KEYS)).toHaveLength(11);
  });

  it.each([
    ['a', 'E', 3],
    ['s', 'F', 3],
    ['d', 'G', 3],
    ['f', 'A', 3],
    ['g', 'B', 3],
    ['h', 'C', 4],
    ['j', 'D', 4],
    ['k', 'E', 4],
    ['l', 'F', 4],
    [';', 'G', 4],
    ["'", 'A', 4],
  ])('key %s → %s%d', (key, note, octave) => {
    expect(WHITE_KEYS[key]).toEqual({ note, octave });
  });

  it('maps H to middle C (C4)', () => {
    expect(WHITE_KEYS['h']).toEqual({ note: 'C', octave: 4 });
  });
});

describe('BLACK_KEYS', () => {
  it('maps all 11 QWERTY-row keys (Q W E R T Y U I O P [)', () => {
    expect(Object.keys(BLACK_KEYS)).toHaveLength(11);
  });

  it.each(['q', 'w', 'y', 'o'])('key %s is a gap (null)', (key) => {
    expect(BLACK_KEYS[key]).toBeNull();
  });

  it.each([
    ['e', 'F#', 3],
    ['r', 'G#', 3],
    ['t', 'A#', 3],
    ['u', 'C#', 4],
    ['i', 'D#', 4],
    ['p', 'F#', 4],
    ['[', 'G#', 4],
  ])('key %s → %s%d', (key, note, octave) => {
    expect(BLACK_KEYS[key]).toEqual({ note, octave });
  });

  it('gap keys match piano geography (E–F and B–C have no black key)', () => {
    // Q/W are the pre-range gaps; Y is the B3–C4 gap; O is the E4–F4 gap
    expect(BLACK_KEYS['q']).toBeNull(); // no black key below F#3
    expect(BLACK_KEYS['w']).toBeNull(); // no black key below F#3
    expect(BLACK_KEYS['y']).toBeNull(); // B3–C4 natural half step
    expect(BLACK_KEYS['o']).toBeNull(); // E4–F4 natural half step
  });
});

describe('DURATION_MAP', () => {
  it.each([
    ['w', '4'],
    ['h', '2'],
    ['q', ''],
    ['e', '/2'],
    ['s', '/4'],
    ['t', '/8'],
  ] as const)('duration %s → ABC suffix "%s"', (dur, suffix) => {
    expect(DURATION_MAP[dur]).toBe(suffix);
  });

  it('quarter note has an empty suffix (L:1/4 is the default unit)', () => {
    expect(DURATION_MAP['q']).toBe('');
  });
});

describe('DOTTED_DURATION_MAP', () => {
  it.each([
    ['w', '6'],
    ['h', '3'],
    ['q', '3/2'],
    ['e', '3/4'],
    ['s', '3/8'],
    ['t', '3/16'],
  ] as const)('dotted %s → ABC suffix "%s"', (dur, suffix) => {
    expect(DOTTED_DURATION_MAP[dur]).toBe(suffix);
  });

  it('dotted quarter is 3/2 (= 1.5 × the default L:1/4 unit)', () => {
    expect(DOTTED_DURATION_MAP['q']).toBe('3/2');
  });
});

describe('DURATION_BEATS', () => {
  it.each([
    ['w', 4],
    ['h', 2],
    ['q', 1],
    ['e', 0.5],
    ['s', 0.25],
    ['t', 0.125],
  ] as const)('duration %s = %d quarter-note beats', (dur, beats) => {
    expect(DURATION_BEATS[dur]).toBe(beats);
  });
});

describe('NOTE_KEYS', () => {
  it('contains all white and black keys (22 total)', () => {
    // 11 white + 11 black (including 4 gap keys)
    expect(NOTE_KEYS.size).toBe(22);
  });

  it('includes gap keys (they are still keys, just produce no note)', () => {
    expect(NOTE_KEYS.has('q')).toBe(true);
    expect(NOTE_KEYS.has('w')).toBe(true);
    expect(NOTE_KEYS.has('y')).toBe(true);
    expect(NOTE_KEYS.has('o')).toBe(true);
  });
});
