import { describe, it, expect, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// markKeys / clearMarks: feedback colours on keys ('correct', 'wrong',
// 'missed'), independent of the pressed-key colour and of the highlight.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false, ...options });
  instances.push(inst);
  return { inst, div };
}

function keyClasses(div: HTMLElement, key: string): string[] {
  return [...div.querySelector(`[data-key="${key}"]`)!.classList].filter(c => c.startsWith('qap-mark') || c === 'qap-key-highlight');
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
});

describe('markKeys', () => {
  it('puts one class per state on the keys', () => {
    const { inst, div } = make();
    inst.setTouchKeyRange('C4', 'B4');
    inst.markKeys({ D4: 'correct', C4: 'wrong', 'F#4': 'missed' });
    expect(keyClasses(div, 'D4')).toEqual(['qap-mark-correct']);
    expect(keyClasses(div, 'C4')).toEqual(['qap-mark-wrong']);
    expect(keyClasses(div, 'F#4')).toEqual(['qap-mark-missed']);
    expect(keyClasses(div, 'E4')).toEqual([]);
  });

  it('works on the QWERTY layout through the current shift', () => {
    const { inst, div } = make();
    inst.markKeys({ C4: 'correct', 'C#4': 'missed' });
    expect(keyClasses(div, 'h')).toEqual(['qap-mark-correct']);
    expect(keyClasses(div, 'u')).toEqual(['qap-mark-missed']);
  });

  it('replaces the previous marks', () => {
    const { inst, div } = make();
    inst.markKeys({ C4: 'correct' });
    inst.markKeys({ D4: 'wrong' });
    expect(keyClasses(div, 'h')).toEqual([]);
    expect(keyClasses(div, 'j')).toEqual(['qap-mark-wrong']);
  });

  it('returns the marked pitches that are not drawn', () => {
    const { inst } = make();
    expect(inst.markKeys({ C4: 'correct', C7: 'missed' })).toEqual(['C7']);
  });

  it('rejects an unknown state or pitch', () => {
    const { inst } = make();
    expect(() => inst.markKeys({ C4: 'right' as never })).toThrow(/unknown mark/);
    expect(() => inst.markKeys({ X4: 'correct' })).toThrow(/invalid pitch/);
  });

  it('clearMarks removes every mark', () => {
    const { inst, div } = make();
    inst.markKeys({ C4: 'correct', D4: 'wrong' });
    inst.clearMarks();
    expect(div.querySelectorAll('[class*="qap-mark-"]').length).toBe(0);
  });

  it('survives a re-render', () => {
    const { inst, div } = make();
    inst.setTouchKeyRange('C4', 'B4');
    inst.markKeys({ E4: 'wrong' });
    inst.setTouchKeyRange('C4', 'B5');
    expect(keyClasses(div, 'E4')).toEqual(['qap-mark-wrong']);
    inst.setNoteLabels('scientific');
    expect(keyClasses(div, 'E4')).toEqual(['qap-mark-wrong']);
  });

  it('survives an octave shift by following the pitch', () => {
    const { inst, div } = make();
    inst.markKeys({ C5: 'correct' });
    inst.setOctave(1);
    expect(keyClasses(div, 'h')).toEqual(['qap-mark-correct']);
  });

  it('coexists with the highlight on the same key', () => {
    const { inst, div } = make();
    inst.markKeys({ C4: 'correct' });
    inst.highlightPitches(['C4']);
    expect(keyClasses(div, 'h').sort()).toEqual(['qap-key-highlight', 'qap-mark-correct']);
    inst.clearHighlight();
    expect(keyClasses(div, 'h')).toEqual(['qap-mark-correct']);
    inst.highlightPitches(['C4']);
    inst.clearMarks();
    expect(keyClasses(div, 'h')).toEqual(['qap-key-highlight']);
  });

  it('is not changed by clear() or by playing', () => {
    const { inst, div } = make();
    inst.markKeys({ C4: 'wrong' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'h', bubbles: true }));
    inst.clear();
    expect(keyClasses(div, 'h')).toEqual(['qap-mark-wrong']);
  });

  it('ships a stylesheet rule with a CSS custom property for each state', () => {
    make();
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    expect(css).toContain('--qwerty-abc-piano-mark-correct');
    expect(css).toContain('--qwerty-abc-piano-mark-wrong');
    expect(css).toContain('--qwerty-abc-piano-mark-missed');
    expect(css).toContain('--qwerty-abc-piano-highlight-color');
  });
});
