import { describe, it, expect, afterEach, vi } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import type { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// The touch range row's Low and High steppers, and their interplay with the
// auto-range ResizeObserver. happy-dom has no layout, so the observer is
// stubbed and fired by hand: in a browser whose mount has no fixed height, a
// stepper press redraws the board, the mount's height changes, and the
// observer fires with the width unchanged.

const instances: QWERTYToABCPiano[] = [];
const containers: HTMLElement[] = [];

function setTouch(on: boolean): void {
  if (on) {
    (window as unknown as { ontouchstart?: unknown }).ontouchstart = null;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  } else {
    delete (window as unknown as { ontouchstart?: unknown }).ontouchstart;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  }
}

afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (containers.length) containers.pop()!.remove();
  setTouch(false);
  vi.unstubAllGlobals();
});

/** Mounts a touch board at `width` px with a hand-fired ResizeObserver. */
function mountTouch(width: number, options: Parameters<typeof mountFullUI>[1] = {}) {
  let fire: (() => void) | null = null;
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { fire = cb; }
    observe(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  });
  setTouch(true);
  const div = document.createElement('div');
  let w = width;
  Object.defineProperty(div, 'clientWidth', { get: () => w, configurable: true });
  document.body.appendChild(div);
  containers.push(div);
  const piano = mountFullUI(div, options);
  instances.push(piano);

  const b = div.querySelectorAll<HTMLButtonElement>('.qap-range-group .qap-range-btn');
  // [◀ 8ve, 8ve ▶, low −, low +, high −, high +]
  const btn = { octDown: b[0], octUp: b[1], lowDec: b[2], lowInc: b[3], highDec: b[4], highInc: b[5] };
  const vals = () => [...div.querySelectorAll('.qap-range-val')].map(e => e.textContent);
  const keys = () => [...div.querySelectorAll('rect.qap-key-white')].map(k => k.getAttribute('data-key'));
  return {
    div, btn,
    window: () => div.querySelector('.qap-range-window')!.textContent,
    low: () => vals()[1],
    high: () => vals()[2],
    keys,
    /** The redraw-driven observer tick: same width, new height. */
    reflow: () => fire?.(),
    resize: (px: number) => { w = px; fire?.(); },
  };
}

describe('auto-range observer does not undo a stepper press', () => {
  it('high + survives the reflow it causes', () => {
    const m = mountTouch(390);
    expect(m.window()).toBe('C4–B4');
    m.btn.highInc.click();
    m.reflow();
    expect(m.high()).toBe('C5');
    expect(m.keys().at(-1)).toBe('C5');
  });

  it('high + then high − both stick', () => {
    const m = mountTouch(390);
    m.btn.highInc.click(); m.reflow();
    m.btn.highInc.click(); m.reflow();
    expect(m.high()).toBe('D5');
    m.btn.highDec.click(); m.reflow();
    expect(m.high()).toBe('C5');
    expect(m.keys()).toHaveLength(8);
  });

  it('low − survives the reflow', () => {
    const m = mountTouch(390);
    m.btn.lowDec.click(); m.reflow();
    expect(m.window()).toBe('B3–B4');
    expect(m.keys()[0]).toBe('B3');
  });

  it('an octave shift survives the reflow', () => {
    const m = mountTouch(390);
    m.btn.octUp.click(); m.reflow();
    expect(m.window()).toBe('C5–B5');
    m.btn.highInc.click(); m.reflow();
    expect(m.window()).toBe('C5–C6');
  });

  it('a wide board keeps a stepper press too', () => {
    const m = mountTouch(1000);
    expect(m.window()).toBe('C4–B5');
    m.btn.highDec.click(); m.reflow();
    expect(m.high()).toBe('A5');
  });

  it('a real width-class change (rotation) still re-picks the board', () => {
    const m = mountTouch(390);
    m.btn.highInc.click(); m.reflow();
    m.resize(900);
    expect(m.window()).toBe('C4–B5');
    expect(m.keys()).toHaveLength(14);
    m.resize(390);
    expect(m.window()).toBe('C4–B4');
  });

  it('re-picking keeps the bottom note of a moved window, never inverting it', () => {
    const m = mountTouch(1000);
    m.btn.octUp.click(); // C5–B6
    m.resize(390);
    expect(m.window()).toBe('C5–B5');
  });

  it('a mount sized after creation (first width 0) picks the phone board', () => {
    const m = mountTouch(0);
    expect(m.window()).toBe('C4–B5');
    m.resize(390);
    expect(m.window()).toBe('C4–B4');
    m.btn.highInc.click(); m.reflow();
    expect(m.high()).toBe('C5');
  });
});

describe('min span: one C-to-B octave', () => {
  it('the phone default C4–B4 cannot narrow, so low + and high − are disabled', () => {
    const m = mountTouch(390);
    expect(m.btn.lowInc.disabled).toBe(true);
    expect(m.btn.highDec.disabled).toBe(true);
    expect(m.btn.lowDec.disabled).toBe(false);
    expect(m.btn.highInc.disabled).toBe(false);
    m.btn.lowInc.click();
    m.btn.highDec.click();
    expect(m.window()).toBe('C4–B4');
  });

  it('after high + to C5, high − and low + work again', () => {
    const m = mountTouch(390);
    m.btn.highInc.click();
    expect(m.btn.highDec.disabled).toBe(false);
    expect(m.btn.lowInc.disabled).toBe(false);
    m.btn.highDec.click();
    expect(m.window()).toBe('C4–B4');
    m.btn.highInc.click();
    m.btn.lowInc.click();
    expect(m.window()).toBe('D4–C5');
    expect(m.keys()).toHaveLength(7);
    expect(m.btn.lowInc.disabled).toBe(true);
    expect(m.btn.highDec.disabled).toBe(true);
  });

  it('a wide board narrows down to one octave and stops there', () => {
    const m = mountTouch(1000);
    for (let i = 0; i < 10; i++) m.btn.highDec.click();
    expect(m.window()).toBe('C4–B4');
    expect(m.btn.highDec.disabled).toBe(true);
    for (let i = 0; i < 10; i++) m.btn.lowInc.click();
    expect(m.window()).toBe('C4–B4');
  });

  it('low − and high + disable at the ends of the range', () => {
    const m = mountTouch(390);
    for (let i = 0; i < 40; i++) m.btn.lowDec.click();
    expect(m.btn.lowDec.disabled).toBe(true);
    expect(m.low()).toBe('C2');
    for (let i = 0; i < 40; i++) m.btn.highInc.click();
    expect(m.btn.highInc.disabled).toBe(true);
    expect(m.btn.highInc.isConnected).toBe(true);
  });

  it('low − and high + disable at the allowed span', () => {
    const m = mountTouch(390, { allowedPitches: { low: 'C4', high: 'D5' } });
    expect(m.btn.lowDec.disabled).toBe(true);
    m.btn.highInc.click();
    m.btn.highInc.click();
    expect(m.high()).toBe('D5');
    expect(m.btn.highInc.disabled).toBe(true);
  });
});
