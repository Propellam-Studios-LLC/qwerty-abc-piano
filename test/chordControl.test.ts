import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// Plays a note into the instance via the same internal path the keyboard/touch
// handlers use. While a chord is open this routes into the chord buffer.
function play(inst: QWERTYToABCPiano, note: string, octave: number): void {
  (inst as unknown as { _handleNoteFromPitch(n: string, o: number): void })
    ._handleNoteFromPitch(note, octave);
}

function piano(extra = {}): QWERTYToABCPiano {
  return new QWERTYToABCPiano({ autoBarline: false, ...extra });
}

const containers: HTMLElement[] = [];
afterEach(() => {
  while (containers.length) containers.pop()!.remove();
});

describe('openChord / commitChord (public chord API)', () => {
  it('buffers played notes into a single chord token on commit', () => {
    const inst = piano();
    inst.openChord();
    expect(inst.isChordOpen()).toBe(true);
    play(inst, 'C', 4);
    play(inst, 'E', 4);
    play(inst, 'G', 4);
    inst.commitChord();
    expect(inst.isChordOpen()).toBe(false);
    expect(inst.getABC()).toBe('[CEG]');
  });

  it('commitChord with an empty group writes nothing', () => {
    const inst = piano();
    inst.openChord();
    inst.commitChord();
    expect(inst.getABC()).toBe('');
    expect(inst.isChordOpen()).toBe(false);
  });

  it('cancelChord discards the buffered notes', () => {
    const inst = piano();
    inst.openChord();
    play(inst, 'C', 4);
    play(inst, 'E', 4);
    inst.cancelChord();
    expect(inst.getABC()).toBe('');
    expect(inst.isChordOpen()).toBe(false);
  });
});

describe('changing note duration mid-chord', () => {
  it('retroactively applies the new duration to the whole chord', () => {
    // Build a chord, changing to whole partway through.
    const a = piano();
    a.setDuration('q'); // quarter
    a.openChord();
    play(a, 'C', 4);
    play(a, 'E', 4);
    a.setDuration('w'); // whole — must apply to the notes already buffered
    play(a, 'G', 4);
    a.commitChord();

    // Same chord built entirely at whole from the start.
    const whole = piano();
    whole.setDuration('w');
    whole.openChord();
    play(whole, 'C', 4);
    play(whole, 'E', 4);
    play(whole, 'G', 4);
    whole.commitChord();

    // Same chord left at quarter throughout.
    const quarter = piano();
    quarter.setDuration('q');
    quarter.openChord();
    play(quarter, 'C', 4);
    play(quarter, 'E', 4);
    play(quarter, 'G', 4);
    quarter.commitChord();

    expect(a.getABC()).toBe(whole.getABC()); // the change took effect
    expect(a.getABC()).not.toBe(quarter.getABC()); // and it's not the old duration
  });
});

describe('chord API guards (safe across a WebView bridge — never throw)', () => {
  it('commitChord / cancelChord are no-ops when no chord is open', () => {
    const inst = piano();
    expect(() => inst.commitChord()).not.toThrow();
    expect(() => inst.cancelChord()).not.toThrow();
    expect(inst.getABC()).toBe('');
    expect(inst.isChordOpen()).toBe(false);
  });

  it('openChord is a no-op in percussion mode', () => {
    const inst = piano({ percussionMode: true });
    inst.openChord();
    expect(inst.isChordOpen()).toBe(false);
  });

  it('openChord is a no-op in play mode (chords are transcribe-only)', () => {
    const inst = piano({ defaultMode: 'play' });
    inst.openChord();
    expect(inst.isChordOpen()).toBe(false);
  });
});

describe('chord API notifications', () => {
  it('fires onSimultaneousChange on open, each note, and commit', () => {
    const onSimultaneousChange = vi.fn();
    const inst = piano({ onSimultaneousChange });
    inst.openChord();
    play(inst, 'C', 4);
    inst.commitChord();
    expect(onSimultaneousChange).toHaveBeenNthCalledWith(1, true, 0);
    expect(onSimultaneousChange).toHaveBeenNthCalledWith(2, true, 1);
    expect(onSimultaneousChange).toHaveBeenLastCalledWith(false, 0);
  });

  it('dispatches the qwerty-abc-piano:simultaneous-change DOM event (WebView path)', () => {
    const inst = piano();
    const handler = vi.fn();
    document.addEventListener('qwerty-abc-piano:simultaneous-change', handler);
    inst.openChord();
    inst.cancelChord();
    document.removeEventListener('qwerty-abc-piano:simultaneous-change', handler);
    expect(handler).toHaveBeenCalled();
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toMatchObject({ active: true, noteCount: 0 });
  });
});

