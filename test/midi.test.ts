import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { midiNoteToNoteInfo } from '../src/keymap.js';
import type { MIDIInput, MIDIMessageEvent } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function flush() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

// ── MIDI mock factory ─────────────────────────────────────────────────────────

interface FakeMidiInput {
  id: string;
  name: string;
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
  /** Dispatch a raw MIDI message to the registered handler. */
  send(data: Uint8Array): void;
}

function makeFakeMidiInput(id = 'input-0'): FakeMidiInput {
  const input: FakeMidiInput = {
    id,
    name: `Fake MIDI Input ${id}`,
    onmidimessage: null,
    close: vi.fn().mockResolvedValue(undefined),
    send(data: Uint8Array) {
      input.onmidimessage?.({ data } as unknown as MIDIMessageEvent);
    },
  };
  return input;
}

interface FakeMidiAccess {
  inputs: Map<string, FakeMidiInput>;
  onstatechange: ((e: Event) => void) | null;
  dispatchStateChange(): void;
}

function makeFakeMidiAccess(inputs: FakeMidiInput[] = []): FakeMidiAccess {
  const access: FakeMidiAccess = {
    inputs: new Map(inputs.map(i => [i.id, i])),
    onstatechange: null,
    dispatchStateChange() { this.onstatechange?.({} as Event); },
  };
  return access;
}

function stubMidiAccess(access: FakeMidiAccess) {
  const requestMIDIAccess = vi.fn().mockResolvedValue(access);
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
  return requestMIDIAccess;
}

// ── midiNoteToNoteInfo unit tests ─────────────────────────────────────────────

describe('midiNoteToNoteInfo', () => {
  it('maps MIDI note 60 to C4', () => {
    expect(midiNoteToNoteInfo(60)).toEqual({ note: 'C', octave: 4 });
  });

  it('maps MIDI note 69 to A4', () => {
    expect(midiNoteToNoteInfo(69)).toEqual({ note: 'A', octave: 4 });
  });

  it('maps MIDI note 48 to C3', () => {
    expect(midiNoteToNoteInfo(48)).toEqual({ note: 'C', octave: 3 });
  });

  it('maps MIDI note 72 to C5', () => {
    expect(midiNoteToNoteInfo(72)).toEqual({ note: 'C', octave: 5 });
  });

  it('maps MIDI note 61 to C#4', () => {
    expect(midiNoteToNoteInfo(61)).toEqual({ note: 'C#', octave: 4 });
  });

  it('maps MIDI note 62 to D4', () => {
    expect(midiNoteToNoteInfo(62)).toEqual({ note: 'D', octave: 4 });
  });
});

// ── Note-on → note added ──────────────────────────────────────────────────────

describe('MIDI note-on in transcribe mode', () => {
  it('adds C4 (C, middle C) when MIDI note 60 fires', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    input.send(new Uint8Array([0x90, 60, 100]));
    expect(inst.getABC()).toBe('C');
  });

  it('adds A4 (A) when MIDI note 69 fires', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    input.send(new Uint8Array([0x90, 69, 80]));
    expect(inst.getABC()).toBe('A');
  });

  it('adds C3 (C,) when MIDI note 48 fires', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    input.send(new Uint8Array([0x90, 48, 80]));
    expect(inst.getABC()).toBe('C,');
  });

  it('adds C#4 (^C) when MIDI note 61 fires in C major', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true, keySignature: 'C' });
    await flush();

    input.send(new Uint8Array([0x90, 61, 80]));
    expect(inst.getABC()).toBe('^C');
  });

  it('uses the current duration when adding a MIDI note', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    inst.setDuration('h');
    input.send(new Uint8Array([0x90, 60, 80]));
    expect(inst.getABC()).toBe('C2');
  });

  it('sequences multiple MIDI notes', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    input.send(new Uint8Array([0x90, 60, 80])); // C4
    input.send(new Uint8Array([0x90, 62, 80])); // D4
    input.send(new Uint8Array([0x90, 64, 80])); // E4
    expect(inst.getABC()).toBe('CDE');
  });
});

describe('MIDI note-on in play mode', () => {
  it('does not add a note to the transcription', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true, defaultMode: 'play' });
    await flush();

    input.send(new Uint8Array([0x90, 60, 100]));
    expect(inst.getABC()).toBe('');
  });
});

// ── Note-off handling ─────────────────────────────────────────────────────────

describe('MIDI note-off handling', () => {
  it('note-on with velocity 0 does not add a note', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    input.send(new Uint8Array([0x90, 60, 0]));
    expect(inst.getABC()).toBe('');
  });

  it('note-off command (0x80) does not add a note', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    input.send(new Uint8Array([0x80, 60, 64]));
    expect(inst.getABC()).toBe('');
  });
});

