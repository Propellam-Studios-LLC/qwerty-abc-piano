import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import type { AbcjsInstance, NotePlayedEvent } from '../src/types.js';

// allowedPitches: keys outside the set are greyed out and ignored on every
// input path (touch, QWERTY, MIDI): no ABC, no sound, no onNotePlayed.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function container(width?: number): HTMLElement {
  const div = document.createElement('div');
  if (width !== undefined) Object.defineProperty(div, 'clientWidth', { value: width, configurable: true });
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

/** A stand-in abcjs whose renderAbc('*', …) call marks per-note audio. */
function fakeAbcjs() {
  const renderAbc = vi.fn(() => []);
  const abcjs = { renderAbc, synth: { CreateSynth: vi.fn(), SynthController: vi.fn() } } as unknown as AbcjsInstance;
  const audioCalls = () => renderAbc.mock.calls.filter(c => (c as unknown[])[0] === '*').length;
  return { abcjs, audioCalls };
}

function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const div = container();
  const audio = fakeAbcjs();
  const played: NotePlayedEvent[] = [];
  const inst = new QWERTYToABCPiano({
    pianoTarget: div, autoBarline: false,
    abcjs: audio.abcjs, abcjsAudioContext: {} as AudioContext,
    onNotePlayed: e => played.push(e),
    ...options,
  });
  instances.push(inst);
  return { inst, div, played, audioCalls: audio.audioCalls };
}

function key(k: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
}

function touch(div: HTMLElement, dataKey: string): void {
  const target = div.querySelector(`[data-key="${dataKey}"]`)!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  const svg = div.querySelector('svg.qap-piano')!;
  for (const type of ['touchstart', 'touchend']) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'changedTouches', { value: [{ identifier: 1, clientX: 0, clientY: 0 }] });
    svg.dispatchEvent(e);
  }
}

function disabledKeys(div: HTMLElement): string[] {
  return [...div.querySelectorAll('.qap-key-disabled')].map(e => e.getAttribute('data-key')!).sort();
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
  vi.restoreAllMocks();
});

describe('greyed keys', () => {
  it('a { low, high } range greys every key outside it', () => {
    const { div } = make({ allowedPitches: { low: 'C4', high: 'G4' } });
    // E3 layout at shift 0: a..g = E3..B3, ; ' = G4 A4; black e r t = F#3..A#3, [ = G#4.
    expect(disabledKeys(div)).toEqual(["'", '[', 'a', 'd', 'e', 'f', 'g', 'r', 's', 't']);
  });

  it('a list greys every key not in it, including black keys', () => {
    const { div } = make({ allowedPitches: ['C4', 'E4', 'G4'] });
    const enabled = [...div.querySelectorAll('[data-key]:not(.qap-key-disabled)')]
      .map(e => e.getAttribute('data-key')).sort();
    expect(enabled).toEqual([';', 'h', 'k']);
  });

  it('follows the octave shift', () => {
    const { inst, div } = make({ allowedPitches: ['C4'] });
    expect(div.querySelector('[data-key="h"]')!.classList.contains('qap-key-disabled')).toBe(false);
    inst.setOctave(1);
    expect(div.querySelector('[data-key="h"]')!.classList.contains('qap-key-disabled')).toBe(true);
  });

  it('works on a range keyboard', () => {
    const { inst, div } = make({ allowedPitches: { low: 'D4', high: 'E4' } });
    inst.setTouchKeyRange('C4', 'F4');
    expect(disabledKeys(div)).toEqual(['C#4', 'C4', 'F4']);
  });

  it('setAllowedPitches(null) clears it', () => {
    const { inst, div } = make({ allowedPitches: ['C4'] });
    inst.setAllowedPitches(null);
    expect(disabledKeys(div)).toEqual([]);
    expect(inst.getAllowedPitches()).toBeNull();
  });

  it('getAllowedPitches lists the set lowest first, with sharps', () => {
    const { inst } = make({ allowedPitches: ['G4', 'Bb3', 'C4'] });
    expect(inst.getAllowedPitches()).toEqual(['A#3', 'C4', 'G4']);
  });

  it('rejects invalid input', () => {
    expect(() => make({ allowedPitches: ['C4', 'nope'] })).toThrow(/invalid pitch/);
    const { inst } = make();
    expect(() => inst.setAllowedPitches({ low: 'G4', high: 'C4' })).toThrow(/reversed/);
  });

  it('an empty list greys every key', () => {
    const { div } = make({ allowedPitches: [] });
    expect(div.querySelectorAll('[data-key]:not(.qap-key-disabled)').length).toBe(0);
  });
});