// Access the private preview helpers the live notation render uses.
function previewBody(inst: QWERTYToABCPiano): string {
  const i = inst as unknown as {
    _notesWithChordPreview(): unknown[];
    _bodyFor(notes: unknown[]): string;
  };
  return i._bodyFor(i._notesWithChordPreview());
}

describe('live chord-building preview', () => {
  it('previews the in-progress chord without mutating committed state', () => {
    const inst = piano();
    inst.openChord();
    play(inst, 'C', 4);
    play(inst, 'E', 4);
    // Committed ABC is still empty (the chord isn't committed yet)…
    expect(inst.getABC()).toBe('');
    // …but the preview shows the chord as it's being built.
    expect(previewBody(inst)).toBe('[CE]');
    play(inst, 'G', 4);
    expect(previewBody(inst)).toBe('[CEG]');
    inst.commitChord();
    expect(inst.getABC()).toBe('[CEG]');
    // After commit, preview == committed (no open chord).
    expect(previewBody(inst)).toBe('[CEG]');
  });

  it('undo in chord mode pops the last buffered note from the preview', () => {
    const inst = piano();
    inst.openChord();
    play(inst, 'C', 4);
    play(inst, 'E', 4);
    expect(previewBody(inst)).toBe('[CE]');
    inst.undo();
    expect(previewBody(inst)).toBe('[C]'); // E removed, still open
    expect(inst.isChordOpen()).toBe(true);
    expect(inst.getABC()).toBe(''); // nothing committed
  });

  it('undo on an empty buffer cancels the chord and clears the preview', () => {
    const inst = piano();
    inst.openChord();
    inst.undo();
    expect(inst.isChordOpen()).toBe(false);
    expect(previewBody(inst)).toBe('');
  });
});

describe('mountFullUI chord button', () => {
  function mount(): { inst: QWERTYToABCPiano; btn: HTMLButtonElement } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const inst = mountFullUI(container, { autoBarline: false });
    const btn = container.querySelector<HTMLButtonElement>('.qap-chord-btn')!;
    return { inst, btn };
  }

  it('mounts the chord toggle on the duration row, beside the duration buttons', () => {
    const { btn } = mount();
    const durRow = btn.closest('.qap-dur-row');
    expect(durRow).toBeTruthy();
    // The note-duration buttons share that same row.
    expect(durRow!.querySelector('.qap-dur-wrap')).toBeTruthy();
  });

  it('renders a Start chord button that toggles the chord state', () => {
    const { inst, btn } = mount();
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Start chord');

    btn.click();
    expect(inst.isChordOpen()).toBe(true);
    expect(btn.textContent).toBe('End chord');

    btn.click();
    expect(inst.isChordOpen()).toBe(false);
    expect(btn.textContent).toBe('Start chord');
  });

  it('keeps the button label in sync when the chord is committed elsewhere', () => {
    const { inst, btn } = mount();
    btn.click();                 // open via button
    expect(btn.textContent).toBe('End chord');
    inst.commitChord();          // commit programmatically (e.g. lifting fingers)
    expect(btn.textContent).toBe('Start chord');
  });

  it('makes the notation area scroll within a capped height', () => {
    mount();
    expect(document.querySelector('.qap-notation-wrap')).toBeTruthy();
    // The injected stylesheet caps the notation height and scrolls within it, so
    // a long transcription stays viewable in a fixed-height host instead of
    // being clipped.
    const css = document
        .getElementById('qap-full-ui-styles')!
        .textContent!.replace(/\s+/g, ' ');
    // The same rule also sets `overflow-x: auto`, so the panel scrolls on
    // BOTH axes; the vertical cap this test guards is asserted piecewise
    // rather than as one brittle whole-rule string.
    expect(css).toContain('.qap-notation-wrap { min-height: 100px; max-height: var(--qwerty-abc-piano-notation-max-height, 260px);');
    expect(css).toContain('overflow-y: auto;');
  });

  it('renders notation into an inner child so abcjs inline styles cannot kill '
      + 'the wrap\'s scroll', () => {
    mount();
    const wrap = document.querySelector<HTMLElement>('.qap-notation-wrap')!;
    const inner = wrap.querySelector<HTMLElement>('.qap-notation-inner')!;
    expect(inner).toBeTruthy();
    // The piano renders into the INNER div — never into the wrap itself.
    // (The 'qap-notation' theme class is stamped on the notation TARGET only
    // when notationTheme is 'black', so structure, not class, is asserted.)
    expect(inner.parentElement).toBe(wrap);
    // abcjs responsive:'resize' stamps overflow:hidden INLINE on its render
    // container on every render. Simulate that on the inner and assert the
    // scroll owner (the wrap) is untouched — that inline style is what breaks
    // the scroll (see test/scroll_bisect.mjs for the browser-level harness).
    inner.style.overflow = 'hidden';
    expect(wrap.style.overflow).toBe('');
    expect(wrap.style.overflowY).toBe('');
  });
});