// ── Multi-device and hot-plug ─────────────────────────────────────────────────

describe('MIDI multi-input', () => {
  it('listens to all currently connected inputs', async () => {
    const input1 = makeFakeMidiInput('i1');
    const input2 = makeFakeMidiInput('i2');
    stubMidiAccess(makeFakeMidiAccess([input1, input2]));
    const inst = make({ enableMidi: true });
    await flush();

    input1.send(new Uint8Array([0x90, 60, 80])); // C4
    input2.send(new Uint8Array([0x90, 62, 80])); // D4
    expect(inst.getABC()).toBe('CD');
  });

  it('registers newly connected inputs when onstatechange fires', async () => {
    const access = makeFakeMidiAccess([]);
    stubMidiAccess(access);
    const inst = make({ enableMidi: true });
    await flush();

    const newInput = makeFakeMidiInput('i-new');
    access.inputs.set('i-new', newInput as unknown as MIDIInput);
    access.dispatchStateChange();

    newInput.send(new Uint8Array([0x90, 60, 80]));
    expect(inst.getABC()).toBe('C');
  });

  it('does not double-register an existing input on repeated state changes', async () => {
    const input = makeFakeMidiInput();
    const access = makeFakeMidiAccess([input]);
    stubMidiAccess(access);
    const inst = make({ enableMidi: true });
    await flush();

    // Trigger state change twice — should not double-fire notes
    access.dispatchStateChange();
    access.dispatchStateChange();

    input.send(new Uint8Array([0x90, 60, 80]));
    expect(inst.getABC()).toBe('C'); // still only one note
  });
});

// ── Graceful degradation ──────────────────────────────────────────────────────

describe('MIDI graceful degradation', () => {
  it('does not throw when requestMIDIAccess is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    expect(() => make({ enableMidi: true })).not.toThrow();
    await flush();
  });

  it('does not throw when MIDI access is denied (promise rejects)', async () => {
    const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('Permission denied'));
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
    expect(() => make({ enableMidi: true })).not.toThrow();
    await flush();
  });

  it('works normally for keyboard input when MIDI is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    const inst = make({ enableMidi: true });
    await flush();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(inst.getABC()).toBe('C');
  });
});

// ── enableMidi: false (default — no prompt on mount) ──────────────────────────

describe('MIDI disabled by default', () => {
  it('does not call requestMIDIAccess when enableMidi is not set', async () => {
    const requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeMidiAccess());
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
    make(); // no enableMidi → defaults to false, no prompt on load
    await flush();
    expect(requestMIDIAccess).not.toHaveBeenCalled();
  });
});

// ── enableMidiInput(): on-demand opt-in ───────────────────────────────────────

describe('enableMidiInput()', () => {
  it('requests MIDI access on demand and records notes afterwards', async () => {
    const input = makeFakeMidiInput();
    const requestMIDIAccess = stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make(); // no on-mount access
    await flush();
    expect(requestMIDIAccess).not.toHaveBeenCalled();

    const ok = await inst.enableMidiInput();
    expect(ok.state).toBe('connected');
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);

    input.send(new Uint8Array([0x90, 60, 80])); // C4 note-on
    expect(inst.getABC()).toBe('C');
  });

  it('is idempotent — a second call does not re-request access', async () => {
    const requestMIDIAccess = stubMidiAccess(makeFakeMidiAccess([]));
    const inst = make();
    await inst.enableMidiInput();
    await inst.enableMidiInput();
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported when the Web MIDI API is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    const inst = make();
    expect((await inst.enableMidiInput()).state).toBe('unsupported');
  });

  it('reports refused when the user declines the prompt', async () => {
    const err = new Error('Permission denied'); err.name = 'NotAllowedError';
    const requestMIDIAccess = vi.fn().mockRejectedValue(err);
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
    const inst = make();
    expect((await inst.enableMidiInput()).state).toBe('refused');
  });
});

// ── Destroy cleanup ───────────────────────────────────────────────────────────

describe('MIDI destroy cleanup', () => {
  it('stops responding to MIDI messages after destroy()', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    inst.destroy();
    input.send(new Uint8Array([0x90, 60, 80]));
    expect(inst.getABC()).toBe('');
  });

  it('clears the onmidimessage handler on the input after destroy()', async () => {
    const input = makeFakeMidiInput();
    stubMidiAccess(makeFakeMidiAccess([input]));
    const inst = make({ enableMidi: true });
    await flush();

    inst.destroy();
    expect(input.onmidimessage).toBeNull();
  });

  it('clears the onstatechange handler on the access after destroy()', async () => {
    const access = makeFakeMidiAccess([]);
    stubMidiAccess(access);
    const inst = make({ enableMidi: true });
    await flush();

    inst.destroy();
    expect(access.onstatechange).toBeNull();
  });
});
