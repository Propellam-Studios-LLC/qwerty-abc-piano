import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// How the piano behaves under a host page's control:
//   - a settable playback tempo, written as Q: in the header
//   - the playback transport is handed a tune, so its Play button works
//   - a host can change the meter and key of a LIVE mount, controls included
//   - MIDI connects at mount on request, and shows a reason when it cannot
//   - setABC round-trips hand-typed ABC without losing tokens

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ barlineMode: 'manual', ...options });
  instances.push(inst);
  return inst;
}

const containers: HTMLElement[] = [];
function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
  vi.unstubAllGlobals();
});

// A minimal abcjs double: renderAbc returns one opaque visual object, and the
// SynthController records what it was handed.
function mockAbcjs() {
  const setTune = vi.fn().mockResolvedValue({ status: 'ok' });
  const controller = { load: vi.fn(), setTune, play: vi.fn(), pause: vi.fn(),
    restart: vi.fn(), destroy: vi.fn(), isStarted: false, isLoaded: false };
  const renderAbc = vi.fn(() => [{ tune: true }]);
  return {
    abcjs: {
      renderAbc,
      synth: {
        SynthController: function () { return controller; } as unknown as new () => typeof controller,
        CreateSynth: function () {
          return { init: vi.fn().mockResolvedValue(undefined), prime: vi.fn().mockResolvedValue(undefined),
            start: vi.fn(), stop: vi.fn() };
        } as unknown as new () => unknown,
      },
    },
    controller,
    renderAbc,
  };
}

describe('a settable playback tempo is written as Q: in the header', () => {
  it('no tempo means no Q: line at all', () => {
    const inst = make();
    expect(inst.getFullABC()).not.toContain('Q:');
    expect(inst.getTempo()).toBeNull();
  });

  it('setTempo emits Q:1/4=<bpm> between M: and L:', () => {
    const inst = make({ timeSignature: '2/2' });
    inst.setTempo(72);
    const header = inst.getFullABC();
    expect(header).toContain('\nQ:1/4=72\n');
    expect(header.indexOf('M:2/2')).toBeLessThan(header.indexOf('Q:1/4=72'));
    expect(header.indexOf('Q:1/4=72')).toBeLessThan(header.indexOf('L:1/4'));
    expect(inst.getTempo()).toBe(72);
  });

  it('a tempo passed at construction is honoured, and null clears it', () => {
    const inst = make({ tempoBpm: 96 });
    expect(inst.getFullABC()).toContain('Q:1/4=96');
    inst.setTempo(null);
    expect(inst.getFullABC()).not.toContain('Q:');
  });

  it('the header carries the tempo in percussion mode too', () => {
    const inst = make({ percussionMode: true });
    inst.setTempo(120);
    expect(inst.getFullABC()).toContain('Q:1/4=120');
  });
});

describe('the playback transport is handed a tune', () => {
  it('an edit primes the transport with userAction:false', async () => {
    const { abcjs, controller } = mockAbcjs();
    const inst = make({
      abcjs: abcjs as never,
      abcjsAudioContext: {} as AudioContext,
      playbackTarget: document.createElement('div'),
      notationTarget: document.createElement('div'),
    });
    controller.setTune.mockClear();
    inst.setABC('CDEF');
    await Promise.resolve();
    expect(controller.setTune).toHaveBeenCalled();
    const call = controller.setTune.mock.calls.at(-1)!;
    expect(call[1]).toBe(false);
  });

  it('the host’s synth options reach setTune — that is where soundFontUrl lives', async () => {
    const { abcjs, controller } = mockAbcjs();
    const synthOptions = { soundFontUrl: 'soundfonts/', soundFontVolumeMultiplier: 3 };
    const inst = make({
      abcjs: abcjs as never,
      abcjsAudioContext: {} as AudioContext,
      playbackTarget: document.createElement('div'),
      notationTarget: document.createElement('div'),
      synthOptions,
    });
    inst.setABC('C');
    await Promise.resolve();
    expect(controller.setTune.mock.calls.at(-1)![2]).toEqual(synthOptions);
  });

  it('primes even when there is no notation panel to borrow a render from', async () => {
    const { abcjs, controller } = mockAbcjs();
    const inst = make({
      abcjs: abcjs as never,
      abcjsAudioContext: {} as AudioContext,
      playbackTarget: document.createElement('div'),
    });
    controller.setTune.mockClear();
    inst.setABC('CDE');
    await Promise.resolve();
    expect(controller.setTune).toHaveBeenCalled();
  });
});

