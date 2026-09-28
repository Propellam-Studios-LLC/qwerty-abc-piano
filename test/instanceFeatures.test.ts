import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// Instance features beyond basic note entry: the notation theme stylesheet,
// note selection and pitch adjustment, barlineMode, the measure-overflow
// warning, and playback through abcjs's SynthController (mocked).

// ── Helpers ───────────────────────────────────────────────────────────────────

function keydown(key: string, opts: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ autoBarline: false, ...options });
  instances.push(inst);
  return inst;
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  vi.restoreAllMocks();
});

// ── notationTheme ─────────────────────────────────────────────────────────────

describe('notationTheme', () => {
  it('injects the lib style tag into the document head', () => {
    make();
    expect(document.getElementById('qwerty-abc-piano-lib-styles')).not.toBeNull();
  });

  it('injects the style tag only once across multiple instances', () => {
    make();
    make();
    const tags = document.querySelectorAll('#qwerty-abc-piano-lib-styles');
    expect(tags.length).toBe(1);
  });

  it('adds qap-notation class to notationTarget when notationTheme is "black" (default)', () => {
    const { abcjs } = makeMockAbcjs();
    const notationTarget = document.createElement('div');
    make({ abcjs, notationTarget });
    keydown('h');
    expect(notationTarget.classList.contains('qap-notation')).toBe(true);
  });

  it('does NOT add qap-notation class when notationTheme is "default"', () => {
    const { abcjs } = makeMockAbcjs();
    const notationTarget = document.createElement('div');
    make({ abcjs, notationTarget, notationTheme: 'default' });
    keydown('h');
    expect(notationTarget.classList.contains('qap-notation')).toBe(false);
  });
});

// ── Note selection ────────────────────────────────────────────────────────────

describe('note selection — selectNote() public API', () => {
  it('selectNote(0) sets selected index to 0', () => {
    const inst = make();
    keydown('h'); // index 0: C
    inst.selectNote(0);
    expect((inst as any)._selectedIndex).toBe(0);
  });

  it('selectNote(null) clears the selection', () => {
    const inst = make();
    keydown('h');
    inst.selectNote(0);
    inst.selectNote(null);
    expect((inst as any)._selectedIndex).toBeNull();
  });

  it('selectNote with out-of-range index does nothing', () => {
    const inst = make();
    inst.selectNote(99);
    expect((inst as any)._selectedIndex).toBeNull();
  });

  it('fires onSelectionChange when selection changes', () => {
    const onSelectionChange = vi.fn();
    const inst = make({ onSelectionChange });
    keydown('h');
    inst.selectNote(0);
    expect(onSelectionChange).toHaveBeenCalledWith(0);
  });

  it('fires onSelectionChange with null when deselected', () => {
    const onSelectionChange = vi.fn();
    const inst = make({ onSelectionChange });
    keydown('h');
    inst.selectNote(0);
    inst.selectNote(null);
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });
});

describe('note selection — arrow key navigation', () => {
  it('ArrowRight selects the first note when nothing is selected', () => {
    const inst = make();
    keydown('h'); // C
    keydown('j'); // D
    keydown('ArrowRight');
    expect((inst as any)._selectedIndex).toBe(0);
  });

  it('ArrowLeft selects the last note when nothing is selected', () => {
    const inst = make();
    keydown('h'); // C (index 0)
    keydown('j'); // D (index 1)
    keydown('ArrowLeft');
    expect((inst as any)._selectedIndex).toBe(1);
  });

  it('ArrowRight advances selection', () => {
    const inst = make();
    keydown('h'); // index 0
    keydown('j'); // index 1
    keydown('ArrowRight'); // selects 0
    keydown('ArrowRight'); // selects 1
    expect((inst as any)._selectedIndex).toBe(1);
  });

  it('selection does not advance past the last note', () => {
    const inst = make();
    keydown('h'); // only one note, index 0
    keydown('ArrowRight');
    keydown('ArrowRight'); // try to go past the end
    expect((inst as any)._selectedIndex).toBe(0);
  });

  it('arrow keys do not select notes in play mode', () => {
    const inst = make({ defaultMode: 'play' });
    keydown('ArrowRight');
    expect((inst as any)._selectedIndex).toBeNull();
  });
});

