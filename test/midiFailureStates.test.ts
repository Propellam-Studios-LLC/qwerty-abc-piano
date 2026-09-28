import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// MIDI failure states, and MIDI input from a native host:
//   - A failed MIDI request has THREE states, not two: not offered / not yet
//     granted / refused. Firefox, which gates Web MIDI behind a site
//     permission, lands on the middle one and must not be told it denied
//     access it never declined.
//   - noteOnFromMidi() is the public entry point a native host (e.g. a mobile
//     app forwarding MIDI) feeds; it takes the same path a touch press takes.

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

function rejectWith(name: string) {
  const err = new Error(`stub ${name}`);
  err.name = name;
  const requestMIDIAccess = vi.fn().mockRejectedValue(err);
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
  return requestMIDIAccess;
}

const statusOf = (div: HTMLElement) =>
  div.querySelector('.qap-midi-status')!.textContent ?? '';

describe('the three MIDI failure states are distinguishable in code', () => {
  it('classifies a NotAllowedError as a refusal and everything else as not-yet-granted', () => {
    expect(QWERTYToABCPiano.classifyMidiFailure('NotAllowedError')).toBe('refused');
    // Firefox's site-permission gate, and every other rejection shape.
    expect(QWERTYToABCPiano.classifyMidiFailure('SecurityError')).toBe('notGranted');
    expect(QWERTYToABCPiano.classifyMidiFailure('AbortError')).toBe('notGranted');
    expect(QWERTYToABCPiano.classifyMidiFailure(undefined)).toBe('notGranted');
  });

  it('enableMidiInput returns unsupported when the API is absent', async () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    expect(await make().enableMidiInput()).toEqual({ state: 'unsupported' });
  });

  it('enableMidiInput KEEPS err.name on a rejection', async () => {
    rejectWith('SecurityError');
    const result = await make().enableMidiInput();
    expect(result.state).toBe('notGranted');
    // The name is what separates the two failure states, so the result must
    // carry it.
    expect((result as { errorName?: string }).errorName).toBe('SecurityError');
  });

  it('enableMidiInput reports refused only for a real decline', async () => {
    rejectWith('NotAllowedError');
    const result = await make().enableMidiInput();
    expect(result.state).toBe('refused');
    expect((result as { errorName?: string }).errorName).toBe('NotAllowedError');
  });

  it('enableMidiInput reports connected when access is granted', async () => {
    const access = { inputs: new Map(), onstatechange: null };
    vi.stubGlobal('navigator', {
      ...navigator, requestMIDIAccess: vi.fn().mockResolvedValue(access),
    });
    expect(await make().enableMidiInput()).toEqual({ state: 'connected' });
  });
});

describe('mountFullUI renders one caption per failure state', () => {
  const settle = () => new Promise<void>(r => setTimeout(r, 0));

  // These captions belong to a request the USER made. A failed mount-time
  // `enableMidi: true` attempt is silent (a warning about a request nobody
  // made would only be noise), so the captions are driven through the MIDI
  // icon, which is where a user actually meets them. The mount is therefore
  // plain, and the click is the gesture.
  async function captionAfterAsking(div: HTMLElement): Promise<string> {
    mountFullUI(div, {});
    await settle();
    div.querySelector<HTMLElement>('.qap-midi-indicator')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    return statusOf(div);
  }

  it('Firefox (site permission not granted) is NOT reported as a denial', async () => {
    // Web MIDI exists in Firefox, so the caption is not "unsupported"; the
    // request rejects because the origin lacks the MIDI site permission. The
    // user has granted nothing and refused nothing.
    rejectWith('SecurityError');
    const text = await captionAfterAsking(container());
    expect(text).toMatch(/needs permission for this site/i);
    expect(text).not.toMatch(/denied/i);
  });

  it('a genuine decline still names the denial and its remedy', async () => {
    rejectWith('NotAllowedError');
    expect(await captionAfterAsking(container()))
        .toMatch(/denied .* site settings/i);
  });

  it('no Web MIDI at all says so', async () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    const div = container();
    mountFullUI(div, { enableMidi: true });
    await settle();
    expect(statusOf(div)).toMatch(/aren.t supported/i);
  });

  it('the three captions are pairwise distinct', async () => {
    const seen: string[] = [];
    for (const setup of [
      () => vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined }),
      () => rejectWith('SecurityError'),
      () => rejectWith('NotAllowedError'),
    ]) {
      vi.unstubAllGlobals();
      setup();
      const div = container();
      if (navigator.requestMIDIAccess === undefined) {
        // The unsupported caption is a CAPABILITY statement, not the outcome of
        // a request, so it still appears at mount.
        mountFullUI(div, { enableMidi: true });
        await settle();
        seen.push(statusOf(div));
      } else {
        seen.push(await captionAfterAsking(div));
      }
    }
    expect(new Set(seen).size).toBe(3);
  });
});

describe('noteOnFromMidi feeds native MIDI input into the shared note path', () => {
  it('writes a note exactly as a touched key would', () => {
    const inst = make();
    inst.noteOnFromMidi(60, 100); // middle C
    expect(inst.getABC()).toBe('C');
  });

  it('maps octaves the same way the Web MIDI handler does', () => {
    const inst = make();
    inst.noteOnFromMidi(72);  // C5
    inst.noteOnFromMidi(48);  // C3
    expect(inst.getABC()).toBe("cC,");
  });

  it('ignores a note-off (velocity 0) and out-of-range numbers', () => {
    const inst = make();
    inst.noteOnFromMidi(60, 0);
    inst.noteOnFromMidi(-1, 100);
    inst.noteOnFromMidi(200, 100);
    inst.noteOnFromMidi(Number.NaN, 100);
    expect(inst.getABC()).toBe('');
  });

  it('participates in undo, because it goes through the shared entry point', () => {
    const inst = make();
    inst.noteOnFromMidi(60);
    inst.noteOnFromMidi(62);
    inst.undo();
    expect(inst.getABC()).toBe('C');
  });

  it('is captured by the chord (simultaneous) buffer like any other note', () => {
    const inst = make();
    inst.openChord();
    inst.noteOnFromMidi(60);
    inst.noteOnFromMidi(64);
    inst.commitChord();
    expect(inst.getABC()).toBe('[CE]');
  });
});
