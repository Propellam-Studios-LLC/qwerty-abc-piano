import { describe, it, expect, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import type { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// Display and play-only mounts: showEditRow:false is honoured only when
// nothing can be entered (lockMode + play). Everywhere else the undo/clear
// row is always present, so whatever was entered can be deleted.
// keyboard:'range' draws the range keyboard on a desktop too.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function mount(options: Parameters<typeof mountFullUI>[1] = {}) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  const piano = mountFullUI(div, options);
  instances.push(piano);
  return { piano, div };
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
});

describe('showEditRow', () => {
  it('hides the edit row and the mode button on a play-only mount', () => {
    const { div } = mount({ lockMode: true, defaultMode: 'play', showEditRow: false });
    expect(div.querySelector('.qap-edit-row')).toBeNull();
    expect(div.querySelector('.qwerty-abc-mode-btn')).toBeNull();
  });

  const kept: Array<[string, Parameters<typeof mountFullUI>[1]]> = [
    ['without lockMode', { defaultMode: 'play', showEditRow: false }],
    ['in transcribe mode', { lockMode: true, defaultMode: 'transcribe', showEditRow: false }],
    ['with lockMode but the default mode', { lockMode: true, showEditRow: false }],
    ['by default', {}],
    ['on a play-only mount that does not ask', { lockMode: true, defaultMode: 'play' }],
  ];
  for (const [name, opts] of kept) {
    it(`keeps the edit row ${name}`, () => {
      const { div } = mount(opts);
      expect(div.querySelector('.qap-edit-row .qap-undo-btn')).not.toBeNull();
      expect(div.querySelector('.qap-edit-row .qap-clear-btn')).not.toBeNull();
    });
  }

  it('a play-only mount still sounds keys and records nothing', () => {
    const { piano } = mount({ lockMode: true, defaultMode: 'play', showEditRow: false });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(piano.getABC()).toBe('');
    piano.setMode('transcribe'); // locked
    expect(piano.getMode()).toBe('play');
  });
});

describe("keyboard: 'range'", () => {
  it('draws the pinned range on a desktop', () => {
    const { div, piano } = mount({ keyboard: 'range', touchRange: { low: 'C4', high: 'C5' }, noteLabels: 'scientific' });
    const keys = [...div.querySelectorAll('rect.qap-key-white')].map(r => r.getAttribute('data-key'));
    expect(keys).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
    expect(piano.getTouchKeyRange()).toEqual({ low: 'C4', high: 'C5' });
    expect((div.querySelector('.qap-range-row') as HTMLElement).style.display).toBe('');
  });

  it('the range row starts from the pinned window', () => {
    const { div } = mount({ keyboard: 'range', touchRange: { low: 'C3', high: 'B3' } });
    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C3–B3');
    div.querySelectorAll<HTMLButtonElement>('.qap-oct-shift')[1].click();
    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C4–B4');
  });

  it('the computer keyboard lights the matching key on a range board', () => {
    const { div } = mount({ keyboard: 'range', touchRange: { low: 'C4', high: 'B4' }, barlineMode: 'none' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(div.querySelector('[data-key="C4"]')!.classList.contains('active')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'h', bubbles: true }));
    expect(div.querySelector('[data-key="C4"]')!.classList.contains('active')).toBe(false);
  });

  it("'auto' keeps the QWERTY layout on a desktop", () => {
    const { div } = mount({ keyboard: 'auto', touchRange: { low: 'C4', high: 'C5' } });
    expect(div.querySelector('rect[data-key="h"]')).not.toBeNull();
  });

  it('touchRange:false still wins', () => {
    const { div } = mount({ keyboard: 'range', touchRange: false });
    expect(div.querySelector('rect[data-key="h"]')).not.toBeNull();
  });

  it('rejects an unknown value', () => {
    expect(() => mount({ keyboard: 'grand' as never })).toThrow(/keyboard/);
  });
});