describe('note selection — cleared by state changes', () => {
  it('selection is cleared by clear()', () => {
    const inst = make();
    keydown('h');
    inst.selectNote(0);
    inst.clear();
    expect((inst as any)._selectedIndex).toBeNull();
  });

  it('selection is cleared by setABC()', () => {
    const inst = make();
    keydown('h');
    inst.selectNote(0);
    inst.setABC('c d e');
    expect((inst as any)._selectedIndex).toBeNull();
  });

  it('selection is cleared when undo removes the selected note', () => {
    const inst = make();
    keydown('h'); // index 0
    inst.selectNote(0);
    inst.undo();
    expect((inst as any)._selectedIndex).toBeNull();
  });

  it('selection stays valid when undo removes a later note', () => {
    const inst = make();
    keydown('h'); // index 0
    keydown('j'); // index 1
    inst.selectNote(0);
    inst.undo(); // removes index 1
    expect((inst as any)._selectedIndex).toBe(0);
  });
});

// ── Pitch adjustment ──────────────────────────────────────────────────────────

describe('adjustSelectedPitch()', () => {
  it('raises C4 by one half-step to C#4', () => {
    const inst = make({ keySignature: 'C' });
    keydown('h'); // C4
    inst.selectNote(0);
    inst.adjustSelectedPitch(1);
    expect(inst.getABC()).toBe('^C');
  });

  it('lowers C4 by one half-step to B3', () => {
    const inst = make();
    keydown('h'); // C4
    inst.selectNote(0);
    inst.adjustSelectedPitch(-1);
    expect(inst.getABC()).toBe('B,');
  });

  it('wraps B to C and increments octave when raising', () => {
    const inst = make();
    keydown("'"); // A4
    // get to B4
    inst.selectNote(0);
    inst.adjustSelectedPitch(2); // A4 → A#4 → B4
    expect(inst.getABC()).toBe('B'); // B4 is uppercase B in ABC
    // Now raise from B4 → C5
    inst.adjustSelectedPitch(1);
    expect(inst.getABC()).toBe("c");
  });

  it('does nothing when no note is selected', () => {
    const inst = make();
    keydown('h');
    inst.adjustSelectedPitch(1); // no selection
    expect(inst.getABC()).toBe('C');
  });

  it('fires onChange after pitch adjustment', () => {
    const onChange = vi.fn();
    const inst = make({ onChange });
    keydown('h');
    inst.selectNote(0);
    onChange.mockClear();
    inst.adjustSelectedPitch(1);
    expect(onChange).toHaveBeenCalled();
  });

  it('ArrowUp raises selected note by a half-step', () => {
    const inst = make({ keySignature: 'C' });
    keydown('h'); // C4
    inst.selectNote(0);
    keydown('ArrowUp');
    expect(inst.getABC()).toBe('^C');
  });

  it('ArrowDown lowers selected note by a half-step', () => {
    const inst = make();
    keydown('h'); // C4
    inst.selectNote(0);
    keydown('ArrowDown');
    expect(inst.getABC()).toBe('B,');
  });

  it('ArrowUp/Down do nothing when no note is selected', () => {
    const inst = make();
    keydown('h');
    keydown('ArrowUp');
    expect(inst.getABC()).toBe('C');
  });
});

// ── barlineMode ───────────────────────────────────────────────────────────────

