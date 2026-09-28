import { describe, it, expect, vi } from 'vitest';
import {
  renderPiano, highlightKey, unhighlightKey,
  updateOctaveIndicator, updatePianoMode,
} from '../src/ui/piano.js';
import type { Mode } from '../src/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeHost(initialMode: Mode = 'transcribe', initialOctave = 0) {
  let mode: Mode = initialMode;
  let octave     = initialOctave;
  return {
    getMode:   () => mode,
    getOctave: () => octave,
    setOctave: vi.fn((shift: number) => { octave = Math.max(-2, Math.min(2, shift)); }),
  };
}

// ── renderPiano structure ─────────────────────────────────────────────────────

describe('renderPiano structure', () => {
  it('creates an SVG element inside the target', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelector('svg')).not.toBeNull();
  });

  it('SVG has class qap-piano', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelector('svg')!.classList.contains('qap-piano')).toBe(true);
  });

  it('SVG has viewBox="0 0 700 150"', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 700 150');
  });

  it('renders 11 white key rects', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelectorAll('rect.qap-key-white').length).toBe(11);
  });

  it('renders 7 black key rects', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelectorAll('rect.qap-key-black').length).toBe(7);
  });

  it('all white keys have data-key attributes', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    const expected = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"];
    for (const key of expected) {
      expect(div.querySelector(`rect.qap-key-white[data-key="${key}"]`),
        `white key "${key}" missing`).not.toBeNull();
    }
  });

  it('all black keys have data-key attributes', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    const expected = ['e', 'r', 't', 'u', 'i', 'p', '['];
    for (const key of expected) {
      expect(div.querySelector(`rect.qap-key-black[data-key="${key}"]`),
        `black key "${key}" missing`).not.toBeNull();
    }
  });

  it('gap keys q, w, y, o are not rendered', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelector('[data-key="q"]')).toBeNull();
    expect(div.querySelector('[data-key="w"]')).toBeNull();
    expect(div.querySelector('[data-key="y"]')).toBeNull();
    expect(div.querySelector('[data-key="o"]')).toBeNull();
  });

  it('renders 5 octave-indicator positions', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(div.querySelectorAll('.qap-oct-pos').length).toBe(5);
  });

  it('shift 0 is the initial active octave position', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    const active = div.querySelector('.qap-oct-pos.active');
    expect(active?.getAttribute('data-shift')).toBe('0');
  });

  it('non-zero initial octave sets correct active position', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost('transcribe', 1));
    const active = div.querySelector('.qap-oct-pos.active');
    expect(active?.getAttribute('data-shift')).toBe('1');
  });

  it('active octave position shows ● label', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    const active = div.querySelector('.qap-oct-pos.active');
    expect(active?.querySelector('text')?.textContent).toBe('●');
  });

  it('inactive octave positions show their shift number', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    const pos = div.querySelector<SVGElement>('.qap-oct-pos[data-shift="-2"]')!;
    expect(pos.classList.contains('active')).toBe(false);
    expect(pos.querySelector('text')?.textContent).toBe('-2');
  });

  it('sets data-mode attribute from host', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost('play'));
    expect(div.querySelector('svg')!.getAttribute('data-mode')).toBe('play');
  });
});

// ── Custom SVG passthrough ────────────────────────────────────────────────────

describe('custom SVG passthrough', () => {
  it('skips rendering if target has an <svg> with data-key elements', () => {
    const div    = document.createElement('div');
    const custom = document.createElementNS(SVG_NS, 'svg');
    const rect   = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('data-key', 'h');
    custom.appendChild(rect);
    div.appendChild(custom);

    const returned = renderPiano(div, makeHost());
    expect(returned).toBe(custom);
    expect(div.querySelectorAll('svg').length).toBe(1);
  });
});

// ── Octave position click ─────────────────────────────────────────────────────

describe('octave position click', () => {
  it('clicking a position calls host.setOctave with the correct shift', () => {
    const div  = document.createElement('div');
    const host = makeHost();
    renderPiano(div, host);
    (div.querySelector<SVGElement>('[data-shift="-1"]') as SVGElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(host.setOctave).toHaveBeenCalledWith(-1);
  });

  it('clicking +2 position calls setOctave(2)', () => {
    const div  = document.createElement('div');
    const host = makeHost();
    renderPiano(div, host);
    (div.querySelector<SVGElement>('[data-shift="2"]') as SVGElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(host.setOctave).toHaveBeenCalledWith(2);
  });
});

// ── highlightKey / unhighlightKey ─────────────────────────────────────────────

describe('highlightKey', () => {
  it('adds active class to the matching key element', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    highlightKey(div, 'h');
    expect(div.querySelector('[data-key="h"]')!.classList.contains('active')).toBe(true);
  });

  it('works for black keys', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    highlightKey(div, 'e');
    expect(div.querySelector('[data-key="e"]')!.classList.contains('active')).toBe(true);
  });

  it('is a no-op for unknown keys', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(() => highlightKey(div, 'x')).not.toThrow();
  });

  it('is a no-op when no SVG is present', () => {
    const div = document.createElement('div');
    expect(() => highlightKey(div, 'h')).not.toThrow();
  });
});

describe('unhighlightKey', () => {
  it('removes active class from a highlighted key', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    highlightKey(div, 'h');
    unhighlightKey(div, 'h');
    expect(div.querySelector('[data-key="h"]')!.classList.contains('active')).toBe(false);
  });

  it('is a no-op for a key that is not active', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    expect(() => unhighlightKey(div, 'h')).not.toThrow();
    expect(div.querySelector('[data-key="h"]')!.classList.contains('active')).toBe(false);
  });
});

// ── updateOctaveIndicator ─────────────────────────────────────────────────────

describe('updateOctaveIndicator', () => {
  it('marks the correct position active', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    updateOctaveIndicator(div, 1);
    const active = div.querySelector('.qap-oct-pos.active');
    expect(active?.getAttribute('data-shift')).toBe('1');
  });

  it('exactly one position is active after update', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    updateOctaveIndicator(div, -2);
    expect(div.querySelectorAll('.qap-oct-pos.active').length).toBe(1);
  });

  it('updates the ● label to the newly active position', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());
    updateOctaveIndicator(div, 2);
    const active = div.querySelector('.qap-oct-pos.active');
    expect(active?.querySelector('text')?.textContent).toBe('●');
  });

  it('previously active position shows its number after update', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost());   // default shift=0 is active
    updateOctaveIndicator(div, 1);
    const zeroPosText = div.querySelector<SVGElement>('[data-shift="0"]')?.querySelector('text');
    expect(zeroPosText?.textContent).toBe('0');
  });

  it('is a no-op when no SVG is present', () => {
    const div = document.createElement('div');
    expect(() => updateOctaveIndicator(div, 0)).not.toThrow();
  });
});

// ── updatePianoMode ───────────────────────────────────────────────────────────

describe('updatePianoMode', () => {
  it('sets data-mode to play', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost('transcribe'));
    updatePianoMode(div, 'play');
    expect(div.querySelector('svg')!.getAttribute('data-mode')).toBe('play');
  });

  it('sets data-mode to transcribe', () => {
    const div = document.createElement('div');
    renderPiano(div, makeHost('play'));
    updatePianoMode(div, 'transcribe');
    expect(div.querySelector('svg')!.getAttribute('data-mode')).toBe('transcribe');
  });

  it('is a no-op when no SVG is present', () => {
    const div = document.createElement('div');
    expect(() => updatePianoMode(div, 'play')).not.toThrow();
  });
});
