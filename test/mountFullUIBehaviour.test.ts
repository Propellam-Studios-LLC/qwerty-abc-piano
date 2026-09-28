import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import type { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// mountFullUI behaviour: what Escape does, re-mounting and destroy(), and the
// Advanced panel's label toggles and aria wiring.

const mounts: QWERTYToABCPiano[] = [];
const nodes: HTMLElement[] = [];
function div(): HTMLElement {
  const d = document.createElement('div');
  document.body.appendChild(d);
  nodes.push(d);
  return d;
}
function mount(target: HTMLElement, opts: Parameters<typeof mountFullUI>[1] = {}) {
  const ui = mountFullUI(target, opts);
  mounts.push(ui);
  return ui;
}
afterEach(() => {
  while (mounts.length) mounts.pop()!.destroy();
  while (nodes.length) nodes.pop()!.remove();
});
function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

describe('Escape in mountFullUI', () => {
  it('does nothing by default', () => {
    const ui = mount(div());
    press('h');
    press('Escape');
    expect(ui.getABC()).toBe('C');
  });

  it('clears when the host opts in with escapeClears', () => {
    const ui = mount(div(), { escapeClears: true });
    press('h');
    press('Escape');
    expect(ui.getABC()).toBe('');
  });

  it('calls the host onClearRequested instead of clearing', () => {
    const onClearRequested = vi.fn();
    const ui = mount(div(), { onClearRequested });
    press('h');
    press('Escape');
    expect(onClearRequested).toHaveBeenCalledTimes(1);
    expect(ui.getABC()).toBe('C');
  });

  it('the Clear button still clears', () => {
    const d = div();
    const ui = mount(d);
    press('h');
    d.querySelector<HTMLButtonElement>('.qap-clear-btn')!.click();
    expect(ui.getABC()).toBe('');
  });
});

describe('re-mounting and destroy()', () => {
  it('re-mounting into the same container destroys the previous instance', () => {
    const d = div();
    const first = mountFullUI(d, {});
    const second = mount(d);
    press('h');
    expect(first.getABC()).toBe('');
    expect(second.getABC()).toBe('C');
    expect(d.querySelectorAll('svg.qap-piano')).toHaveLength(1);
  });

  it('destroy() empties the container', () => {
    const d = div();
    const ui = mountFullUI(d, {});
    expect(d.childElementCount).toBeGreaterThan(0);
    ui.destroy();
    expect(d.childElementCount).toBe(0);
    expect(d.classList.contains('qap-full-ui')).toBe(false);
  });
});

describe('Advanced panel label toggles', () => {
  it('start from options.showNoteNames / showKeyLabels', () => {
    const d = div();
    mount(d, { showNoteNames: false, showKeyLabels: true });
    const names = d.querySelector<HTMLInputElement>('.qap-show-note-names input')!;
    const keys = d.querySelector<HTMLInputElement>('.qap-show-key-labels input')!;
    expect(names.checked).toBe(false);
    expect(keys.checked).toBe(true);
    expect(d.querySelector('svg.qap-piano')!.classList.contains('qap-no-note-names')).toBe(true);
  });

  it('use no ids, so two mounts on a page cannot collide', () => {
    const a = div();
    const b = div();
    mount(a);
    mount(b);
    for (const d of [a, b]) {
      const label = d.querySelector('.qap-show-note-names')!;
      expect(label.tagName).toBe('LABEL');
      expect(label.querySelector('input')!.id).toBe('');
      expect(label.getAttribute('for')).toBeNull();
    }
    expect(document.getElementById('qap-show-note-names')).toBeNull();
  });
});

describe('Advanced toggle aria', () => {
  it('has aria-expanded / aria-controls pointing at a unique panel id', () => {
    const a = div();
    const b = div();
    mount(a);
    mount(b);
    const toggleA = a.querySelector<HTMLButtonElement>('.qap-adv-toggle')!;
    const panelA = a.querySelector<HTMLElement>('.qap-adv-panel')!;
    const panelB = b.querySelector<HTMLElement>('.qap-adv-panel')!;
    expect(toggleA.getAttribute('aria-controls')).toBe(panelA.id);
    expect(panelA.id).not.toBe(panelB.id);
    expect(toggleA.getAttribute('aria-expanded')).toBe('false');
    toggleA.click();
    expect(toggleA.getAttribute('aria-expanded')).toBe('true');
    expect(panelA.classList.contains('qap-adv-hidden')).toBe(false);
    toggleA.click();
    expect(toggleA.getAttribute('aria-expanded')).toBe('false');
  });
});
