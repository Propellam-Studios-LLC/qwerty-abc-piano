import { describe, it, expect, afterEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';

// The mobile-friendly mount: a width-aware touch board, an octave-shift pair
// for reaching notes outside the window, a suppressible notation panel, and a
// play-ordered letter readout in its place.

const containers: HTMLElement[] = [];

function touchContainer(clientWidth: number): HTMLElement {
  const div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: clientWidth, configurable: true });
  document.body.appendChild(div);
  containers.push(div);
  return div;
}

function setTouch(on: boolean): void {
  if (on) {
    (window as unknown as { ontouchstart?: unknown }).ontouchstart = null;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  } else {
    delete (window as unknown as { ontouchstart?: unknown }).ontouchstart;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  }
}

function viewBox(div: HTMLElement): string {
  return div.querySelector('svg.qap-piano')!.getAttribute('viewBox')!;
}

function whiteKeyCount(div: HTMLElement): number {
  return div.querySelectorAll('rect.qap-key-white').length;
}

afterEach(() => {
  while (containers.length) containers.pop()!.remove();
  setTouch(false);
});

describe('width-aware touch board', () => {
  it('picks a one-octave board at phone width', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, {});
    // 7 white keys → viewBox 2*20 + 7*60 = 460, and no octave row → height 120.
    expect(whiteKeyCount(div)).toBe(7);
    expect(viewBox(div)).toBe('0 0 460 120');
  });

  it('keeps the two-octave board on a wide container', () => {
    setTouch(true);
    const div = touchContainer(1000);
    mountFullUI(div, {});
    expect(whiteKeyCount(div)).toBe(14);
    expect(viewBox(div)).toBe('0 0 880 120');
  });

  it('an unmeasurable container (clientWidth 0) keeps the two-octave default', () => {
    // A Flutter platform view is created before it is sized; falling through to
    // the compact board on a 0 measurement would shrink every desktop mount.
    setTouch(true);
    const div = touchContainer(0);
    mountFullUI(div, {});
    expect(whiteKeyCount(div)).toBe(14);
  });

  it('an explicit touchRange pins the window and ignores width', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, { touchRange: { low: 'C3', high: 'B3' } });
    expect(whiteKeyCount(div)).toBe(7);
    expect(div.querySelector('rect.qap-key-white[data-key="C3"]')).not.toBeNull();
    expect(div.querySelector('rect.qap-key-white[data-key="C4"]')).toBeNull();
  });

  it('touchRange:false keeps the QWERTY layout and hides the range row', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, { touchRange: false });
    expect(div.querySelector('rect.qap-key-white[data-key="h"]')).not.toBeNull();
    expect((div.querySelector('.qap-range-row') as HTMLElement).style.display).toBe('none');
  });

  it('a non-touch device is unaffected by container width', () => {
    const div = touchContainer(390);
    mountFullUI(div, {});
    expect(whiteKeyCount(div)).toBe(11); // the QWERTY layout
    expect(viewBox(div)).toBe('0 0 700 150');
  });
});

describe('octave-shift pair', () => {
  function shiftButtons(div: HTMLElement): { down: HTMLButtonElement; up: HTMLButtonElement } {
    const btns = div.querySelectorAll<HTMLButtonElement>('.qap-oct-shift');
    return { down: btns[0], up: btns[1] };
  }

  it('moves the whole window down an octave, keeping its span', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, {});
    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C4–B4');

    shiftButtons(div).down.click();

    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C3–B3');
    expect(whiteKeyCount(div)).toBe(7);
    expect(div.querySelector('rect.qap-key-white[data-key="C3"]')).not.toBeNull();
  });

  it('moves the window up an octave', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, {});
    shiftButtons(div).up.click();
    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C5–B5');
  });

  it('disables — never hides — the shift button at the clamp', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, {});
    const { down } = shiftButtons(div);

    down.click(); // C3–B3
    expect(down.disabled).toBe(false);
    down.click(); // C2–B2 — the bottom of WHITE_MIDIS
    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C2–B2');
    expect(down.disabled).toBe(true);
    expect(down.isConnected).toBe(true);

    down.click(); // no further movement
    expect(div.querySelector('.qap-range-window')!.textContent).toBe('C2–B2');
  });

  it('the low/high steppers still work alongside it', () => {
    setTouch(true);
    const div = touchContainer(390);
    mountFullUI(div, {});
    const rangeBtns = div.querySelectorAll<HTMLButtonElement>('.qap-range-group .qap-range-btn');
    // [◀ 8ve, 8ve ▶, low −, low +, high −, high +]
    rangeBtns[5].click(); // high +
    expect(whiteKeyCount(div)).toBe(8);
  });
});

