import { describe, it, expect, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// Suppressible chrome: a host that only cares about pitch can drop the
// duration palette, TRIPLET, the transport and the "power tools" (Advanced +
// the MIDI icon). Every flag defaults to true, so a consumer that passes none
// of them gets the full UI.
//
// The undo + clear pair is the exception: it renders in EVERY configuration,
// because a phone has no Backspace key to delete with.

const containers: HTMLElement[] = [];

function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

afterEach(() => {
  while (containers.length) containers.pop()!.remove();
});

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function has(div: HTMLElement, selector: string): boolean {
  return div.querySelector(selector) !== null;
}

describe('chrome flags default to showing every control', () => {
  it('a mount that passes no flags renders every control', () => {
    const div = container();
    mountFullUI(div, {});
    expect(has(div, '.qap-dur-row'), 'duration row').toBe(true);
    expect(has(div, '.qap-triplet-wrap'), 'tuplet').toBe(true);
    expect(has(div, '.qap-playback-wrap'), 'transport').toBe(true);
    expect(has(div, '.qap-adv-toggle'), 'Advanced toggle').toBe(true);
    expect(has(div, '.qap-adv-panel'), 'Advanced panel').toBe(true);
    expect(has(div, '.qap-midi-indicator'), 'MIDI icon').toBe(true);
    expect(has(div, '.qap-help-toggle'), 'help toggle').toBe(true);
  });

  it('each flag suppresses only its own control', () => {
    const div = container();
    mountFullUI(div, { showDurations: false });
    expect(has(div, '.qap-dur-row')).toBe(false);
    // The tuplet control is a separate flag — not swept along with durations.
    expect(has(div, '.qap-triplet-wrap')).toBe(true);
    expect(has(div, '.qap-playback-wrap')).toBe(true);
  });

  it('showAdvanced:false removes the toggle, the panel and the MIDI icon', () => {
    const div = container();
    mountFullUI(div, { showAdvanced: false });
    // Help is independent of the power tools.
    expect(has(div, '.qap-help-toggle')).toBe(true);
    expect(has(div, '.qap-adv-toggle')).toBe(false);
    expect(has(div, '.qap-adv-panel')).toBe(false);
    expect(has(div, '.qap-midi-indicator')).toBe(false);
  });

  it('a minimal pitch-only mount keeps the keyboard, readout and chord button', () => {
    const div = container();
    mountFullUI(div, {
      showNotation: false, letterReadout: true, compactChrome: true,
      showDurations: false, showTuplet: false,
      showTransport: false, showAdvanced: false,
    });
    // Gone: none of these controls changes which pitches are entered, so a
    // pitch-only host has no use for them.
    for (const gone of [
      '.qap-dur-row', '.qap-triplet-wrap', '.qap-playback-wrap',
      '.qap-adv-toggle', '.qap-adv-panel', '.qap-midi-indicator', '.qap-notation-wrap',
    ]) {
      expect(has(div, gone), `${gone} should be suppressed`).toBe(false);
    }
    // Kept: the keyboard, the letter readout, and "Start chord" — building a
    // chord is a pitch operation, so the chord button must survive even though
    // it normally sits in the duration row.
    expect(has(div, 'svg.qap-piano'), 'keyboard').toBe(true);
    expect(has(div, '.qap-letters-wrap'), 'letter readout').toBe(true);
    expect(has(div, '.qap-chord-btn'), 'Start chord').toBe(true);
  });

  it('suppressed controls are absent, not display:none', () => {
    // A hidden control is still in the accessibility tree — a screen-reader
    // user would still be offered controls that do nothing in this mount.
    const div = container();
    mountFullUI(div, { showDurations: false, showTransport: false, showAdvanced: false });
    expect(div.innerHTML).not.toContain('qap-dur-row');
    expect(div.innerHTML).not.toContain('qap-playback-wrap');
    expect(div.innerHTML).not.toContain('qap-adv-panel');
  });
});

describe('undo + clear render in every configuration', () => {
  const shells: Array<[string, Parameters<typeof mountFullUI>[1]]> = [
    ['default', {}],
    ['minimal', {
      showNotation: false, letterReadout: true, compactChrome: true,
      showDurations: false, showTuplet: false,
      showTransport: false, showAdvanced: false,
    }],
    ['percussion', { percussionMode: true }],
    ['no shell toggle', { shellToggle: false }],
  ];

  for (const [name, opts] of shells) {
    it(`renders both controls in the ${name} shell`, () => {
      const div = container();
      mountFullUI(div, opts);
      expect(has(div, '.qap-undo-btn'), 'undo').toBe(true);
      expect(has(div, '.qap-clear-btn'), 'clear').toBe(true);
    });
  }

  it('undo removes the last entered note only', () => {
    const div = container();
    const piano = mountFullUI(div, {});
    press('a');
    press('s');
    const before = piano.getNoteLetters();
    expect(before.length).toBe(2);

    div.querySelector<HTMLButtonElement>('.qap-undo-btn')!.click();

    expect(piano.getNoteLetters()).toEqual(before.slice(0, 1));
  });

  it('clear removes everything', () => {
    const div = container();
    const piano = mountFullUI(div, {});
    press('a');
    press('s');
    press('d');

    div.querySelector<HTMLButtonElement>('.qap-clear-btn')!.click();

    expect(piano.getNoteLetters()).toEqual([]);
  });

  it('clear is not adjacent to undo, so a missed undo cannot wipe the entry', () => {
    // A destructive clear-all should be hard to hit by accident. The
    // separation is a style, so assert the class that carries it survives.
    const div = container();
    mountFullUI(div, {});
    const clear = div.querySelector('.qap-clear-btn')!;
    expect(clear.classList.contains('qap-edit-btn')).toBe(true);
    expect(div.querySelector('#qap-full-ui-styles')?.textContent ??
           document.querySelector('#qap-full-ui-styles')?.textContent ?? '')
      .toContain('.qap-clear-btn { margin-left');
  });
});
