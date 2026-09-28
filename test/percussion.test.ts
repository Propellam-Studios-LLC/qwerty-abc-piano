import { describe, it, expect, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

function keydown(key: string, opts: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

// Every percussion hit records B4, written 'B' in ABC (the treble staff's
// middle line, the usual snare position on a one-line percussion staff).
const PERC = 'B';

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ autoBarline: false, percussionMode: true, ...options });
  instances.push(inst);
  return inst;
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
});

describe('percussion mode — keyboard routing', () => {
  it('white key (h = C4 normally) records fixed pitch instead', () => {
    const inst = make();
    keydown('h');
    expect(inst.getABC()).toBe(PERC);
  });

  it('white key (a = E3 normally) records fixed pitch instead', () => {
    const inst = make();
    keydown('a');
    expect(inst.getABC()).toBe(PERC);
  });

  it('black key (e = F#3 normally) records fixed pitch instead', () => {
    const inst = make();
    keydown('e');
    expect(inst.getABC()).toBe(PERC);
  });

  it('gap key (w) is silently ignored as in normal mode', () => {
    const inst = make();
    keydown('w');
    expect(inst.getABC()).toBe('');
  });

  it('spacebar inserts a space token for beaming control (not a tap note)', () => {
    const inst = make();
    keydown('h');  // note B
    keydown(' ');  // beaming space
    keydown('h');  // another note B — prevents trimEnd() from swallowing the space
    expect(inst.getABC()).toBe(`${PERC} ${PERC}`);
  });

  it('three taps at default quarter duration produce three percussion notes', () => {
    const inst = make();
    keydown('h');
    keydown('a');
    keydown('s');
    expect(inst.getABC()).toBe(`${PERC}${PERC}${PERC}`);
  });
});

describe('percussion mode — tap() public method', () => {
  it('tap() records one note at the fixed pitch', () => {
    const inst = make();
    inst.tap();
    expect(inst.getABC()).toBe(PERC);
  });

  it('tap() is a no-op in normal (non-percussion) mode', () => {
    const inst = new QWERTYToABCPiano({ autoBarline: false });
    instances.push(inst);
    inst.tap();
    expect(inst.getABC()).toBe('');
  });

  it('three tap() calls produce three notes', () => {
    const inst = make();
    inst.tap();
    inst.tap();
    inst.tap();
    expect(inst.getABC()).toBe(`${PERC}${PERC}${PERC}`);
  });
});

describe('percussion mode — duration, dot, rest, undo still work', () => {
  it('duration key changes the length of percussion notes', () => {
    const inst = make();
    keydown('2'); // half note
    keydown('h');
    expect(inst.getABC()).toBe(`${PERC}2`);
  });

  it('dot toggle adds dotted suffix to percussion notes', () => {
    const inst = make();
    keydown('3'); // quarter
    keydown('.');
    keydown('h');
    expect(inst.getABC()).toBe(`${PERC}3/2`);
  });

  it('rest key (z) inserts a rest, not a percussion note', () => {
    const inst = make();
    keydown('h');
    keydown('z');
    expect(inst.getABC()).toBe(`${PERC}z`);
  });

  it('undo removes the last percussion note', () => {
    const inst = make();
    inst.tap();
    inst.tap();
    inst.undo();
    expect(inst.getABC()).toBe(PERC);
  });

  it('triplet (q key) followed by three taps produces (3 + three notes', () => {
    const inst = make();
    keydown('q');
    inst.tap();
    inst.tap();
    inst.tap();
    expect(inst.getABC()).toBe(`(3${PERC}${PERC}${PERC}`);
  });
});

describe('percussion mode — getABC returns bare note body', () => {
  it('getABC() does not include any percussion header', () => {
    const inst = make();
    inst.tap();
    const abc = inst.getABC();
    expect(abc).not.toContain('K:');
    expect(abc).not.toContain('perc');
  });
});
