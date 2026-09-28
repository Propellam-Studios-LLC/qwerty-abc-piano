import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// The MIDI icon (.qap-midi-indicator), whose data-state shows the MIDI
// connection state, and the `?` help panel that puts that state into words.

const mounts: QWERTYToABCPiano[] = [];
const nodes: HTMLElement[] = [];
function container(): HTMLElement {
  const d = document.createElement('div');
  document.body.appendChild(d);
  nodes.push(d);
  return d;
}
function mount(div: HTMLElement, opts: Parameters<typeof mountFullUI>[1] = {}) {
  const ui = mountFullUI(div, opts);
  mounts.push(ui);
  return ui;
}
afterEach(() => {
  while (mounts.length) mounts.pop()!.destroy();
  while (nodes.length) nodes.pop()!.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const flush = () => new Promise<void>(r => setTimeout(r, 0));

type FakeInput = { id: string; name: string; state: 'connected' | 'disconnected'; onmidimessage: unknown };
type FakeAccess = { inputs: Map<string, FakeInput>; onstatechange: ((e: Event) => void) | null };

function fakeAccess(...states: Array<'connected' | 'disconnected'>): FakeAccess {
  const inputs = new Map<string, FakeInput>();
  states.forEach((state, i) => inputs.set(String(i), { id: String(i), name: `k${i}`, state, onmidimessage: null }));
  return { inputs, onstatechange: null };
}
function grant(access: FakeAccess) {
  const requestMIDIAccess = vi.fn().mockResolvedValue(access);
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
  return requestMIDIAccess;
}
const icon = (div: HTMLElement) => div.querySelector<HTMLElement>('.qap-midi-indicator')!;
const state = (div: HTMLElement) => icon(div).dataset.state;
const statusText = (div: HTMLElement) => div.querySelector('.qap-midi-status')!.textContent ?? '';
const panel = (div: HTMLElement) => div.querySelector<HTMLElement>('.qap-help-panel')!;
const helpOpen = (div: HTMLElement) => !panel(div).classList.contains('qap-adv-hidden');

describe('core: device count, not just the grant', () => {
  it('getMidiInputCount counts only inputs whose state is connected', async () => {
    grant(fakeAccess('connected', 'disconnected', 'connected'));
    const inst = new QWERTYToABCPiano({});
    mounts.push(inst);
    expect(inst.getMidiInputCount()).toBe(0);
    await inst.enableMidiInput();
    expect(inst.getMidiInputCount()).toBe(2);
  });

  it('onMidiStateChange fires on grant, on plug-in and on unplug', async () => {
    const access = fakeAccess();
    grant(access);
    const onMidiStateChange = vi.fn();
    const inst = new QWERTYToABCPiano({ onMidiStateChange });
    mounts.push(inst);
    await inst.enableMidiInput();
    expect(onMidiStateChange).toHaveBeenLastCalledWith(0);

    access.inputs.set('a', { id: 'a', name: 'kbd', state: 'connected', onmidimessage: null });
    access.onstatechange!(new Event('statechange'));
    expect(onMidiStateChange).toHaveBeenLastCalledWith(1);
    // The newly plugged-in input is listened to.
    expect(access.inputs.get('a')!.onmidimessage).toBeTypeOf('function');

    access.inputs.get('a')!.state = 'disconnected';
    access.onstatechange!(new Event('statechange'));
    expect(onMidiStateChange).toHaveBeenLastCalledWith(0);
  });
});

describe('MIDI icon states', () => {
  it('unsupported: no Web MIDI', () => {
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: undefined });
    const div = container();
    mount(div);
    expect(state(div)).toBe('unsupported');
    expect(icon(div).title).toMatch(/aren.t supported/);
  });

  it('idle before anything is requested — and the prompt is NOT fired on mount', () => {
    const requestMIDIAccess = grant(fakeAccess());
    const div = container();
    mount(div);
    expect(state(div)).toBe('idle');
    expect(icon(div).getAttribute('aria-label')).toBe('Connect a MIDI keyboard');
    expect(requestMIDIAccess).not.toHaveBeenCalled();
  });

  it('pending while the permission prompt is open', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal('navigator', {
      ...navigator, requestMIDIAccess: vi.fn(() => new Promise(r => { resolve = r; })),
    });
    const div = container();
    mount(div);
    icon(div).click();
    expect(state(div)).toBe('pending');
    resolve(fakeAccess());
    await flush();
    expect(state(div)).toBe('no-device');
  });

  it('no-device when access is granted with nothing plugged in; connected once a device appears', async () => {
    const access = fakeAccess();
    grant(access);
    const div = container();
    mount(div);
    icon(div).click();
    await flush();
    expect(state(div)).toBe('no-device');
    expect(statusText(div)).toMatch(/MIDI on — no keyboard detected/);

    access.inputs.set('a', { id: 'a', name: 'kbd', state: 'connected', onmidimessage: null });
    access.onstatechange!(new Event('statechange'));
    expect(state(div)).toBe('connected');
    expect(statusText(div)).toMatch(/1 keyboard connected/);
    expect(icon(div).getAttribute('aria-label')).toBe('MIDI keyboard connected');
  });

  it('connected straight away when a device is already plugged in', async () => {
    grant(fakeAccess('connected', 'connected'));
    const div = container();
    mount(div);
    icon(div).click();
    await flush();
    expect(state(div)).toBe('connected');
    expect(statusText(div)).toMatch(/2 keyboards connected/);
  });

  it('a disconnect drops back to no-device', async () => {
    const access = fakeAccess('connected');
    grant(access);
    const div = container();
    mount(div);
    icon(div).click();
    await flush();
    expect(state(div)).toBe('connected');
    access.inputs.get('0')!.state = 'disconnected';
    access.onstatechange!(new Event('statechange'));
    expect(state(div)).toBe('no-device');
  });

  it('notGranted and refused are distinct red states, and clicking asks again', async () => {
    for (const [name, expected] of [['SecurityError', 'notGranted'], ['NotAllowedError', 'refused']] as const) {
      const err = new Error('x'); err.name = name;
      const requestMIDIAccess = vi.fn().mockRejectedValue(err);
      vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess });
      const div = container();
      mount(div);
      icon(div).click();
      await flush();
      expect(state(div)).toBe(expected);
      icon(div).click();
      await flush();
      expect(requestMIDIAccess).toHaveBeenCalledTimes(2);
    }
  });

  it('clicking in an informational state opens the help panel at MIDI instead of asking', async () => {
    const requestMIDIAccess = grant(fakeAccess());
    const div = container();
    mount(div);
    icon(div).click();
    await flush();
    expect(state(div)).toBe('no-device');
    expect(helpOpen(div)).toBe(false);
    icon(div).click();
    expect(helpOpen(div)).toBe(true);
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it('every state has an aria-label and a title', async () => {
    const div = container();
    grant(fakeAccess());
    mount(div);
    const i = icon(div);
    expect(i.getAttribute('aria-label')).toBeTruthy();
    expect(i.title).toBe(i.getAttribute('aria-label'));
  });

  it('midiButton:false hides the icon entirely (and the MIDI help section)', () => {
    grant(fakeAccess());
    const div = container();
    mount(div, { midiButton: false });
    expect(div.querySelector('.qap-midi-indicator')).toBeNull();
    expect(div.querySelector('.qap-help-midi')).toBeNull();
    expect(div.querySelector('.qap-help-keys')).not.toBeNull();
  });

  it('the handle’s connectMidi() drives the icon, and a host onMidiStateChange still fires', async () => {
    const access = fakeAccess('connected');
    grant(access);
    const onMidiStateChange = vi.fn();
    const div = container();
    const ui = mount(div, { onMidiStateChange });
    expect(await ui.fullUI.connectMidi()).toBe(true);
    expect(state(div)).toBe('connected');
    expect(onMidiStateChange).toHaveBeenCalledWith(1);
  });
});