describe('minimal mount — notation off, letters on', () => {
  it('showNotation:false renders no notation panel', () => {
    const div = touchContainer(390);
    mountFullUI(div, { showNotation: false });
    expect(div.querySelector('.qap-notation-wrap')).toBeNull();
  });

  it('the notation panel is present by default', () => {
    const div = touchContainer(390);
    mountFullUI(div, {});
    expect(div.querySelector('.qap-notation-wrap')).not.toBeNull();
  });

  // The notation panel can be moved above the keyboard with notationPosition.
  it('notation sits below the keyboard by default', () => {
    const div = touchContainer(800);
    mountFullUI(div, {});
    const kids = Array.from(div.children);
    const notation = div.querySelector('.qap-notation-wrap')!;
    const instrument = div.querySelector('.qap-instrument-wrap')!;
    expect(kids.indexOf(notation)).toBeGreaterThan(kids.indexOf(instrument));
  });

  it("notationPosition:'top' puts notation above the keyboard and its controls", () => {
    const div = touchContainer(800);
    mountFullUI(div, { notationPosition: 'top' });
    const kids = Array.from(div.children);
    const notation = div.querySelector('.qap-notation-wrap')!;
    expect(kids.indexOf(notation)).toBe(0);
    expect(kids.indexOf(notation)).toBeLessThan(
      kids.indexOf(div.querySelector('.qap-instrument-wrap')!),
    );
  });

  it("notationPosition:'top' with showNotation:false still renders no panel", () => {
    const div = touchContainer(800);
    mountFullUI(div, { notationPosition: 'top', showNotation: false });
    expect(div.querySelector('.qap-notation-wrap')).toBeNull();
  });

  it('the letter readout is off by default', () => {
    const div = touchContainer(390);
    mountFullUI(div, {});
    expect(div.querySelector('.qap-letters-wrap')).toBeNull();
  });

  it('the readout lists notes in play order, repeats included', () => {
    const div = touchContainer(390);
    const inst = mountFullUI(div, { showNotation: false, letterReadout: true });
    const play = (n: string, o: number) =>
      (inst as unknown as { _handleNoteFromPitch(n: string, o: number): void })
        ._handleNoteFromPitch(n, o);

    play('G', 4);
    play('C', 4);
    play('G', 4);
    play('E', 4);

    const letters = [...div.querySelectorAll('.qap-letter')].map(e => e.textContent);
    expect(letters).toEqual(['G', 'C', 'G', 'E']);
  });

  it('black keys show both enharmonic spellings, naturals show one', () => {
    // A readout has no key or chord context, so showing one spelling looks
    // wrong whenever the music is flat-spelled (an Fdim7 shown with 'G#').
    const div = touchContainer(390);
    const inst = mountFullUI(div, { showNotation: false, letterReadout: true });
    const play = (n: string, o: number) =>
      (inst as unknown as { _handleNoteFromPitch(n: string, o: number): void })
        ._handleNoteFromPitch(n, o);

    play('F', 4);
    play('G#', 4);
    play('C#', 5);
    play('A#', 5);

    const letters = [...div.querySelectorAll('.qap-letter')].map(e => e.textContent);
    expect(letters).toEqual(['F', 'G#/Ab', 'C#/Db', 'A#/Bb']);
    // Display only — what the piano reports is unchanged.
    expect(inst.getNoteLetters()).toEqual(['F', 'G#', 'C#', 'A#']);
  });

  it('highlights the most recent note only', () => {
    const div = touchContainer(390);
    const inst = mountFullUI(div, { letterReadout: true });
    const play = (n: string, o: number) =>
      (inst as unknown as { _handleNoteFromPitch(n: string, o: number): void })
        ._handleNoteFromPitch(n, o);

    play('C', 4);
    play('E', 4);
    const last = div.querySelectorAll('.qap-letter--last');
    expect(last.length).toBe(1);
    expect(last[0].textContent).toBe('E');
  });

  it('shows a placeholder before anything is entered, and again after clear', () => {
    const div = touchContainer(390);
    const inst = mountFullUI(div, { showNotation: false, letterReadout: true });
    expect(div.querySelector('.qap-letters-empty')).not.toBeNull();

    (inst as unknown as { _handleNoteFromPitch(n: string, o: number): void })
      ._handleNoteFromPitch('C', 4);
    expect(div.querySelectorAll('.qap-letter').length).toBe(1);

    inst.clear();
    expect(div.querySelectorAll('.qap-letter').length).toBe(0);
    expect(div.querySelector('.qap-letters-empty')).not.toBeNull();
  });

  it('chord notes appear as they are buffered, not only on commit', () => {
    const div = touchContainer(390);
    const inst = mountFullUI(div, { showNotation: false, letterReadout: true });
    const play = (n: string, o: number) =>
      (inst as unknown as { _handleNoteFromPitch(n: string, o: number): void })
        ._handleNoteFromPitch(n, o);

    inst.openChord();
    play('C', 4);
    play('E', 4);
    expect([...div.querySelectorAll('.qap-letter')].map(e => e.textContent))
      .toEqual(['C', 'E']);

    inst.commitChord();
    expect([...div.querySelectorAll('.qap-letter')].map(e => e.textContent))
      .toEqual(['C', 'E']);
  });

  it('compactChrome marks the root so the chrome styles apply', () => {
    const div = touchContainer(390);
    mountFullUI(div, { compactChrome: true });
    expect(div.classList.contains('qap-compact')).toBe(true);

    const plain = touchContainer(390);
    mountFullUI(plain, {});
    expect(plain.classList.contains('qap-compact')).toBe(false);
  });
});
