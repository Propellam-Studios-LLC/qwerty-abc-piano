import { describe, it, expect, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// Keyboard edge cases: key auto-repeat, keys typed into other controls, IME
// composition, Caps Lock and Cmd+Z.

const instances: QWERTYToABCPiano[] = [];
function make(options: ConstructorParameters<typeof QWERTYToABCPiano>[0] = {}) {
  const inst = new QWERTYToABCPiano({ barlineMode: 'manual', ...options });
  instances.push(inst);
  return inst;
}
const nodes: Element[] = [];
afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (nodes.length) nodes.pop()!.remove();
});

function keydown(key: string, opts: KeyboardEventInit = {}, target: EventTarget = document): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...opts });
  target.dispatchEvent(ev);
  return ev;
}
function attach<T extends Element>(node: T): T {
  document.body.appendChild(node);
  nodes.push(node);
  return node;
}

describe('auto-repeat is ignored for note, rest and chord keys', () => {
  it('holding H writes one note, not ccc', () => {
    const inst = make();
    keydown('h');
    keydown('h', { repeat: true });
    keydown('h', { repeat: true });
    expect(inst.getABC()).toBe('C');
  });

  it('a held rest key writes one rest', () => {
    const inst = make();
    keydown('z');
    keydown('z', { repeat: true });
    expect(inst.getABC()).toBe('z');
  });

  it('held chord brackets do not re-open or re-commit', () => {
    const inst = make();
    keydown('(');
    keydown('(', { repeat: true });
    keydown('h');
    keydown('k');
    keydown(')');
    keydown(')', { repeat: true });
    expect(inst.getABC()).toBe('[CE]');
    expect(inst.isChordOpen()).toBe(false);
  });

  it('a repeat keystroke on a note key still suppresses the browser default', () => {
    make();
    keydown('h');
    const ev = keydown("'", { repeat: true });
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('keys typed into other controls are left alone', () => {
  it('ignores keys from a <select>', () => {
    const inst = make();
    const sel = attach(document.createElement('select'));
    keydown('h', {}, sel);
    expect(inst.getABC()).toBe('');
  });

  it('uses the composed path, so an <input> inside a shadow root is skipped', () => {
    const inst = make();
    const host = attach(document.createElement('div'));
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.appendChild(input);
    keydown('h', {}, input);
    expect(inst.getABC()).toBe('');
  });

  it('Space on a focused button is not hijacked (the button still activates)', () => {
    const inst = make();
    const button = attach(document.createElement('button'));
    const ev = keydown(' ', {}, button);
    expect(ev.defaultPrevented).toBe(false);
    expect(inst.getABC()).toBe('');
  });

  it('Enter on a link or [role=button] does not start playback', () => {
    let played = 0;
    make({ onPlayback: () => { played++; } });
    const a = attach(document.createElement('a'));
    a.setAttribute('href', '#');
    const div = attach(document.createElement('div'));
    div.setAttribute('role', 'button');
    keydown('Enter', {}, a);
    keydown('Enter', {}, div);
    expect(played).toBe(0);
  });

  it('note keys still work while a button has focus', () => {
    const inst = make();
    const button = attach(document.createElement('button'));
    keydown('h', {}, button);
    expect(inst.getABC()).toBe('C');
  });
});

describe('IME, Caps Lock and Cmd+Z', () => {
  it('ignores keystrokes during IME composition', () => {
    const inst = make();
    keydown('h', { isComposing: true });
    expect(inst.getABC()).toBe('');
  });

  it('Caps Lock (uppercase key values) still plays notes and controls', () => {
    const inst = make();
    keydown('H');
    keydown('E');
    keydown('Z');
    expect(inst.getABC()).toBe('C^F,z');
  });

  it('Cmd+Z undoes, like Ctrl+Z', () => {
    const inst = make();
    keydown('h');
    keydown('j');
    keydown('z', { metaKey: true });
    expect(inst.getABC()).toBe('C');
    keydown('Z', { ctrlKey: true }); // Caps Lock + Ctrl+Z
    expect(inst.getABC()).toBe('');
  });

  it('Ctrl+Shift+Z (redo in most apps) does not undo', () => {
    const inst = make();
    keydown('h');
    keydown('Z', { ctrlKey: true, shiftKey: true });
    expect(inst.getABC()).toBe('C');
  });

  it('raw ABC chord symbols keep their case', () => {
    const inst = make();
    keydown('"');
    for (const k of ['G', 'm', '"']) keydown(k);
    keydown('h');
    expect(inst.getABC()).toBe('"Gm"C');
  });
});