describe('help panel', () => {
  it('the ? toggle folds the panel out and back, with aria-expanded/controls', () => {
    const div = container();
    mount(div);
    const toggle = div.querySelector<HTMLButtonElement>('.qap-help-toggle')!;
    expect(toggle.getAttribute('aria-controls')).toBe(panel(div).id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(helpOpen(div)).toBe(false);
    toggle.click();
    expect(helpOpen(div)).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(helpOpen(div)).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('sits next to ⚙ Advanced and has MIDI, shortcuts and reference sections', () => {
    const div = container();
    mount(div);
    const toggle = div.querySelector('.qap-help-toggle')!;
    expect(toggle.nextElementSibling!.classList.contains('qap-adv-toggle')).toBe(true);
    expect(div.querySelector('.qap-help-midi .qap-midi-status')!.getAttribute('aria-live')).toBe('polite');
    expect(div.querySelectorAll('.qap-midi-legend li').length).toBeGreaterThanOrEqual(6);
    const keys = div.querySelector('.qap-help-keys')!.textContent!;
    for (const k of ['Q', '( … )', 'Backspace', 'Enter', '1 – 6', 'Triplet', 'Undo', 'Play']) {
      expect(keys).toContain(k);
    }
    // Esc does nothing by default in a mount, so it is not advertised…
    expect(keys).not.toContain('Esc —');
    expect([...div.querySelectorAll('.qap-help-keys kbd')].map(k => k.textContent)).not.toContain('Esc');
  });

  it('…but is listed when the host opts in', () => {
    const div = container();
    mount(div, { escapeClears: true });
    expect([...div.querySelectorAll('.qap-help-keys kbd')].map(k => k.textContent)).toContain('Esc');
  });

  it('links to the full reference in a new tab (default and custom helpUrl)', () => {
    const a = container();
    mount(a);
    const link = a.querySelector<HTMLAnchorElement>('.qap-help-link')!;
    expect(link.getAttribute('href')).toBe('https://propellamstudios.com');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');

    const b = container();
    mount(b, { helpUrl: 'https://example.com/docs' });
    expect(b.querySelector('.qap-help-link')!.getAttribute('href')).toBe('https://example.com/docs');
  });

  it('showHelp:false removes the ? button; showAdvanced:false keeps it', () => {
    const a = container();
    mount(a, { showHelp: false });
    expect(a.querySelector('.qap-help-toggle')).toBeNull();
    expect(a.querySelector('.qap-help-keys')).toBeNull();
    // The MIDI icon can still explain itself.
    expect(a.querySelector('.qap-help-midi')).not.toBeNull();

    const b = container();
    mount(b, { showAdvanced: false });
    expect(b.querySelector('.qap-help-toggle')).not.toBeNull();
  });
});