describe('barlineMode option', () => {
  it('"auto" inserts barlines automatically (same as autoBarline: true)', () => {
    const inst = new QWERTYToABCPiano({ barlineMode: 'auto', timeSignature: '4/4' });
    instances.push(inst);
    // Add 4 quarter notes — barline should appear after the 4th
    for (let i = 0; i < 4; i++) keydown('h');
    expect(inst.getABC()).toContain('|');
    inst.destroy();
  });

  it('"manual" suppresses automatic barlines', () => {
    const inst = new QWERTYToABCPiano({ barlineMode: 'manual', timeSignature: '4/4' });
    instances.push(inst);
    for (let i = 0; i < 8; i++) keydown('h');
    expect(inst.getABC()).not.toContain('|');
    inst.destroy();
  });

  it('"none" suppresses automatic and manual barlines', () => {
    const inst = new QWERTYToABCPiano({ barlineMode: 'none', timeSignature: '4/4' });
    instances.push(inst);
    for (let i = 0; i < 8; i++) keydown('h');
    // Try manual barline key too
    keydown('\\');
    expect(inst.getABC()).not.toContain('|');
    inst.destroy();
  });

  it('"manual" still allows \\ key to insert a barline', () => {
    const inst = new QWERTYToABCPiano({ barlineMode: 'manual' });
    instances.push(inst);
    keydown('h');
    keydown('\\');
    expect(inst.getABC()).toContain('|');
    inst.destroy();
  });

  it('autoBarline: false maps to "manual" behaviour', () => {
    const inst = new QWERTYToABCPiano({ autoBarline: false, timeSignature: '4/4' });
    instances.push(inst);
    for (let i = 0; i < 8; i++) keydown('h');
    expect(inst.getABC()).not.toContain('|');
    inst.destroy();
  });

  it('barlineMode takes priority over autoBarline when both are set', () => {
    const inst = new QWERTYToABCPiano({ barlineMode: 'none', autoBarline: true, timeSignature: '4/4' });
    instances.push(inst);
    for (let i = 0; i < 8; i++) keydown('h');
    expect(inst.getABC()).not.toContain('|');
    inst.destroy();
  });
});

// ── Measure overflow warning ──────────────────────────────────────────────────

describe('measure overflow warning', () => {
  it('fires onMeasureOverflow when beat count exceeds measure in manual mode', () => {
    const onMeasureOverflow = vi.fn();
    const inst = new QWERTYToABCPiano({
      barlineMode: 'manual',
      timeSignature: '4/4',
      onMeasureOverflow,
    });
    instances.push(inst);
    for (let i = 0; i < 5; i++) keydown('h'); // 5 quarter notes > 4 beats
    expect(onMeasureOverflow).toHaveBeenCalled();
    inst.destroy();
  });

  it('fires onMeasureOverflow with correct beats and maxBeats', () => {
    const onMeasureOverflow = vi.fn();
    const inst = new QWERTYToABCPiano({
      barlineMode: 'manual',
      timeSignature: '4/4',
      onMeasureOverflow,
    });
    instances.push(inst);
    for (let i = 0; i < 5; i++) keydown('h');
    const [beats, maxBeats] = onMeasureOverflow.mock.calls[0] as [number, number];
    expect(beats).toBeGreaterThan(4);
    expect(maxBeats).toBe(4);
    inst.destroy();
  });

  it('dispatches qwerty-abc-piano:measure-overflow custom event', () => {
    const handler = vi.fn();
    document.addEventListener('qwerty-abc-piano:measure-overflow', handler);
    const inst = new QWERTYToABCPiano({ barlineMode: 'manual', timeSignature: '4/4' });
    instances.push(inst);
    for (let i = 0; i < 5; i++) keydown('h');
    expect(handler).toHaveBeenCalled();
    document.removeEventListener('qwerty-abc-piano:measure-overflow', handler);
    inst.destroy();
  });

  it('does NOT fire onMeasureOverflow in auto mode (barlines prevent overflow)', () => {
    const onMeasureOverflow = vi.fn();
    const inst = new QWERTYToABCPiano({
      barlineMode: 'auto',
      timeSignature: '4/4',
      onMeasureOverflow,
    });
    instances.push(inst);
    for (let i = 0; i < 5; i++) keydown('h');
    expect(onMeasureOverflow).not.toHaveBeenCalled();
    inst.destroy();
  });

  it('fires onMeasureOverflow in "none" mode', () => {
    const onMeasureOverflow = vi.fn();
    const inst = new QWERTYToABCPiano({
      barlineMode: 'none',
      timeSignature: '4/4',
      onMeasureOverflow,
    });
    instances.push(inst);
    for (let i = 0; i < 5; i++) keydown('h');
    expect(onMeasureOverflow).toHaveBeenCalled();
    inst.destroy();
  });
});

