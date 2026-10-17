import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// noteLabels: 'auto' (the default), 'letters', 'scientific'.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  const inst = new QWERTYToABCPiano({ pianoTarget: div, ...options });
  instances.push(inst);
  return { inst, div };
}

const whiteLabels = (div: HTMLElement) =>
  [...div.querySelectorAll('text.qap-note-name:not(.qap-note-name-black)')].map(t => t.textContent);
const blackLabels = (div: HTMLElement) =>
  [...div.querySelectorAll('text.qap-note-name-black')].map(t => t.textContent);

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
  vi.restoreAllMocks();
});

describe("'auto' (default) is unchanged", () => {
  it('QWERTY layout: letters under white keys, no note names on black keys', () => {
    const { inst, div } = make();
    expect(inst.getNoteLabels()).toBe('auto');
    expect(whiteLabels(div)).toEqual(['E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'A']);
    expect(blackLabels(div)).toEqual([]);
  });

  it('range keyboard: C carries its octave; black keys show their name', () => {
    const { inst, div } = make();
    inst.setTouchKeyRange('C4', 'E4');
    expect(whiteLabels(div)).toEqual(['C4', 'D', 'E']);
    expect(blackLabels(div)).toEqual(['C#', 'D#']);
  });
});

describe("'letters'", () => {
  it('drops the octave from C on a range keyboard', () => {
    const { inst, div } = make({ noteLabels: 'letters' });
    inst.setTouchKeyRange('C4', 'E4');
    expect(whiteLabels(div)).toEqual(['C', 'D', 'E']);
  });
});

describe("'scientific'", () => {
  it('labels every key on the QWERTY layout', () => {
    const { div } = make({ noteLabels: 'scientific' });
    expect(whiteLabels(div)).toEqual(['E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4']);
    expect(blackLabels(div)).toEqual(['F#3', 'G#3', 'A#3', 'C#4', 'D#4', 'F#4', 'G#4']);
    // The QWERTY letters stay.
    expect(div.querySelectorAll('text.qap-key-qwerty').length).toBe(18);
  });

  it('labels every key on a range keyboard', () => {
    const { inst, div } = make({ noteLabels: 'scientific' });
    inst.setTouchKeyRange('B3', 'D4');
    expect(whiteLabels(div)).toEqual(['B3', 'C4', 'D4']);
    expect(blackLabels(div)).toEqual(['C#4']);
  });

  it('follows the octave shift on the QWERTY layout', () => {
    const { inst, div } = make({ noteLabels: 'scientific', qwertyAnchor: 'C4' });
    expect(whiteLabels(div)[0]).toBe('C4');
    inst.setOctave(1);
    expect(whiteLabels(div)[0]).toBe('C5');
    expect(blackLabels(div)[0]).toBe('C#5');
  });

  it('black-key names use the smaller black-key style', () => {
    make({ noteLabels: 'scientific' });
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    expect(css).toMatch(/text\.qap-note-name-black\{[^}]*font:8px/);
  });
});

describe('setNoteLabels', () => {
  it('switches live and back', () => {
    const { inst, div } = make();
    inst.setNoteLabels('scientific');
    expect(whiteLabels(div)[5]).toBe('C4');
    expect(blackLabels(div).length).toBe(7);
    inst.setNoteLabels('auto');
    expect(whiteLabels(div)[5]).toBe('C');
    expect(blackLabels(div)).toEqual([]);
  });

  it('keeps the label visibility settings', () => {
    const { inst, div } = make({ showNoteNames: false });
    inst.setNoteLabels('scientific');
    expect(div.querySelector('svg')!.classList.contains('qap-no-note-names')).toBe(true);
  });

  it('keeps touch input working after the redraw', () => {
    const { inst, div } = make();
    inst.setTouchKeyRange('C4', 'B4');
    inst.setNoteLabels('scientific');
    const target = div.querySelector('[data-key="E4"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    const e = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'changedTouches', { value: [{ identifier: 1, clientX: 0, clientY: 0 }] });
    div.querySelector('svg')!.dispatchEvent(e);
    expect(inst.getABC()).toContain('E');
  });

  it('rejects an unknown style', () => {
    const { inst } = make();
    expect(() => inst.setNoteLabels('solfege' as never)).toThrow(/noteLabels/);
  });
});
