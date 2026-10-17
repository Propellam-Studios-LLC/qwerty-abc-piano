import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import type { NotePlayedEvent } from '../src/types.js';

// onNotePlayed fires for every note that sounds, in both modes, from every input.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  const played: NotePlayedEvent[] = [];
  const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false, onNotePlayed: e => played.push(e), ...options });
  instances.push(inst);
  return { inst, div, played };
}

function press(k: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
}

function touch(div: HTMLElement, dataKey: string): void {
  const target = div.querySelector(`[data-key="${dataKey}"]`)!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  for (const type of ['touchstart', 'touchend']) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'changedTouches', { value: [{ identifier: 1, clientX: 0, clientY: 0 }] });
    div.querySelector('svg')!.dispatchEvent(e);
  }
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
  vi.restoreAllMocks();
});

describe('onNotePlayed', () => {
  for (const mode of ['transcribe', 'play'] as const) {
    describe(`in ${mode} mode`, () => {
      it('reports QWERTY notes with pitch, MIDI number and source', () => {
        const { played } = make({ defaultMode: mode });
        press('h'); press('u');
        expect(played).toEqual([
          { pitch: 'C4', midi: 60, source: 'qwerty' },
          { pitch: 'C#4', midi: 61, source: 'qwerty' },
        ]);
      });

      it('reports touch on the QWERTY layout and on a range keyboard', () => {
        const { inst, div, played } = make({ defaultMode: mode });
        touch(div, 'k');
        inst.setTouchKeyRange('C5', 'B5');
        touch(div, 'D5');
        expect(played).toEqual([
          { pitch: 'E4', midi: 64, source: 'touch' },
          { pitch: 'D5', midi: 74, source: 'touch' },
        ]);
      });

      it('reports MIDI notes', () => {
        const { inst, played } = make({ defaultMode: mode });
        inst.noteOnFromMidi(67);
        expect(played).toEqual([{ pitch: 'G4', midi: 67, source: 'midi' }]);
      });
    });
  }

  it('follows the octave shift and the anchor', () => {
    const { inst, played } = make({ qwertyAnchor: 'C4' });
    press('a');
    inst.setOctave(1);
    press('a');
    expect(played.map(p => p.pitch)).toEqual(['C4', 'C5']);
  });

  it('reports each note of a chord as it is played', () => {
    const { inst, played } = make();
    inst.openChord();
    press('h'); press('k');
    inst.commitChord();
    expect(played.map(p => p.pitch)).toEqual(['C4', 'E4']);
  });

  it('is silent for a disallowed key', () => {
    const { played } = make({ allowedPitches: ['C4'] });
    press('j'); press('h');
    expect(played.map(p => p.pitch)).toEqual(['C4']);
  });

  it('is silent in rest mode, where a key enters a rest', () => {
    const { inst, played } = make();
    inst.setRestMode(true);
    press('h');
    expect(inst.getABC()).toBe('z');
    expect(played).toEqual([]);
  });

  it('is silent in percussion mode', () => {
    const { inst, played } = make({ percussionMode: true });
    press('h');
    inst.tap();
    expect(inst.getABC()).toBe('BB');
    expect(played).toEqual([]);
  });
});
