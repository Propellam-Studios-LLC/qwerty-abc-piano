import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// Edge cases in the core QWERTYToABCPiano class: input validation, settings
// that survive a re-render, teardown during a pending MIDI request, console
// noise, and button labels.

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ barlineMode: 'manual', ...options });
  instances.push(inst);
  return inst;
}
const nodes: Element[] = [];
function div(): HTMLElement {
  const d = document.createElement('div');
  document.body.appendChild(d);
  nodes.push(d);
  return d;
}
afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (nodes.length) nodes.pop()!.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('setTimeSignature validates before storing', () => {
  it('a bad meter throws and leaves the current one in place', () => {
    const inst = make({ timeSignature: '3/4' });
    expect(() => inst.setTimeSignature('bad')).toThrow(/Invalid time signature/);
    expect(inst.getFullABC()).toContain('M:3/4');
  });
});

describe('label visibility survives re-renders', () => {
  it('setShowKeyLabels / setShowNoteNames persist through setTouchKeyRange', () => {
    const target = div();
    const inst = make({ pianoTarget: target });
    inst.setShowKeyLabels(false);
    inst.setShowNoteNames(false);
    inst.setTouchKeyRange('C4', 'B5');
    const svg = target.querySelector('svg.qap-piano')!;
    expect(svg.classList.contains('qap-no-key-labels')).toBe(true);
    expect(svg.classList.contains('qap-no-note-names')).toBe(true);
    inst.setShowKeyLabels(true);
    inst.setTouchKeyRange(null, null);
    const svg2 = target.querySelector('svg.qap-piano')!;
    expect(svg2.classList.contains('qap-no-key-labels')).toBe(false);
    expect(svg2.classList.contains('qap-no-note-names')).toBe(true);
  });
});

describe('destroy() during a pending MIDI request', () => {
  it('never attaches handlers once destroyed', async () => {
    let resolve!: (v: unknown) => void;
    const input = { id: '1', name: 'k', state: 'connected', onmidimessage: null };
    const access = { inputs: new Map([['1', input]]), onstatechange: null };
    const requestMIDIAccess = vi.fn(() => new Promise(r => { resolve = r; }));
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
    const inst = new QWERTYToABCPiano({});
    const pending = inst.enableMidiInput();
    inst.destroy();
    resolve(access);
    const result = await pending;
    expect(result.state).not.toBe('connected');
    expect(input.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(inst.isMidiConnected()).toBe(false);
  });
});

describe('console noise', () => {
  it('warns once, not on every Enter, when abcjs is not configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inst = make();
    inst.playback();
    inst.playback();
    inst.playback();
    expect(warn.mock.calls.filter(c => String(c[0]).includes('cannot play'))).toHaveLength(1);
  });

  it('enableMidiInput() does not console.warn on a refusal (the caller gets the result)', async () => {
    const err = new Error('no'); err.name = 'NotAllowedError';
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: vi.fn().mockRejectedValue(err) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const result = await make().enableMidiInput();
    expect(result.state).toBe('refused');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('triplet button label', () => {
  it('names the real key, Q', () => {
    const target = div();
    make({ tupletTarget: target });
    expect(target.textContent).toBe('TRIPLET (Q)');
  });
});