describe('a live mount follows its host’s meter and key', () => {
  it('the handle moves the Advanced panel’s highlight with the value', () => {
    const div = container();
    const ui = mountFullUI(div, { timeSignature: '6/8', keySignature: 'G' });
    const active = (label: string): string[] =>
      [...div.querySelectorAll('.qap-adv-row')]
        .filter(r => r.textContent?.startsWith(label))
        .flatMap(r => [...r.querySelectorAll('.qap-adv-btn.active')])
        .map(b => b.textContent ?? '');

    expect(active('Time:')).toEqual(['6/8']);
    expect(active('Key:')).toEqual(['G']);

    ui.fullUI.setTimeSignature('2/2');
    ui.fullUI.setKeySignature('D');

    expect(active('Time:')).toEqual(['2/2']);
    expect(active('Key:')).toEqual(['D']);
    expect(ui.getFullABC()).toContain('M:2/2');
    expect(ui.getFullABC()).toContain('K:D');
  });
});

describe('MIDI reports what it is doing', () => {
  it('names the reason when the browser has no Web MIDI', () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    const div = container();
    mountFullUI(div, {});
    const status = div.querySelector('.qap-midi-status')!;
    expect(status.textContent).toMatch(/aren.t supported/);
    // …and the icon says so too: struck through, not clickable-to-connect.
    const icon = div.querySelector<HTMLElement>('.qap-midi-indicator')!;
    expect(icon.dataset.state).toBe('unsupported');
    expect(icon.getAttribute('aria-label')).toMatch(/aren.t supported/);
  });

  it('enableMidi:true connects at mount and reports success', async () => {
    const access = { inputs: new Map(), onstatechange: null };
    const requestMIDIAccess = vi.fn().mockResolvedValue(access);
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
    const div = container();
    const ui = mountFullUI(div, { enableMidi: true });
    await new Promise<void>(r => setTimeout(r, 0));
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(ui.isMidiConnected()).toBe(true);
    expect(div.querySelector('.qap-midi-status')!.textContent).toContain('MIDI on');
    // Access granted with nothing plugged in is NOT "connected".
    expect(div.querySelector<HTMLElement>('.qap-midi-indicator')!.dataset.state).toBe('no-device');
  });

  it('a denied grant the USER ASKED FOR says so instead of going quiet',
      async () => {
    // A GENUINE refusal is NotAllowedError — the user was asked and said no.
    // Any other rejection means access is not yet granted (see
    // midiFailureStates.test.ts).
    //
    // The caption belongs to a request the user made, so this test makes the
    // request by clicking the MIDI icon. A refusal of the mount-time
    // `enableMidi: true` request is silent (see midiMountStatus.test.ts):
    // announcing a denial nobody asked for would only be noise.
    const err = new Error('denied'); err.name = 'NotAllowedError';
    const requestMIDIAccess = vi.fn().mockRejectedValue(err);
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
    const div = container();
    const ui = mountFullUI(div, {});
    await new Promise<void>(r => setTimeout(r, 0));
    div.querySelector<HTMLElement>('.qap-midi-indicator')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise<void>(r => setTimeout(r, 0));
    expect(ui.isMidiConnected()).toBe(false);
    expect(div.querySelector('.qap-midi-status')!.textContent).toMatch(/denied/);
    expect(div.querySelector<HTMLElement>('.qap-midi-indicator')!.dataset.state).toBe('refused');
  });
});

describe('setABC round-trips hand-typed ABC', () => {
  const roundTrip = (body: string, options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) => {
    const inst = make({ measuresPerLine: 0, ...options });
    inst.setABC(body);
    return inst.getABC();
  };

  it('keeps a tie', () => {
    expect(roundTrip('A2- A2')).toBe('A2- A2');
  });

  it('keeps broken rhythm', () => {
    expect(roundTrip('d>e f<g')).toBe('d>e f<g');
  });

  it('keeps slur parentheses', () => {
    expect(roundTrip('(CDE) F')).toBe('(CDE) F');
  });

  it('keeps an inline field rather than mining it for notes', () => {
    expect(roundTrip('C [K:D] E')).toBe('C [K:D] E');
  });

  it('keeps a chord symbol, a decoration and a grace note', () => {
    expect(roundTrip('"G"d !trill!e {gc}f')).toBe('"G"d !trill!e {gc}f');
  });

  it('round-trips a line mixing a tie, a tuplet, a chord symbol and broken rhythm', () => {
    const hard = 'A2- | (3ABc "G"d>e z2 |';
    expect(roundTrip(hard)).toBe(hard);
  });

  it('is idempotent across a second trip', () => {
    const hard = 'A2- | (3ABc "G"d>e z2 |';
    const inst = make({ measuresPerLine: 0 });
    inst.setABC(hard);
    const once = inst.getABC();
    inst.setABC(once);
    expect(inst.getABC()).toBe(once);
  });

  it('a real chord is still parsed as a chord, not passed through raw', () => {
    const inst = make({ measuresPerLine: 0 });
    inst.setABC('[CEG]');
    expect(inst.getABC()).toBe('[CEG]');
    // It is an editable simultaneous entry: undo removes the whole chord.
    inst.undo();
    expect(inst.getABC()).toBe('');
  });
});
