import { describe, it, expect, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import { keyForPitch, pitchForKey, CONTROL_KEYS } from '../src/keymap.js';

// qwertyAnchor: 'C4' starts the home row on middle C (A = C4). The default
// 'E3' layout is unchanged.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const div = container();
  const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false, barlineMode: 'none', ...options });
  instances.push(inst);
  return { inst, div };
}

function press(k: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
});

const ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"];
const UPPER = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '['];

describe("the default 'E3' layout is unchanged", () => {
  it('maps every key as before (H = C4)', () => {
    expect(Object.fromEntries([...ROW, ...UPPER].map(k => [k, pitchForKey(k)]))).toEqual({
      a: 'E3', s: 'F3', d: 'G3', f: 'A3', g: 'B3', h: 'C4', j: 'D4', k: 'E4', l: 'F4', ';': 'G4', "'": 'A4',
      q: null, w: null, e: 'F#3', r: 'G#3', t: 'A#3', y: null, u: 'C#4', i: 'D#4', o: null, p: 'F#4', '[': 'G#4',
    });
  });

  it('types the home row as E, F, G … in ABC', () => {
    const { inst } = make();
    for (const k of ROW) press(k);
    expect(inst.getABC()).toBe('E,F,G,A,B,CDEFGA');
  });
});

describe("qwertyAnchor: 'C4'", () => {
  it('maps the full layout, black keys and gaps included', () => {
    expect(Object.fromEntries([...ROW, ...UPPER].map(k => [k, pitchForKey(k, 'C4')]))).toEqual({
      a: 'C4', s: 'D4', d: 'E4', f: 'F4', g: 'G4', h: 'A4', j: 'B4', k: 'C5', l: 'D5', ';': 'E5', "'": 'F5',
      q: null, w: 'C#4', e: 'D#4', r: null, t: 'F#4', y: 'G#4', u: 'A#4', i: null, o: 'C#5', p: 'D#5', '[': null,
    });
  });

  it('types C D E F G A B c d e f', () => {
    const { inst } = make({ qwertyAnchor: 'C4' });
    for (const k of ROW) press(k);
    expect(inst.getABC()).toBe('CDEFGABcdef');
  });

  it('types the black keys as sharps, and the gaps write nothing', () => {
    const { inst } = make({ qwertyAnchor: 'C4' });
    for (const k of ['w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[']) press(k);
    expect(inst.getABC()).toBe('^C^D^F^G^A^c^d');
  });

  it('composes with the octave shift', () => {
    const { inst } = make({ qwertyAnchor: 'C4', octaveShift: 1 });
    press('a'); press('w');
    inst.setOctave(-1);
    press('a');
    expect(inst.getABC()).toBe("c^cC,");
    expect(pitchForKey('a', 'C4', -1)).toBe('C3');
  });

  it('keyForPitch is the inverse of pitchForKey', () => {
    for (const shift of [-1, 0, 1]) {
      for (const k of [...ROW, ...UPPER]) {
        const pitch = pitchForKey(k, 'C4', shift);
        if (pitch) expect(keyForPitch(pitch, 'C4', shift)).toBe(k);
      }
    }
    expect(keyForPitch('C4', 'C4')).toBe('a');
    expect(keyForPitch('Eb4', 'C4')).toBe('e');
    expect(keyForPitch('G5', 'C4')).toBeNull();
    expect(keyForPitch('C4', 'E3')).toBe('h');
    expect(() => keyForPitch('Q4')).toThrow(/invalid pitch/);
  });

  it('no note key collides with a control key', () => {
    for (const k of [...ROW, ...UPPER]) {
      if (pitchForKey(k, 'C4')) expect(CONTROL_KEYS.has(k), k).toBe(false);
    }
  });

  it('draws the keyboard for the anchor', () => {
    const { div } = make({ qwertyAnchor: 'C4' });
    const notes = [...div.querySelectorAll('rect.qap-key-white')].map(r => r.getAttribute('data-note'));
    expect(notes).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F']);
    const black = [...div.querySelectorAll('rect.qap-key-black')].map(r => r.getAttribute('data-key'));
    expect(black).toEqual(['w', 'e', 't', 'y', 'u', 'o', 'p']);
    // C#4 (W) sits between C4 (A, x=20) and D4 (S, x=80): its centre is x=80.
    const w = div.querySelector('rect[data-key="w"]')!;
    expect(Number(w.getAttribute('x')) + 18).toBe(80);
  });

  it('the octave mini-map window covers C4–F5', () => {
    const { div: e3 } = make();
    const { inst, div: c4 } = make({ qwertyAnchor: 'C4' });
    const win = (d: HTMLElement) => d.querySelector('rect.qap-oct-map-window')!;
    const map = c4.querySelector('.qap-oct-map')!;
    expect(map.getAttribute('data-base-low')).toBe('60');
    expect(map.getAttribute('data-base-high')).toBe('77');
    // C4 starts 5 white keys (E3 F3 G3 A3 B3, 20px) to the right of E3's start.
    expect(Number(win(c4).getAttribute('x')) - Number(win(e3).getAttribute('x'))).toBe(20);
    const x0 = Number(win(c4).getAttribute('x'));
    inst.setOctave(1);
    expect(Number(win(c4).getAttribute('x')) - x0).toBe(28); // one octave = 7 white keys × 4px
  });

  it('rejects an unknown anchor', () => {
    expect(() => make({ qwertyAnchor: 'D4' as never })).toThrow(/qwertyAnchor/);
  });
});

describe('the help table follows the anchor', () => {
  function helpText(div: HTMLElement): string {
    return [...div.querySelectorAll('.qap-help-shortcuts dt, .qap-help-shortcuts dd')]
      .slice(0, 4).map(e => e.textContent).join(' | ');
  }

  it('default layout', () => {
    const div = container();
    instances.push(mountFullUI(div, {}));
    expect(helpText(div)).toBe("A S D F G H J K L ; ' | White keys, E3 to A4 (H is middle C) | E R T U I P [ | Black keys");
  });

  it('C4 anchor', () => {
    const div = container();
    instances.push(mountFullUI(div, { qwertyAnchor: 'C4' }));
    expect(helpText(div)).toBe("A S D F G H J K L ; ' | White keys, C4 to F5 (A is middle C) | W E T Y U O P | Black keys");
  });

  it('C4 anchor with an octave shift', () => {
    const div = container();
    instances.push(mountFullUI(div, { qwertyAnchor: 'C4', octaveShift: 1 }));
    expect(helpText(div)).toContain('White keys, C5 to F6 (A is C5)');
  });
});