// ── Playback via SynthController (mock-based) ─────────────────────────────────

function makeMockSynthController() {
  return {
    load:     vi.fn(),
    setTune:  vi.fn().mockResolvedValue({ status: 'ok' }),
    pause:    vi.fn(),
    restart:  vi.fn(),
    destroy:  vi.fn(),
    isStarted: false,
    isLoaded:  false,
  };
}

function makeMockAbcjs(withSynthController = false) {
  const synth = {
    init:  vi.fn().mockResolvedValue(undefined),
    prime: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    stop:  vi.fn(),
  };
  const CreateSynth = vi.fn().mockImplementation(() => synth);
  const renderAbc   = vi.fn().mockReturnValue([{}]);

  const abcjsSynth: Record<string, unknown> = { CreateSynth };
  let sc: ReturnType<typeof makeMockSynthController> | null = null;
  if (withSynthController) {
    sc = makeMockSynthController();
    abcjsSynth['SynthController'] = vi.fn().mockImplementation(() => sc);
  }

  return {
    abcjs: { renderAbc, synth: abcjsSynth },
    renderAbc,
    CreateSynth,
    synth,
    synthController: sc,
  };
}

describe('playback (SynthController)', () => {
  it('creates a SynthController and calls load() when playbackTarget is provided', () => {
    const { abcjs, synthController } = makeMockAbcjs(true);
    const playbackTarget = document.createElement('div');
    make({ abcjs: abcjs as any, abcjsAudioContext: {} as AudioContext, playbackTarget });
    expect(synthController!.load).toHaveBeenCalledWith(playbackTarget, expect.any(Object), expect.any(Object));
  });

  it('calls setTune on Enter when SynthController is configured', async () => {
    const { abcjs, synthController } = makeMockAbcjs(true);
    const playbackTarget = document.createElement('div');
    make({ abcjs: abcjs as any, abcjsAudioContext: {} as AudioContext, playbackTarget });
    keydown('h');
    keydown('Enter');
    await new Promise<void>(r => setTimeout(r, 0));
    expect(synthController!.setTune).toHaveBeenCalled();
  });

  it('subsequent Enter calls setTune again (SynthController handles stop internally)', async () => {
    const { abcjs, synthController } = makeMockAbcjs(true);
    const playbackTarget = document.createElement('div');
    make({ abcjs: abcjs as any, abcjsAudioContext: {} as AudioContext, playbackTarget });
    keydown('h');
    keydown('Enter');
    await new Promise<void>(r => setTimeout(r, 0));
    keydown('Enter');
    await new Promise<void>(r => setTimeout(r, 0));
    // Count only the PLAY calls. The transport is also primed with
    // `userAction: false` on every edit, so the spy legitimately sees more
    // calls than there were Enters.
    const plays = (synthController!.setTune as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.filter(c => c[1] === true);
    expect(plays).toHaveLength(2);
  });

  it('calls destroy() on the SynthController when instance is destroyed', async () => {
    const { abcjs, synthController } = makeMockAbcjs(true);
    const playbackTarget = document.createElement('div');
    const inst = make({ abcjs: abcjs as any, abcjsAudioContext: {} as AudioContext, playbackTarget });
    inst.destroy();
    expect(synthController!.destroy).toHaveBeenCalled();
  });

  it('falls back to raw CreateSynth when no playbackTarget is configured', async () => {
    const { abcjs, CreateSynth } = makeMockAbcjs(false);
    make({ abcjs: abcjs as any, abcjsAudioContext: {} as AudioContext });
    keydown('h');
    keydown('Enter');
    await new Promise<void>(r => setTimeout(r, 0));
    expect(CreateSynth).toHaveBeenCalled();
  });

  it('does not crash when abcjs is not configured', () => {
    make();
    keydown('h');
    expect(() => keydown('Enter')).not.toThrow();
  });
});
