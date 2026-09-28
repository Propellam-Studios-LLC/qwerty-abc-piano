import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function keydown(key: string, opts: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

function keyup(key: string) {
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

// Creates an instance and registers it for cleanup after each test
const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ autoBarline: false, ...options });
  instances.push(inst);
  return inst;
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
});

// ── Note keys ─────────────────────────────────────────────────────────────────

describe('white key → note in transcribe mode', () => {
  it('pressing H produces middle C (C)', () => {
    const inst = make();
    keydown('h');
    expect(inst.getABC()).toBe('C');
  });

  it('pressing A produces E3 (E,)', () => {
    const inst = make();
    keydown('a');
    expect(inst.getABC()).toBe('E,');
  });

  it("pressing ' produces A4 (A)", () => {
    const inst = make();
    keydown("'");
    expect(inst.getABC()).toBe('A'); // A4 is uppercase A (lowercase a is A5)
  });

  it('produces no note in play mode', () => {
    const inst = make({ defaultMode: 'play' });
    keydown('h');
    expect(inst.getABC()).toBe('');
  });
});

describe('black key → note in transcribe mode', () => {
  it('pressing E produces F#3 (^F,)', () => {
    const inst = make();
    keydown('e');
    expect(inst.getABC()).toBe('^F,');
  });

  it('pressing U produces C#4 (^C)', () => {
    const inst = make();
    keydown('u');
    expect(inst.getABC()).toBe('^C');
  });

  it('pressing [ produces G#4 (^G)', () => {
    const inst = make();
    keydown('[');
    expect(inst.getABC()).toBe('^G');
  });
});

describe('gap keys produce no note', () => {
  it.each(['w', 'o'])('gap key %s is silently ignored', (key) => {
    const inst = make();
    keydown(key);
    expect(inst.getABC()).toBe('');
  });

  it('q key starts a triplet bracket, not a note', () => {
    const inst = make();
    keydown('q');
    expect(inst.getABC()).toBe('(3');
  });
});

describe('chord-control keys are ( and )', () => {
  it('( opens and ) commits a simultaneous chord', () => {
    const inst = make();
    keydown('(');
    expect(inst.isChordOpen()).toBe(true);
    keydown('h'); // C4
    keydown('k'); // E4
    keydown(')');
    expect(inst.isChordOpen()).toBe(false);
    expect(inst.getABC()).toBe('[CE]');
  });

  it('[ is a note key (G#4), not a chord opener', () => {
    const inst = make();
    keydown('[');
    expect(inst.isChordOpen()).toBe(false);
    expect(inst.getABC()).toBe('^G');
  });
});

// ── Duration keys ─────────────────────────────────────────────────────────────

describe('duration keys', () => {
  it.each([
    ['1', 'C4'],   // whole
    ['2', 'C2'],   // half
    ['3', 'C'],    // quarter (default)
    ['4', 'C/2'],  // eighth
    ['5', 'C/4'],  // sixteenth
    ['6', 'C/8'],  // thirty-second
  ])('key %s then H → %s', (durKey, expected) => {
    const inst = make();
    keydown(durKey);
    keydown('h');
    expect(inst.getABC()).toBe(expected);
  });

  it('pressing a duration key resets the dot', () => {
    const inst = make();
    keydown('.');   // dot on
    keydown('3');   // quarter resets dot
    keydown('h');
    expect(inst.getABC()).toBe('C'); // not dotted
  });
});

describe('dot toggle (.)', () => {
  it('toggles isDotted on', () => {
    const inst = make();
    keydown('.');
    keydown('h');
    expect(inst.getABC()).toBe('C3/2'); // dotted quarter
  });

  it('pressing . twice turns dot off', () => {
    const inst = make();
    keydown('.');
    keydown('.');
    keydown('h');
    expect(inst.getABC()).toBe('C');
  });
});

// ── Octave keys ───────────────────────────────────────────────────────────────

describe('octave keys', () => {
  it('+ shifts octave up (H becomes C5)', () => {
    const inst = make();
    keydown('+');
    keydown('h');
    expect(inst.getABC()).toBe("c");
  });

  it('- shifts octave down (H becomes C3)', () => {
    const inst = make();
    keydown('-');
    keydown('h');
    expect(inst.getABC()).toBe('C,');
  });

  it('0 resets octave to default', () => {
    const inst = make();
    keydown('+');
    keydown('+');
    keydown('0');
    keydown('h');
    expect(inst.getABC()).toBe('C');
  });

  it('clamps at +2 (H stays at C6 even with more presses)', () => {
    const inst = make();
    keydown('+'); keydown('+'); keydown('+'); keydown('+');
    keydown('h');
    expect(inst.getABC()).toBe("c'");
  });

  it('clamps at -2 (H base C4, shift -2 = C2 = "C,,")', () => {
    const inst = make();
    keydown('-'); keydown('-'); keydown('-'); keydown('-');
    keydown('h');
    expect(inst.getABC()).toBe('C,,'); // C4 + (-2) = C2 = uppercase + two commas
  });
});

