import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// With `enableMidi: true` the mount requests Web MIDI access itself, a request
// the user never made. In a browser profile that denies MIDI by default,
// reporting that failure would greet every visitor with a red "denied" line.
//
// So a MOUNT-TIME failure is SILENT and leaves the MIDI icon idle (clickable);
// a USER-INITIATED failure keeps its caption, because that is a failed
// operation the user started; success and the unsupported-browser caption
// are reported as usual.

const containers: HTMLElement[] = [];

function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

afterEach(() => {
  while (containers.length) containers.pop()!.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** A Web MIDI API present on navigator, whose access request behaves as given. */
function stubMidi(behaviour: 'granted' | 'refused'): ReturnType<typeof vi.fn> {
  const requestMIDIAccess =
    behaviour === 'granted'
      ? vi.fn().mockResolvedValue({
          inputs: new Map(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          onstatechange: null,
        })
      : vi.fn().mockRejectedValue(new Error('Permission denied'));
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
  return requestMIDIAccess;
}

function status(div: HTMLElement): HTMLElement | null {
  return div.querySelector<HTMLElement>('.qap-midi-status');
}

function midiIcon(div: HTMLElement): HTMLElement | null {
  return div.querySelector<HTMLElement>('.qap-midi-indicator');
}

function helpOpen(div: HTMLElement): boolean {
  return !div.querySelector('.qap-help-panel')!.classList.contains('qap-adv-hidden');
}

// MIDI state is shown by one icon (its data-state), whose words live in the
// help panel's `.qap-midi-status`.
describe('a mount-time MIDI failure is silent', () => {
  it('a refused auto-connect shows NO failure text, no warn tone, and no red icon', async () => {
    stubMidi('refused');
    const div = container();
    mountFullUI(div, { enableMidi: true });
    await flush();

    const line = status(div)!;
    expect(line.textContent).not.toMatch(/denied|needs permission/);
    expect(line.classList.contains('qap-midi-status--warn')).toBe(false);
    expect(div.textContent).not.toContain('MIDI access was denied');
    expect(midiIcon(div)!.dataset.state).toBe('idle');
    // Nobody asked, so nothing pops open.
    expect(helpOpen(div)).toBe(false);
  });

  it('under enableMidi the icon is BUILT and shows pending, then idle after a refusal', async () => {
    stubMidi('refused');
    const div = container();
    mountFullUI(div, { enableMidi: true });

    const before = midiIcon(div);
    expect(before, 'the icon is BUILT under enableMidi').not.toBeNull();
    expect(before!.dataset.state).toBe('pending');

    await flush();
    // Revealed as an actionable control: idle means "press me to connect".
    expect(midiIcon(div)!.dataset.state).toBe('idle');
    expect(midiIcon(div)!.style.display).not.toBe('none');
  });

  it('the icon WORKS after a mount-time refusal — it is wired under enableMidi too', async () => {
    const requestMIDIAccess = stubMidi('refused');
    const div = container();
    mountFullUI(div, { enableMidi: true });
    await flush();

    const icon = midiIcon(div)!;
    const callsAfterMount = requestMIDIAccess.mock.calls.length;
    expect(callsAfterMount).toBe(1);

    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    // The click is a real user gesture: it asks again...
    expect(requestMIDIAccess.mock.calls.length).toBe(callsAfterMount + 1);
    // ...and because the user initiated it, this refusal DOES explain itself.
    expect(status(div)!.textContent).toMatch(
      /MIDI access was denied|MIDI needs permission for this site/,
    );
    expect(status(div)!.classList.contains('qap-midi-status--warn')).toBe(true);
    expect(['refused', 'notGranted']).toContain(icon.dataset.state);
    expect(helpOpen(div), 'the reason is visible text, not just a tooltip').toBe(true);
  });

  it('a USER-INITIATED refusal still explains itself', async () => {
    stubMidi('refused');
    const div = container();
    // No enableMidi: the icon is idle from the start, and clicking it is the
    // user asking.
    mountFullUI(div, {});
    await flush();

    const icon = midiIcon(div);
    expect(icon).not.toBeNull();
    expect(icon!.dataset.state).toBe('idle');
    icon!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(status(div)!.textContent).toMatch(
      /MIDI access was denied|MIDI needs permission for this site/,
    );
    expect(status(div)!.classList.contains('qap-midi-status--warn')).toBe(true);
    expect(helpOpen(div)).toBe(true);
  });

  it('a successful auto-connect reports MIDI on (no-device with nothing plugged in)', async () => {
    stubMidi('granted');
    const div = container();
    mountFullUI(div, { enableMidi: true });
    await flush();
    await flush();

    expect(status(div)!.textContent).toContain('MIDI on');
    expect(status(div)!.classList.contains('qap-midi-status--ok')).toBe(true);
    expect(midiIcon(div)!.dataset.state).toBe('no-device');
  });

  it('an unsupported browser keeps its capability caption', async () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    const div = container();
    mountFullUI(div, { enableMidi: true });
    await flush();

    expect(status(div)!.textContent).toContain(
      "MIDI keyboards aren't supported in this browser",
    );
    // A capability statement is not a denial: the icon is struck through,
    // and clicking it explains rather than asking.
    const icon = midiIcon(div)!;
    expect(icon.dataset.state).toBe('unsupported');
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(helpOpen(div)).toBe(true);
  });
});
