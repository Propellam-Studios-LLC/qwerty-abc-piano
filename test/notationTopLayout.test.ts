import { describe, it, expect, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// Notation layout on narrow screens. On a phone the keyboard shrinks to the
// screen width but an engraved staff line does not, and with the notation on
// top the transport should sit with it rather than at the bottom of the tool.
// Two behaviours, both inside mountFullUI:
//   1. the notation panel scrolls SIDEWAYS (jsdom does no layout, so the
//      assertion is on the injected stylesheet, which is where the rule lives);
//   2. with notationPosition:'top', the transport is the notation's next
//      sibling instead of the tool's last child.

const containers: HTMLElement[] = [];

function container(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

afterEach(() => {
  while (containers.length) containers.pop()!.remove();
});

function find(div: HTMLElement, selector: string): HTMLElement | null {
  return div.querySelector(selector);
}

/** Position of `selector` among its parent's children, or -1. */
function indexOf(div: HTMLElement, selector: string): number {
  const el = find(div, selector);
  if (!el) return -1;
  return Array.from(el.parentElement!.children).indexOf(el);
}

/// "At the bottom of the tool" means AFTER the edit row — not literally the
/// last child, because the Advanced panel is appended after everything. At
/// 'bottom' the transport sits directly under the notation; at 'top' the
/// notation moves to the front and the transport must move with it rather than
/// stay down here on its own.
function isBelowTheKeyboard(div: HTMLElement, selector: string): boolean {
  const el = find(div, selector)!;
  const editRow = find(div, '.qap-edit-row')!;
  return (
    (editRow.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

/** The mount injects its stylesheet into the document, not the container. */
function styleText(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
}

describe('notationPosition: "top" moves the transport with the notation', () => {
  it('the playback wrap is the notation wrap\'s next sibling', () => {
    const div = container();
    mountFullUI(div, { notationPosition: 'top' });
    const notation = find(div, '.qap-notation-wrap');
    expect(notation, 'notation renders').not.toBeNull();
    expect(
      notation!.nextElementSibling?.classList.contains('qap-playback-wrap'),
      'transport sits directly below the notation',
    ).toBe(true);
    // And the notation is still first overall — so the pair as a whole
    // moved, rather than the transport merely changing places.
    expect(indexOf(div, '.qap-notation-wrap')).toBe(0);
    expect(isBelowTheKeyboard(div, '.qap-playback-wrap')).toBe(false);
  });

  it('"bottom" — and the default — keep the transport last, unchanged', () => {
    for (const opts of [{ notationPosition: 'bottom' as const }, {}]) {
      const div = container();
      mountFullUI(div, opts);
      // The transport stays at the bottom of the tool, with the notation
      // directly above it.
      expect(isBelowTheKeyboard(div, '.qap-playback-wrap')).toBe(true);
      expect(
        find(div, '.qap-notation-wrap')!.nextElementSibling
          ?.classList.contains('qap-playback-wrap'),
      ).toBe(true);
    }
  });

  it('"top" with showTransport:false renders no empty transport strip', () => {
    const div = container();
    mountFullUI(div, { notationPosition: 'top', showTransport: false });
    expect(div.querySelector('.qap-playback-wrap')).toBeNull();
    expect(indexOf(div, '.qap-notation-wrap')).toBe(0);
  });

  it('"top" with showNotation:false leaves the transport at the bottom', () => {
    const div = container();
    mountFullUI(div, { notationPosition: 'top', showNotation: false });
    expect(div.querySelector('.qap-notation-wrap')).toBeNull();
    expect(isBelowTheKeyboard(div, '.qap-playback-wrap')).toBe(true);
  });
});

describe('the notation panel scrolls sideways', () => {
  it('the WRAP owns both scroll axes', () => {
    const div = container();
    mountFullUI(div, {});
    const css = styleText();
    const rule = css.split('\n').find((l) => l.includes('.qap-notation-wrap {'))!;
    expect(rule, '.qap-notation-wrap rule exists').toBeTruthy();
    expect(rule).toContain('overflow-x: auto');
    expect(rule, 'the vertical scroll cap stays').toContain('overflow-y: auto');
  });

  it('the INNER sizes to the engraved SVG, which is what gives the wrap a '
     + 'horizontal range', () => {
    const div = container();
    mountFullUI(div, {});
    const css = styleText();
    const rule = css.split('\n').find((l) => l.includes('.qap-notation-inner {'))!;
    expect(rule, '.qap-notation-inner rule exists').toBeTruthy();
    expect(rule).toContain('max-content');
    expect(rule, 'a short staff still fills the panel').toContain('min-width: 100%');
  });

  it('both elements are actually rendered, so the rules have subjects', () => {
    const div = container();
    mountFullUI(div, {});
    expect(div.querySelector('.qap-notation-wrap')).not.toBeNull();
    expect(div.querySelector('.qap-notation-inner')).not.toBeNull();
  });
});