describe('ignored input', () => {
  it('QWERTY: a disallowed key writes nothing, sounds nothing, reports nothing', () => {
    const { inst, div, played, audioCalls } = make({ allowedPitches: ['C4'] });
    key('j'); // D4
    expect(inst.getABC()).toBe('');
    expect(audioCalls()).toBe(0);
    expect(played).toEqual([]);
    expect(div.querySelector('[data-key="j"]')!.classList.contains('active')).toBe(false);
    key('h'); // C4
    expect(inst.getABC()).toBe('C');
    expect(audioCalls()).toBe(1);
    expect(played.map(p => p.pitch)).toEqual(['C4']);
  });

  it('touch: a disallowed key is ignored', () => {
    const { inst, div, played, audioCalls } = make({ allowedPitches: { low: 'C4', high: 'E4' } });
    inst.setTouchKeyRange('C4', 'B4');
    touch(div, 'G4');
    expect(inst.getABC()).toBe('');
    expect(audioCalls()).toBe(0);
    expect(played).toEqual([]);
    touch(div, 'E4');
    expect(inst.getABC()).toBe('E');
    expect(played.map(p => p.source)).toEqual(['touch']);
  });

  it('MIDI: a disallowed note is ignored', () => {
    const { inst, played, audioCalls } = make({ allowedPitches: ['C4'] });
    inst.noteOnFromMidi(62); // D4
    expect(inst.getABC()).toBe('');
    expect(audioCalls()).toBe(0);
    expect(played).toEqual([]);
    inst.noteOnFromMidi(60);
    expect(inst.getABC()).toBe('C');
  });

  it('a disallowed key does not join an open chord', () => {
    const { inst } = make({ allowedPitches: ['C4', 'E4'] });
    inst.openChord();
    key('h'); key('j'); key('k');
    inst.commitChord();
    expect(inst.getABC()).toBe('[CE]');
  });

  it('play mode: a disallowed key does not sound', () => {
    const { audioCalls } = make({ allowedPitches: ['C4'], defaultMode: 'play' });
    key('j');
    expect(audioCalls()).toBe(0);
    key('h');
    expect(audioCalls()).toBe(1);
  });
});

describe('the mount\'s range steppers', () => {
  function steppers(div: HTMLElement) {
    const [down, up] = div.querySelectorAll<HTMLButtonElement>('.qap-oct-shift');
    return { down, up, window: () => div.querySelector('.qap-range-window')!.textContent };
  }

  it('clamp to the allowed span', () => {
    setTouch(true);
    const div = container(390);
    const piano = mountFullUI(div, { allowedPitches: { low: 'C4', high: 'G5' } });
    instances.push(piano);
    const s = steppers(div);
    expect(s.window()).toBe('C4–B4');
    expect(s.down.disabled).toBe(true); // C4 is already the lowest allowed note
    expect(s.up.disabled).toBe(false);
    s.up.click();
    expect(s.window()).toBe('C5–B5');
    expect(s.up.disabled).toBe(true);   // B5 is past G5
    s.down.click();
    s.down.click();
    expect(s.window()).toBe('C4–B4');
  });

  it('start on a window that shows the allowed notes', () => {
    setTouch(true);
    const div = container(390);
    const piano = mountFullUI(div, { allowedPitches: { low: 'C2', high: 'G2' } });
    instances.push(piano);
    expect(steppers(div).window()).toBe('C2–B2');
  });

  it('follow setAllowedPitches', () => {
    setTouch(true);
    const div = container(390);
    const piano = mountFullUI(div, {});
    instances.push(piano);
    expect(steppers(div).down.disabled).toBe(false);
    piano.setAllowedPitches({ low: 'C4', high: 'B4' });
    expect(steppers(div).down.disabled).toBe(true);
    expect(steppers(div).up.disabled).toBe(true);
    piano.setAllowedPitches(['C5']);
    expect(steppers(div).window()).toBe('C5–B5');
    expect(disabledKeys(div)).not.toContain('C5');
  });
});
