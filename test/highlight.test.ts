import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// highlightPitches / clearHighlight: a playback highlight that is separate from
// the pressed-key colour, follows pitches across re-renders and octave shifts,
// and reports the pitches the drawn board does not show.

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
  const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false, ...options });
  instances.push(inst);
  return { inst, div };
}

function highlighted(div: HTMLElement): string[] {
  return [...div.querySelectorAll('.qap-key-highlight')].map(e => e.getAttribute('data-key')!);
}

function setTouch(on: boolean): void {
  if (on) {
    (window as unknown as { ontouchstart?: unknown }).ontouchstart = null;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  } else {
    delete (window as unknown as { ontouchstart?: unknown }).ontouchstart;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  }
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
  setTouch(false);
  vi.unstubAllGlobals();
});

describe('highlightPitches on the QWERTY layout', () => {
  it('lights the key that plays the pitch (H is C4 on the default layout)', () => {
    const { inst, div } = make();
    expect(inst.highlightPitches(['C4'])).toEqual([]);
    expect(highlighted(div)).toEqual(['h']);
  });

  it('lights A for C4 on the C4-anchored layout', () => {
    const { inst, div } = make({ qwertyAnchor: 'C4' });
    inst.highlightPitches(['C4', 'C#4']);
    expect(highlighted(div).sort()).toEqual(['a', 'w']);
  });

  it('replaces the previous highlight', () => {
    const { inst, div } = make();
    inst.highlightPitches(['C4', 'E4', 'G4']);
    expect(highlighted(div).sort()).toEqual([';', 'h', 'k']);
    inst.highlightPitches(['D4']);
    expect(highlighted(div)).toEqual(['j']);
  });

  it('returns the pitches that are not on the drawn board', () => {
    const { inst, div } = make();
    expect(inst.highlightPitches(['C4', 'C6', 'D2'])).toEqual(['C6', 'D2']);
    expect(highlighted(div)).toEqual(['h']);
  });

  it('accepts flats', () => {
    const { inst, div } = make();
    inst.highlightPitches(['Bb3']); // = A#3, the T key
    expect(highlighted(div)).toEqual(['t']);
  });

  it('throws on a string that is not a pitch, and keeps the old highlight', () => {
    const { inst, div } = make();
    inst.highlightPitches(['C4']);
    expect(() => inst.highlightPitches(['H4'])).toThrow(/invalid pitch/);
    expect(highlighted(div)).toEqual(['h']);
  });

  it('follows the pitch across an octave shift', () => {
    const { inst, div } = make();
    expect(inst.highlightPitches(['C5'])).toEqual(['C5']); // off the E3–A4 board
    expect(highlighted(div)).toEqual([]);
    inst.setOctave(1);
    expect(highlighted(div)).toEqual(['h']);
    inst.setOctave(0);
    expect(highlighted(div)).toEqual([]);
  });

  it('clearHighlight removes it', () => {
    const { inst, div } = make();
    inst.highlightPitches(['C4', 'D4']);
    inst.clearHighlight();
    expect(highlighted(div)).toEqual([]);
  });

  it('is independent of the pressed-key `active` class', () => {
    const { inst, div } = make({ defaultMode: 'play' });
    inst.highlightPitches(['C4']);
    const h = div.querySelector('[data-key="h"]')!;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(h.classList.contains('active')).toBe(true);
    expect(h.classList.contains('qap-key-highlight')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'h', bubbles: true }));
    expect(h.classList.contains('active')).toBe(false);
    expect(h.classList.contains('qap-key-highlight')).toBe(true);
  });

  it('returns every pitch when there is no piano', () => {
    const inst = new QWERTYToABCPiano();
    instances.push(inst);
    expect(inst.highlightPitches(['C4'])).toEqual(['C4']);
  });
});

describe('highlightPitches on a range keyboard', () => {
  it('lights the key named by the pitch', () => {
    const { inst, div } = make();
    inst.setTouchKeyRange('C4', 'B4');
    inst.highlightPitches(['E4', 'F#4']);
    expect(highlighted(div).sort()).toEqual(['E4', 'F#4']);
  });

  it('survives setTouchKeyRange re-renders', () => {
    const { inst, div } = make();
    inst.setTouchKeyRange('C4', 'B4');
    inst.highlightPitches(['E4', 'E3']);
    expect(highlighted(div)).toEqual(['E4']);
    inst.setTouchKeyRange('C3', 'B4');
    expect(highlighted(div).sort()).toEqual(['E3', 'E4']);
  });

  it('survives the mount\'s octave stepper', () => {
    setTouch(true);
    const div = container();
    Object.defineProperty(div, 'clientWidth', { value: 390, configurable: true });
    const piano = mountFullUI(div, {});
    instances.push(piano);
    expect(piano.highlightPitches(['E4', 'E5'])).toEqual(['E5']);
    (div.querySelectorAll<HTMLButtonElement>('.qap-oct-shift')[1]).click(); // C5–B5
    expect(highlighted(div)).toEqual(['E5']);
  });

  it('survives the resize re-pick', () => {
    let fire: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { fire = cb; }
      observe(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    });
    setTouch(true);
    const div = container();
    let width = 1000;
    Object.defineProperty(div, 'clientWidth', { get: () => width, configurable: true });
    const piano = mountFullUI(div, {});
    instances.push(piano);
    piano.highlightPitches(['E4']);
    expect(div.querySelectorAll('rect.qap-key-white').length).toBe(14);
    width = 390;
    fire!();
    expect(div.querySelectorAll('rect.qap-key-white').length).toBe(7);
    expect(highlighted(div)).toEqual(['E4']);
  });
});