// ── Mode toggle (X key) ──────────────────────────────────────────────────────

describe('X key toggles mode', () => {
  it('switches from transcribe to play', () => {
    const inst = make();
    expect(inst.getMode()).toBe('transcribe');
    keydown('x');
    expect(inst.getMode()).toBe('play');
  });

  it('switches back to transcribe', () => {
    const inst = make();
    keydown('x');
    keydown('x');
    expect(inst.getMode()).toBe('transcribe');
  });

  it('does not add a note to the notation', () => {
    const inst = make();
    keydown('h');
    keydown('x');
    keydown('h');
    // Back in transcribe mode; second H should NOT have been recorded (was in play mode)
    expect(inst.getABC()).toBe('C');
  });
});

// ── Space → insert explicit space separator ───────────────────────────────────

describe('Space inserts a space separator', () => {
  it('inserts a space into the notation in transcribe mode', () => {
    const inst = make();
    keydown('h');
    keydown(' ');
    keydown('j');
    expect(inst.getABC()).toBe('C D');
  });

  it('does not insert a space in play mode', () => {
    const inst = make({ defaultMode: 'play' });
    keydown(' ');
    expect(inst.getABC()).toBe('');
  });
});

// ── Backspace / Ctrl+Z → undo ────────────────────────────────────────────────

describe('Backspace undoes last note', () => {
  it('removes the last note via Backspace', () => {
    const inst = make();
    keydown('h');
    keydown('j');
    keydown('Backspace');
    expect(inst.getABC()).toBe('C');
  });

  it('removes the last note via Ctrl+Z', () => {
    const inst = make();
    keydown('h');
    keydown('j');
    keydown('z', { ctrlKey: true });
    expect(inst.getABC()).toBe('C');
  });
});

// ── Backslash → manual barline ────────────────────────────────────────────────

describe('\\ inserts a manual barline', () => {
  it('inserts | between notes', () => {
    const inst = make();
    keydown('h');
    keydown('\\');
    keydown('j');
    expect(inst.getABC()).toBe('C| D');
  });
});

// ── Enter → playback ─────────────────────────────────────────────────────────

describe('Enter fires playback', () => {
  it('calls onPlayback callback', () => {
    const onPlayback = vi.fn();
    make({ onPlayback });
    keydown('Enter');
    expect(onPlayback).toHaveBeenCalled();
  });
});

// ── Escape → clear or onClearRequested ───────────────────────────────────────

describe('Escape', () => {
  it('calls clear() when no onClearRequested is set', () => {
    const inst = make();
    keydown('h');
    keydown('Escape');
    expect(inst.getABC()).toBe('');
  });

  it('fires onClearRequested instead of clearing when callback is provided', () => {
    const onClearRequested = vi.fn();
    const inst = make({ onClearRequested });
    keydown('h');
    keydown('Escape');
    // Callback fired, but notes NOT cleared
    expect(onClearRequested).toHaveBeenCalled();
    expect(inst.getABC()).toBe('C');
  });
});

// ── Keys in editable elements are ignored ────────────────────────────────────

describe('keys inside editable elements are ignored', () => {
  it('ignores keydown when an <input> is focused', () => {
    const inst = make();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(inst.getABC()).toBe('');
    document.body.removeChild(input);
  });

  it('ignores keydown when a <textarea> is focused', () => {
    const inst = make();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(inst.getABC()).toBe('');
    document.body.removeChild(ta);
  });
});

// ── Z key → rest ─────────────────────────────────────────────────────────────

describe('z key inserts a rest', () => {
  it('pressing z in transcribe mode adds a quarter rest', () => {
    const inst = make();
    keydown('z');
    expect(inst.getABC()).toBe('z');
  });

  it('pressing z in play mode adds no rest', () => {
    const inst = make({ defaultMode: 'play' });
    keydown('z');
    expect(inst.getABC()).toBe('');
  });

  it('rest uses the current duration', () => {
    const inst = make();
    keydown('2');   // half
    keydown('z');
    expect(inst.getABC()).toBe('z2');
  });

  it('z can be undone', () => {
    const inst = make();
    keydown('h');
    keydown('z');
    keydown('Backspace');
    expect(inst.getABC()).toBe('C');
  });
});

// ── destroy() removes listeners ───────────────────────────────────────────────

describe('destroy()', () => {
  it('stops responding to key events after destroy', () => {
    const inst = new QWERTYToABCPiano({ autoBarline: false });
    keydown('h');
    inst.destroy();
    keydown('j');
    expect(inst.getABC()).toBe('C'); // only the first note
  });
});

// ── Modifier combos are ignored (except Ctrl+Z) ──────────────────────────────

describe('modifier keys', () => {
  it('ignores Alt+key', () => {
    const inst = make();
    keydown('h', { altKey: true });
    expect(inst.getABC()).toBe('');
  });

  it('ignores Ctrl+key (other than Z)', () => {
    const inst = make();
    keydown('h', { ctrlKey: true });
    expect(inst.getABC()).toBe('');
  });
});
