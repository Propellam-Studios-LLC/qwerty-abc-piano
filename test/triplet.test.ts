import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ autoBarline: false, ...options });
  instances.push(inst);
  return inst;
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  vi.restoreAllMocks();
});

function keydown(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

// ── Q key: triplet start ──────────────────────────────────────────────────────

describe('Q key inserts triplet-start', () => {
  it('pressing Q in transcribe mode outputs (3', () => {
    const inst = make();
    keydown('q');
    // Just the tuplet marker — no notes yet
    expect(inst.getABC()).toBe('(3');
  });

  it('Q + 3 notes produces (3 prefix in ABC', () => {
    const inst = make();
    keydown('q');  // tuplet-start
    keydown('h');  // C4 (C)
    keydown('j');  // D4 (D)
    keydown('k');  // E4 (E)
    expect(inst.getABC()).toBe('(3CDE');
  });

  it('Q + 3 eighth notes produces (3C/2D/2E/2', () => {
    const inst = make();
    keydown('4'); // eighth duration
    keydown('q');
    keydown('h');
    keydown('j');
    keydown('k');
    expect(inst.getABC()).toBe('(3C/2D/2E/2');
  });
});

// ── Triplet closes after 3 notes ─────────────────────────────────────────────

describe('triplet auto-closes after 3 notes', () => {
  it('note entered after triplet is outside the bracket', () => {
    const inst = make();
    keydown('q');
    keydown('h'); // 1st
    keydown('j'); // 2nd
    keydown('k'); // 3rd — closes triplet
    keydown('l'); // F4 (F) — normal note, outside triplet
    expect(inst.getABC()).toBe('(3CDEF');
  });

  it('can start a second triplet after the first closes', () => {
    const inst = make();
    keydown('q');
    keydown('h'); keydown('j'); keydown('k'); // first triplet
    keydown('q');
    keydown('h'); keydown('j'); keydown('k'); // second triplet
    expect(inst.getABC()).toBe('(3CDE(3CDE');
  });
});

// ── Q key ignored while triplet in progress ───────────────────────────────────

describe('Q key ignored while triplet is open', () => {
  it('pressing Q again mid-triplet does not nest triplets', () => {
    const inst = make();
    keydown('q');
    keydown('h'); // 1st note
    keydown('q'); // should be ignored — already in a triplet
    keydown('j'); // 2nd note
    keydown('k'); // 3rd note — closes the first triplet
    expect(inst.getABC()).toBe('(3CDE');
  });
});

// ── onTupletChange callback ───────────────────────────────────────────────────

describe('onTupletChange callback', () => {
  it('fires with (true, 3) when Q is pressed', () => {
    const cb = vi.fn();
    make({ onTupletChange: cb });
    keydown('q');
    expect(cb).toHaveBeenCalledWith(true, 3);
  });

  it('fires with (true, 2) after first triplet note', () => {
    const cb = vi.fn();
    make({ onTupletChange: cb });
    keydown('q');
    keydown('h');
    expect(cb).toHaveBeenLastCalledWith(true, 2);
  });

  it('fires with (true, 1) after second triplet note', () => {
    const cb = vi.fn();
    make({ onTupletChange: cb });
    keydown('q');
    keydown('h');
    keydown('j');
    expect(cb).toHaveBeenLastCalledWith(true, 1);
  });

  it('fires with (false, 0) after third triplet note', () => {
    const cb = vi.fn();
    make({ onTupletChange: cb });
    keydown('q');
    keydown('h'); keydown('j'); keydown('k');
    expect(cb).toHaveBeenLastCalledWith(false, 0);
  });
});

// ── Triplet indicator element ─────────────────────────────────────────────────

describe('tupletTarget indicator element', () => {
  it('shows TRIPLET (3 left) after Q press', () => {
    const el = document.createElement('div');
    make({ tupletTarget: el });
    keydown('q');
    expect(el.textContent).toBe('TRIPLET (3 left)');
  });

  it('counts down as notes are added', () => {
    const el = document.createElement('div');
    make({ tupletTarget: el });
    keydown('q');
    keydown('h');
    expect(el.textContent).toBe('TRIPLET (2 left)');
    keydown('j');
    expect(el.textContent).toBe('TRIPLET (1 left)');
  });

  it('shows TRIPLET (Q) (button label) after the third note', () => {
    const el = document.createElement('div');
    make({ tupletTarget: el });
    keydown('q');
    keydown('h'); keydown('j'); keydown('k');
    expect(el.textContent).toBe('TRIPLET (Q)');
  });
});

// ── Undo with triplets ────────────────────────────────────────────────────────

describe('undo with triplets', () => {
  it('undoing the Q press removes the tuplet-start entry', () => {
    const inst = make();
    keydown('q');
    expect(inst.getABC()).toBe('(3');
    keydown('Backspace');
    expect(inst.getABC()).toBe('');
  });

  it('undoing first triplet note restores remaining=3 in callback', () => {
    const cb = vi.fn();
    const inst = make({ onTupletChange: cb });
    keydown('q');
    keydown('h'); // remaining becomes 2
    keydown('Backspace'); // undo note → remaining becomes 3 again
    expect(cb).toHaveBeenLastCalledWith(true, 3);
    expect(inst.getABC()).toBe('(3');
  });

  it('undoing the tuplet-start fires (false, 0)', () => {
    const cb = vi.fn();
    make({ onTupletChange: cb });
    keydown('q');
    keydown('Backspace'); // undo the tuplet-start
    expect(cb).toHaveBeenLastCalledWith(false, 0);
  });
});

// ── DOM event dispatch ────────────────────────────────────────────────────────

describe('qwerty-abc-piano:tuplet-change custom event', () => {
  it('is dispatched when Q is pressed', () => {
    make();
    const received: CustomEvent[] = [];
    document.addEventListener('qwerty-abc-piano:tuplet-change', (e) => {
      received.push(e as CustomEvent);
    });
    keydown('q');
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].detail).toEqual({ active: true, remaining: 3 });
  });
});

