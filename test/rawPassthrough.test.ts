import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

function keydown(key: string, opts: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  // Manual barlines so auto-insertion doesn't interfere with the tokens we type.
  const inst = new QWERTYToABCPiano({ barlineMode: 'manual', ...options });
  instances.push(inst);
  return inst;
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
});

describe('raw ABC passthrough — barline family', () => {
  it('typing | inserts a barline that flushes when the next note is played', () => {
    const inst = make();
    keydown('a');            // E3, written E,
    keydown('|');            // opens barline capture
    expect(inst.getABC()).toBe('E, |'); // pending token rides along in the output
    keydown('a');            // boundary → commits the barline, then plays E,
    expect(inst.getABC()).toBe('E,| E,');
  });

  it('| then : builds a repeat-start token |:', () => {
    const inst = make();
    keydown('a');
    keydown('|');
    keydown(':');
    expect(inst.getABC()).toBe('E, |:');
    keydown('a');
    expect(inst.getABC()).toBe('E,|: E,');
  });

  it(': then | then digit builds a repeat-end with a volta :|2', () => {
    const inst = make();
    keydown('a');
    keydown(':');
    keydown('|');
    keydown('2');
    expect(inst.getABC()).toBe('E, :|2');
  });

  it('a repeat barline upgrades a trailing plain barline in place', () => {
    const inst = make();
    keydown('a');            // E,
    inst.insertBarline();    // a plain barline (like the auto-inserted one) → 'E,|'
    keydown('|');            // start a repeat token
    keydown(':');            // |:
    keydown('a');            // boundary → commit the token, then play E,
    // The trailing plain barline is upgraded in place, not doubled.
    expect(inst.getABC()).toBe('E,|: E,');
  });

  it('a lone ":" is invalid and blocks the boundary key', () => {
    const inst = make();
    keydown(':');            // invalid barline token so far
    keydown('a');            // boundary — should be blocked, not played
    expect(inst.getABC()).toBe(':'); // buffer kept, no note added
  });
});

describe('raw ABC passthrough — decorations / chord symbols / grace', () => {
  it('!trill! captures its inner letters instead of playing notes', () => {
    const inst = make();
    keydown('!');
    for (const c of 'trill') keydown(c); // t/r/i/l are otherwise note/triplet keys
    keydown('!');                        // closing delimiter commits the token
    keydown('h');                        // now a real note (middle C)
    expect(inst.getABC()).toBe('!trill!C');
  });

  it('a "chord symbol" passes through and glues to the following note', () => {
    const inst = make();
    keydown('"');
    for (const c of 'Gm') keydown(c);
    keydown('"');
    keydown('h');
    expect(inst.getABC()).toBe('"Gm"C');
  });

  it('Escape cancels an in-progress token', () => {
    const inst = make();
    keydown('!');
    keydown('t');
    keydown('Escape');
    expect(inst.getABC()).toBe('');
    expect(inst.rawCaptureActive).toBe(false);
  });

  it('Backspace edits the buffer and ends capture when empty', () => {
    const inst = make();
    keydown('|');
    expect(inst.rawCaptureActive).toBe(true);
    keydown('Backspace');
    expect(inst.rawCaptureActive).toBe(false);
    expect(inst.getABC()).toBe('');
  });
});

describe('raw ABC passthrough — round-trip and callbacks', () => {
  it('setABC preserves repeats, voltas, and decorations verbatim', () => {
    const inst = make();
    inst.setABC('|: E F | G A :|2 B c |]');
    const abc = inst.getABC();
    expect(abc).toContain('|:');
    expect(abc).toContain(':|2');
    expect(abc).toContain('|]');
  });

  it('setABC round-trips a decoration attached to a note', () => {
    const inst = make();
    inst.setABC('!trill!c');
    expect(inst.getABC()).toBe('!trill!c');
  });

  it('onRawChange reports the buffer and validity while typing', () => {
    const onRawChange = vi.fn();
    const inst = make({ onRawChange });
    keydown('|');
    expect(onRawChange).toHaveBeenLastCalledWith('|', true);
    keydown('a'); // commits — buffer clears
    expect(onRawChange).toHaveBeenLastCalledWith('', true);
  });
});
