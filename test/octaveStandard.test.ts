/**
 * The ABC octave convention, checked against abcjs itself.
 *
 * Standard ABC 2.1 (and abcjs, which plays it): `C` is middle C (C4, MIDI 60),
 * `c` is C5. These tests turn the library's output into MIDI with abcjs's own
 * parser, so they can't agree with a wrong convention by accident.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import abcjs from 'abcjs';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { WHITE_KEYS, BLACK_KEYS } from '../src/keymap.js';

const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B

/** MIDI numbers abcjs sounds for a note-only ABC body, in order. */
function abcjsMidi(body: string): number[] {
  const tune = (abcjs as any).parseOnly(`X:1\nM:4/4\nL:1/4\nK:C\n${body}\n`)[0];
  const out: number[] = [];
  for (const line of tune.lines ?? []) {
    for (const staff of line.staff ?? []) {
      for (const v of staff.voices ?? []) {
        for (const el of v) {
          if (el.el_type !== 'note' || !el.pitches) continue;
          for (const p of el.pitches) {
            const step = p.pitch; // diatonic steps from middle C (C4 = 0)
            const oct = Math.floor(step / 7);
            const acc = p.accidental === 'sharp' ? 1 : p.accidental === 'flat' ? -1 : 0;
            out.push(60 + 12 * oct + LETTER_SEMIS[((step % 7) + 7) % 7] + acc);
          }
        }
      }
    }
  }
  return out;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiOf = (note: string, octave: number) => 12 * (octave + 1) + NAMES.indexOf(note);

let inst: QWERTYToABCPiano;
beforeEach(() => { inst?.destroy?.(); });

describe('standard ABC octaves (verified with abcjs)', () => {
  it('abcjs itself reads C as middle C (60) and c as C5 (72)', () => {
    expect(abcjsMidi('C c')).toEqual([60, 72]);
  });

  it('every QWERTY key writes the pitch its label names', () => {
    const keys = { ...WHITE_KEYS, ...BLACK_KEYS } as Record<string, { note: string; octave: number } | null>;
    let checked = 0;
    for (const [key, info] of Object.entries(keys)) {
      if (!info) continue; // gap keys (no note)
      inst = new QWERTYToABCPiano({});
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
      const abc = inst.getABC();
      expect(abcjsMidi(abc), `key ${key} (${info.note}${info.octave}) wrote ${abc}`)
        .toEqual([midiOf(info.note, info.octave)]);
      inst.destroy();
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('a MIDI keyboard is transcribed at its real pitch, across the range', () => {
    inst = new QWERTYToABCPiano({});
    const played = [36, 48, 55, 60, 61, 64, 69, 71, 72, 84, 96];
    for (const n of played) inst.noteOnFromMidi(n);
    expect(abcjsMidi(inst.getABC().replace(/\|/g, ' '))).toEqual(played);
  });

  it('octaveShift starts the keys an octave up (H = C5)', () => {
    inst = new QWERTYToABCPiano({ octaveShift: 1 });
    expect(inst.getOctave()).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(inst.getABC()).toBe('c');
    expect(abcjsMidi(inst.getABC())).toEqual([72]);
  });

  it('octaveShift is clamped to −2…+2', () => {
    expect(new QWERTYToABCPiano({ octaveShift: 9 }).getOctave()).toBe(2);
    expect(new QWERTYToABCPiano({ octaveShift: -9 }).getOctave()).toBe(-2);
  });

  it('setABC reads standard octaves back (a round trip keeps the pitches)', () => {
    inst = new QWERTYToABCPiano({});
    inst.setABC("C,, C, C c c' c''");
    expect(abcjsMidi(inst.getABC())).toEqual([36, 48, 60, 72, 84, 96]);
  });
});