// ── Beat counting with triplets ───────────────────────────────────────────────

describe('beat counting: triplet notes use 2/3 of their face value', () => {
  it('three quarter-note triplets = 2 beats total (auto-barlines in 2/4)', () => {
    // In 2/4, beatsPerMeasure = 2.
    // Three quarter-note triplets = 3 × (1 × 2/3) = 2 beats → exactly fills the bar.
    const inst = new QWERTYToABCPiano({
      timeSignature: '2/4',
      barlineMode: 'auto',
    });
    instances.push(inst);
    keydown('q');
    keydown('h'); // C4 quarter
    keydown('j'); // D4 quarter
    keydown('k'); // E4 quarter → triplet closes; 2 beats filled → auto-barline
    // Should have a barline after the triplet
    expect(inst.getABC()).toContain('|');
  });

  it('three eighth-note triplets = 1 beat total', () => {
    // In 4/4 with no barlines, 3 eighth-note triplets = 3 × (0.5 × 2/3) = 1 beat.
    // Then adding 3 quarter notes should fill the remaining 3 beats without extra barlines.
    const inst = new QWERTYToABCPiano({
      timeSignature: '4/4',
      barlineMode: 'manual',
    });
    instances.push(inst);
    keydown('4'); // eighth
    keydown('q');
    keydown('h'); keydown('j'); keydown('k'); // triplet = 1 beat
    keydown('3'); // quarter
    keydown('h'); keydown('j'); keydown('k'); // 3 more beats
    // 1 + 3 = 4 beats → no auto-barline inserted
    expect(inst.getABC()).not.toContain('|');
  });
});

// ── setABC round-trip ─────────────────────────────────────────────────────────

describe('setABC round-trip with tuplets', () => {
  it('parses (3cde back into notes', () => {
    const inst = make();
    inst.setABC('(3cde');
    expect(inst.getABC()).toBe('(3cde');
  });

  it('parses (3c/2d/2e/2 correctly', () => {
    const inst = make();
    inst.setABC('(3c/2d/2e/2');
    expect(inst.getABC()).toBe('(3c/2d/2e/2');
  });

  it('tuplet-change fires (false, 0) after setABC with a complete triplet', () => {
    const cb = vi.fn();
    const inst = make({ onTupletChange: cb });
    inst.setABC('(3cde');
    // After setABC, triplet is complete → remaining = 0, not active
    expect(cb).toHaveBeenLastCalledWith(false, 0);
  });
});

// ── Q key ignored in play mode ────────────────────────────────────────────────

describe('Q key ignored in play mode', () => {
  it('does not insert a tuplet-start when in play mode', () => {
    const inst = make({ defaultMode: 'play' });
    keydown('q');
    expect(inst.getABC()).toBe('');
  });
});
