import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderDurationButtons, updateDurationButtons } from '../src/ui/durationButtons.js';
import type { DurationHost } from '../src/ui/durationButtons.js';
import type { Duration } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTarget(): HTMLDivElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function makeHost(duration: Duration = 'q', isDotted = false): DurationHost & {
  setDuration: ReturnType<typeof vi.fn>;
} {
  let _duration = duration;
  let _isDotted = isDotted;
  const setDuration = vi.fn((d: Duration, dot = false) => {
    _duration = d;
    _isDotted = dot;
  });
  return {
    getDuration: () => _duration,
    getIsDotted: () => _isDotted,
    setDuration,
  };
}

const targets: HTMLDivElement[] = [];
afterEach(() => {
  while (targets.length) document.body.removeChild(targets.pop()!);
});

function target(): HTMLDivElement {
  const div = makeTarget();
  targets.push(div);
  return div;
}

// ── renderDurationButtons ─────────────────────────────────────────────────────

describe('renderDurationButtons', () => {
  it('renders 8 buttons (6 durations + dot + rest)', () => {
    const t = target();
    renderDurationButtons(t, makeHost());
    expect(t.querySelectorAll('button').length).toBe(8);
  });

  it('each duration button carries a data-duration attribute', () => {
    const t = target();
    renderDurationButtons(t, makeHost());
    const durations = [...t.querySelectorAll<HTMLButtonElement>('[data-duration]')]
      .map(b => b.dataset.duration);
    expect(durations).toEqual(['w', 'h', 'q', 'e', 's', 't']);
  });

  it('dot button carries data-dot attribute', () => {
    const t = target();
    renderDurationButtons(t, makeHost());
    expect(t.querySelector('[data-dot]')).not.toBeNull();
  });

  it('marks the host duration as active on render', () => {
    const t = target();
    renderDurationButtons(t, makeHost('e'));
    const active = t.querySelector<HTMLButtonElement>('[data-duration].active');
    expect(active?.dataset.duration).toBe('e');
  });

  it('dot button is inactive when host is not dotted', () => {
    const t = target();
    renderDurationButtons(t, makeHost('q', false));
    expect(t.querySelector('[data-dot]')?.classList.contains('active')).toBe(false);
  });

  it('dot button is active when host is dotted', () => {
    const t = target();
    renderDurationButtons(t, makeHost('q', true));
    expect(t.querySelector('[data-dot]')?.classList.contains('active')).toBe(true);
  });

  it('replaces any existing content in target', () => {
    const t = target();
    t.innerHTML = '<span id="old">old</span>';
    renderDurationButtons(t, makeHost());
    expect(t.querySelector('#old')).toBeNull();
  });
});

// ── updateDurationButtons ─────────────────────────────────────────────────────

describe('updateDurationButtons', () => {
  it('marks the specified duration button as active', () => {
    const t = target();
    renderDurationButtons(t, makeHost('q'));
    updateDurationButtons(t, 'h', false);
    const active = t.querySelector<HTMLButtonElement>('[data-duration].active');
    expect(active?.dataset.duration).toBe('h');
  });

  it('removes active class from the previously active button', () => {
    const t = target();
    renderDurationButtons(t, makeHost('q'));
    updateDurationButtons(t, 'w', false);
    const prevActive = t.querySelector<HTMLButtonElement>('[data-duration="q"]');
    expect(prevActive?.classList.contains('active')).toBe(false);
  });

  it('activates dot button when isDotted is true', () => {
    const t = target();
    renderDurationButtons(t, makeHost());
    updateDurationButtons(t, 'q', true);
    expect(t.querySelector('[data-dot]')?.classList.contains('active')).toBe(true);
  });

  it('deactivates dot button when isDotted is false', () => {
    const t = target();
    renderDurationButtons(t, makeHost('q', true));
    updateDurationButtons(t, 'q', false);
    expect(t.querySelector('[data-dot]')?.classList.contains('active')).toBe(false);
  });
});

// ── click handlers ────────────────────────────────────────────────────────────

describe('click handlers', () => {
  it('clicking a duration button calls setDuration with that duration', () => {
    const t = target();
    const host = makeHost('q');
    renderDurationButtons(t, host);
    const wholeBtn = t.querySelector<HTMLButtonElement>('[data-duration="w"]')!;
    wholeBtn.click();
    expect(host.setDuration).toHaveBeenCalledWith('w');
  });

  it('clicking dot button toggles isDotted via setDuration', () => {
    const t = target();
    const host = makeHost('q', false);
    renderDurationButtons(t, host);
    const dotBtn = t.querySelector<HTMLButtonElement>('[data-dot]')!;
    dotBtn.click();
    expect(host.setDuration).toHaveBeenCalledWith('q', true);
  });

  it('clicking dot button again turns it off', () => {
    const t = target();
    const host = makeHost('q', true);
    renderDurationButtons(t, host);
    const dotBtn = t.querySelector<HTMLButtonElement>('[data-dot]')!;
    dotBtn.click();
    expect(host.setDuration).toHaveBeenCalledWith('q', false);
  });
});
