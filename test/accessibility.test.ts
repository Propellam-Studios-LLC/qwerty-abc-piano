import { describe, it, expect, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import { TAP_HINT } from '../src/ui/tapButton.js';

// Accessibility of the input controls: the tap button leaves focus where it
// is and carries an accurate hint, and toggle buttons expose aria-pressed.

const instances: QWERTYToABCPiano[] = [];
const nodes: Element[] = [];
function div(): HTMLElement {
  const d = document.createElement('div');
  document.body.appendChild(d);
  nodes.push(d);
  return d;
}
afterEach(() => {
  while (instances.length) instances.pop()!.destroy();
  while (nodes.length) nodes.pop()!.remove();
});

describe('tap button', () => {
  it('does not steal focus when rendered', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    nodes.push(outside);
    outside.focus();
    const target = div();
    instances.push(new QWERTYToABCPiano({ pianoTarget: target, percussionMode: true }));
    expect(target.querySelector('.qap-tap-btn')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('both tap buttons carry the same, accurate hint', () => {
    const target = div();
    instances.push(new QWERTYToABCPiano({ pianoTarget: target, percussionMode: true }));
    const mount = div();
    instances.push(mountFullUI(mount, { percussionMode: true }));
    expect(TAP_HINT).toBe('(or press any note key)');
    expect(target.querySelector('.qap-tap-hint')!.textContent).toBe(TAP_HINT);
    expect(mount.querySelector('.qap-tap-hint')!.textContent).toBe(TAP_HINT);
  });
});

describe('toggle buttons expose aria-pressed', () => {
  it('duration, dot and rest buttons track their state', () => {
    const target = div();
    const inst = new QWERTYToABCPiano({ durationTarget: target });
    instances.push(inst);
    const q = target.querySelector('[data-duration="q"]')!;
    const h = target.querySelector('[data-duration="h"]')!;
    const dot = target.querySelector('[data-dot]')!;
    const rest = target.querySelector('.qap-rest-btn')!;
    expect(q.getAttribute('aria-pressed')).toBe('true');
    expect(h.getAttribute('aria-pressed')).toBe('false');
    expect(dot.getAttribute('aria-pressed')).toBe('false');
    inst.setDuration('h', true);
    inst.setRestMode(true);
    expect(q.getAttribute('aria-pressed')).toBe('false');
    expect(h.getAttribute('aria-pressed')).toBe('true');
    expect(dot.getAttribute('aria-pressed')).toBe('true');
    expect(rest.getAttribute('aria-pressed')).toBe('true');
  });

  it('the chord toggle tracks the open chord', () => {
    const mount = div();
    instances.push(mountFullUI(mount, {}));
    const chord = mount.querySelector<HTMLButtonElement>('.qap-chord-btn')!;
    expect(chord.getAttribute('aria-pressed')).toBe('false');
    chord.click();
    expect(chord.getAttribute('aria-pressed')).toBe('true');
    chord.click();
    expect(chord.getAttribute('aria-pressed')).toBe('false');
  });
});
