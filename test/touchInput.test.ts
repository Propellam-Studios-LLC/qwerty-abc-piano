import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { renderPiano, updateOctaveIndicator } from '../src/ui/piano.js';
import type { Mode } from '../src/types.js';

// Touch input on the piano SVG: octave-dot taps, the octave mini-map, and
// absolute-pitch range keys.

const containers: HTMLElement[] = [];
function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

afterEach(() => {
  while (containers.length) containers.pop()!.remove();
  vi.restoreAllMocks();
});

/** Dispatches a touchstart whose point resolves to `target`. */
function touch(div: HTMLElement, target: Element): void {
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target as Element);
  const svg = div.querySelector('svg.qap-piano')!;
  const e = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'changedTouches', {
    value: [{ identifier: 1, clientX: 0, clientY: 0 }],
  });
  svg.dispatchEvent(e);
}

function makeHost(initialOctave = 0) {
  let octave = initialOctave;
  return {
    getMode: () => 'transcribe' as Mode,
    getOctave: () => octave,
    setOctave: vi.fn((s: number) => { octave = Math.max(-2, Math.min(2, s)); }),
  };
}

describe('octave dots respond to touch', () => {
  it('a tap on a dot changes the octave and adds no note', () => {
    const div  = container();
    const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false });

    const dot = div.querySelector('.qap-oct-pos[data-shift="1"]')!;
    touch(div, dot.querySelector('circle.qap-oct-hit')!);

    expect(inst.getOctave()).toBe(1);
    expect(inst.getABC()).toBe('');
  });

  it('each dot carries a 44px-wide invisible hit target', () => {
    const div = container();
    renderPiano(div, makeHost());
    const hits = div.querySelectorAll('circle.qap-oct-hit');
    expect(hits.length).toBe(5);
    expect(hits[0].getAttribute('r')).toBe('22');
  });

  it('a tap on a note key still plays and leaves the octave alone', () => {
    const div  = container();
    const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false });

    touch(div, div.querySelector('[data-key="h"]')!); // C4
    expect(inst.getOctave()).toBe(0);
    expect(inst.getABC()).toBe('C');
  });
});

describe('octave mini-map', () => {
  it('renders a strip with a middle-C tick and the current window', () => {
    const div = container();
    renderPiano(div, makeHost());
    const map = div.querySelector('.qap-oct-map')!;
    expect(map).not.toBeNull();
    expect(map.querySelector('line.qap-oct-map-middle-c')).not.toBeNull();
    expect(map.querySelector('rect.qap-oct-map-window')).not.toBeNull();
    // The default QWERTY layout's base range, kept for later window moves.
    expect(map.getAttribute('data-base-low')).toBe('52');  // E3
    expect(map.getAttribute('data-base-high')).toBe('69'); // A4
  });

  it('the window moves right when the octave shifts up, and back down again', () => {
    const div = container();
    renderPiano(div, makeHost());
    const win = () => div.querySelector('rect.qap-oct-map-window')!;
    const x0 = parseFloat(win().getAttribute('x')!);

    updateOctaveIndicator(div, 1);
    const xUp = parseFloat(win().getAttribute('x')!);
    expect(xUp).toBeGreaterThan(x0);

    updateOctaveIndicator(div, -1);
    expect(parseFloat(win().getAttribute('x')!)).toBeLessThan(x0);

    updateOctaveIndicator(div, 0);
    expect(parseFloat(win().getAttribute('x')!)).toBe(x0);
  });

  it('the window keeps its span across shifts', () => {
    const div = container();
    renderPiano(div, makeHost());
    const width = () => parseFloat(
      div.querySelector('rect.qap-oct-map-window')!.getAttribute('width')!,
    );
    const w0 = width();
    updateOctaveIndicator(div, 2);
    expect(width()).toBe(w0);
  });
});

describe('range keyboards have no octave row', () => {
  it('renders neither dots nor mini-map, and is shorter for it', () => {
    const div = container();
    renderPiano(div, makeHost(), { low: 'C4', high: 'B4' });
    expect(div.querySelectorAll('.qap-oct-pos').length).toBe(0);
    expect(div.querySelector('.qap-oct-map')).toBeNull();
    expect(div.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 460 120');
  });

  it('the default layout still renders all five dots', () => {
    const div = container();
    renderPiano(div, makeHost());
    expect(div.querySelectorAll('.qap-oct-pos').length).toBe(5);
    expect(div.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 700 150');
  });
});

describe('range-keyboard keys are absolute pitches', () => {
  it('a key labelled C4 records C4 even with a non-zero octave shift', () => {
    const div  = container();
    const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false });
    inst.setTouchKeyRange('C4', 'B4');
    inst.setOctave(1);

    touch(div, div.querySelector('[data-key="C4"]')!);
    // Uppercase C is middle C (C4). The octave shift applies only to QWERTY
    // keys; adding it here would give C5, written 'c'.
    expect(inst.getABC()).toBe('C');
  });

  it('QWERTY keys still follow the octave shift', () => {
    const div  = container();
    const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false });
    inst.setOctave(1);

    touch(div, div.querySelector('[data-key="h"]')!); // C4 + 1 octave
    expect(inst.getABC()).toBe("c");
  });
});
