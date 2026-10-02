/**
 * Accidentals within a bar, checked by what abcjs actually plays.
 *
 * In ABC an accidental lasts to the end of the bar for later notes of the same
 * letter and octave. So after `^d`, a D natural in the same bar must be written
 * `=d`, or it sounds as D#. These tests read the output back through abcjs's
 * own playback sequencer, which applies the key signature and the bar's
 * accidentals, and compare the sounding pitches with what was played.
 */
import { describe, it, expect, afterEach } from 'vitest';
import abcjs from 'abcjs';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

const instances: QWERTYToABCPiano[] = [];
afterEach(() => { while (instances.length) instances.pop()!.destroy(); });

function piano(opts: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const p = new QWERTYToABCPiano(opts);
  instances.push(p);
  return p;
}

/** MIDI pitches abcjs sounds for a complete ABC tune, in order. */
function sounding(fullAbc: string): number[] {
  const tune = (abcjs as any).parseOnly(fullAbc)[0];
  const audio = tune.setUpAudio({});
  const out: number[] = [];
  for (const track of audio.tracks) {
    for (const ev of track) if (ev.cmd === 'note') out.push(ev.pitch);
  }
  return out;
}

function playMidi(p: QWERTYToABCPiano, notes: number[]) {
  for (const n of notes) p.noteOnFromMidi(n);
}

describe('accidentals carry through the bar', () => {
  it('abcjs carries an accidental to later notes of the same letter and octave only', () => {
    expect(sounding("X:1\nL:1/4\nK:C\n^c c c, c'\n")).toEqual([73, 73, 60, 84]);
  });

  it.each([
    ['G', [76, 75, 74, 73, 77]],
    ['G', [62, 63, 62, 61, 62]],
    ['A', [76, 75, 74, 73, 77]],
  ])('a chromatic run in %s sounds as played: %j', (key, played) => {
    const p = piano({ keySignature: key });
    playMidi(p, played);
    expect(sounding(p.getFullABC())).toEqual(played);
  });

  it('a natural after a sharp in the same bar is written with =', () => {
    const p = piano({ keySignature: 'G', barlineMode: 'manual' });
    playMidi(p, [75, 74]);
    expect(p.getABC()).toBe('^d=d');
  });

  it('a sharp after a natural in a sharp key is written with ^ again', () => {
    const p = piano({ keySignature: 'G', barlineMode: 'manual' });
    playMidi(p, [65, 66, 66]);
    expect(p.getABC()).toBe('=F^FF');
    expect(sounding(p.getFullABC())).toEqual([65, 66, 66]);
  });

  it('a flat after a natural in a flat key is written with _', () => {
    const p = piano({ keySignature: 'Bb', barlineMode: 'manual' });
    playMidi(p, [71, 70, 70]);
    expect(p.getABC()).toBe('=B_BB');
    expect(sounding(p.getFullABC())).toEqual([71, 70, 70]);
  });

  it('a repeated accidental is written once', () => {
    const p = piano({ barlineMode: 'manual' });
    playMidi(p, [61, 61, 61]);
    expect(p.getABC()).toBe('^CCC');
  });

  it('a barline resets the accidentals', () => {
    const p = piano({ barlineMode: 'manual' });
    p.noteOnFromMidi(63);
    p.insertBarline();
    p.noteOnFromMidi(62);
    p.noteOnFromMidi(63);
    expect(p.getABC()).toBe('^D| D^D');
    expect(sounding(p.getFullABC())).toEqual([63, 62, 63]);
  });

  it('another octave of the same letter is not affected', () => {
    const p = piano({ barlineMode: 'manual' });
    playMidi(p, [63, 74, 62]);
    expect(p.getABC()).toBe("^Dd=D");
    expect(sounding(p.getFullABC())).toEqual([63, 74, 62]);
  });

  it.each([
    ['K:C', '^c =c c [^ce] =c'],
    ['K:G', 'F =F F ^F | f =f'],
    ['K:Bb', 'B =B _B B | e =e e'],
    ['K:D', '[^cf] =c [=f^g] f'],
  ])('a body read with setABC is written back sounding the same (%s %s)', (key, body) => {
    const p = piano({ keySignature: key.slice(2) });
    const header = `X:1\nM:4/4\nL:1/4\n${key}\n`;
    const before = sounding(`${header}${body}\n`);
    p.setABC(body);
    expect(sounding(p.getFullABC())).toEqual(before);
  });

  it('random chromatic phrases in eight keys sound exactly as played', () => {
    let seed = 526;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let phrases = 0;
    for (const key of ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb']) {
      for (let i = 0; i < 40; i++) {
        const p = piano({ keySignature: key });
        const played: number[] = [];
        let n = 60 + Math.floor(rand() * 12);
        for (let j = 0; j < 12; j++) {
          n = Math.max(48, Math.min(84, n + Math.floor(rand() * 5) - 2)); // small steps: many chromatic neighbours
          played.push(n);
        }
        playMidi(p, played);
        expect(sounding(p.getFullABC()), `${key}: ${p.getABC()}`).toEqual(played);
        p.destroy();
        instances.pop();
        phrases++;
      }
    }
    expect(phrases).toBe(320);
  });
});
