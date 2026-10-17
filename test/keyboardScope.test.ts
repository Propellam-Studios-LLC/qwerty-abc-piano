import { describe, it, expect, afterEach, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import type { MIDIMessageEvent } from '../src/types.js';

// keyboardScope: 'focus' lets several pianos share a page: only the active
// one (focus inside it, or the last one touched or clicked) hears the
// keyboard and Web MIDI. 'document', the default, is unchanged.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const div = container();
  const inst = new QWERTYToABCPiano({ pianoTarget: div, autoBarline: false, ...options });
  instances.push(inst);
  return { inst, div };
}

function press(k: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
}

function pointerDown(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
  vi.unstubAllGlobals();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("keyboardScope: 'document' (default)", () => {
  it('every instance hears every key, as before', () => {
    const a = make();
    const b = make();
    press('h');
    expect(a.inst.getABC()).toBe('C');
    expect(b.inst.getABC()).toBe('C');
  });
});

describe("keyboardScope: 'focus'", () => {
  it('no instance hears the keyboard until one is interacted with', () => {
    const a = make({ keyboardScope: 'focus' });
    press('h');
    expect(a.inst.getABC()).toBe('');
  });

  it('only the most recently touched or clicked instance records', () => {
    const a = make({ keyboardScope: 'focus' });
    const b = make({ keyboardScope: 'focus' });
    pointerDown(a.div.querySelector('svg')!);
    press('h');
    pointerDown(b.div.querySelector('svg')!);
    press('j');
    expect(a.inst.getABC()).toBe('C');
    expect(b.inst.getABC()).toBe('D');
  });

  it('focus inside an instance wins over the last click', () => {
    const a = make({ keyboardScope: 'focus' });
    const b = make({ keyboardScope: 'focus' });
    const btn = document.createElement('button');
    b.div.appendChild(btn);
    pointerDown(a.div);
    btn.focus();
    press('k');
    expect(a.inst.getABC()).toBe('');
    expect(b.inst.getABC()).toBe('E');
  });

  it("a 'document' instance on the same page still hears every key", () => {
    const a = make({ keyboardScope: 'focus' });
    const doc = make();
    pointerDown(a.div);
    press('h');
    expect(a.inst.getABC()).toBe('C');
    expect(doc.inst.getABC()).toBe('C');
  });

  it('a destroyed instance stops being the active one', () => {
    const a = make({ keyboardScope: 'focus' });
    pointerDown(a.div);
    a.inst.destroy();
    const b = make({ keyboardScope: 'focus' });
    press('h');
    expect(b.inst.getABC()).toBe('');
  });

  it('Web MIDI goes to the active instance, even when another holds the input', async () => {
    let handler: ((e: MIDIMessageEvent) => void) | null = null;
    const input = {
      id: 'in', name: 'kbd', state: 'connected',
      get onmidimessage() { return handler; },
      set onmidimessage(h) { handler = h; },
      close: async () => {},
    };
    const access = { inputs: new Map([['in', input]]), onstatechange: null };
    vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: vi.fn().mockResolvedValue(access) });

    const a = make({ keyboardScope: 'focus' });
    const b = make({ keyboardScope: 'focus' });
    await a.inst.enableMidiInput(); // only A holds MIDI access
    const noteOn = (n: number) => handler!({ data: new Uint8Array([0x90, n, 100]) } as unknown as MIDIMessageEvent);

    pointerDown(b.div);
    noteOn(60);
    pointerDown(a.div);
    noteOn(62);
    expect(b.inst.getABC()).toBe('C');
    expect(a.inst.getABC()).toBe('D');
  });
});

describe("mountFullUI with keyboardScope: 'focus'", () => {
  it('makes the container focusable and labelled, and undoes it on destroy', () => {
    const div = container();
    const piano = mountFullUI(div, { keyboardScope: 'focus' });
    expect(div.getAttribute('tabindex')).toBe('0');
    expect(div.getAttribute('role')).toBe('group');
    expect(div.classList.contains('qap-focus-scope')).toBe(true);
    piano.destroy();
    expect(div.hasAttribute('tabindex')).toBe(false);
    expect(div.classList.contains('qap-focus-scope')).toBe(false);
  });

  it('keeps a tabindex the host set', () => {
    const div = container();
    div.setAttribute('tabindex', '-1');
    instances.push(mountFullUI(div, { keyboardScope: 'focus' }));
    expect(div.getAttribute('tabindex')).toBe('-1');
  });

  it('focusing a mount routes the keyboard to it', () => {
    const d1 = container();
    const d2 = container();
    const p1 = mountFullUI(d1, { keyboardScope: 'focus', barlineMode: 'none' });
    const p2 = mountFullUI(d2, { keyboardScope: 'focus', barlineMode: 'none' });
    instances.push(p1, p2);
    d2.focus();
    press('h');
    d1.focus();
    press('j');
    expect(p1.getABC()).toBe('D');
    expect(p2.getABC()).toBe('C');
  });

  it('draws a focus ring', () => {
    instances.push(mountFullUI(container(), { keyboardScope: 'focus' }));
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    expect(css).toMatch(/\.qap-focus-scope:focus-within\s*\{[^}]*outline:/);
  });

  it('without the option the container is untouched', () => {
    const div = container();
    instances.push(mountFullUI(div, {}));
    expect(div.hasAttribute('tabindex')).toBe(false);
  });
});
