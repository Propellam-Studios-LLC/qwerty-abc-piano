import { describe, it, expect } from 'vitest';
import { renderModeToggle, updateModeToggle } from '../src/ui/modeToggle.js';
import type { Mode } from '../src/types.js';

function makeHost(initialMode: Mode = 'transcribe') {
  let mode: Mode = initialMode;
  return {
    getMode: () => mode,
    setMode: (m: Mode) => { mode = m; },
    get currentMode() { return mode; },
  };
}

describe('renderModeToggle', () => {
  it('renders a button inside the target', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost());
    expect(div.querySelector('button')).not.toBeNull();
  });

  it('button text is TRANSCRIBE in transcribe mode', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost('transcribe'));
    expect(div.querySelector('button')!.textContent).toBe('TRANSCRIBE');
  });

  it('button text is PLAY in play mode', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost('play'));
    expect(div.querySelector('button')!.textContent).toBe('PLAY');
  });

  it('button has data-mode="transcribe" initially', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost('transcribe'));
    expect((div.querySelector('button') as HTMLButtonElement).dataset.mode).toBe('transcribe');
  });

  it('clicking from transcribe calls setMode with play', () => {
    const div = document.createElement('div');
    const host = makeHost('transcribe');
    renderModeToggle(div, host);
    (div.querySelector('button') as HTMLButtonElement).click();
    expect(host.currentMode).toBe('play');
  });

  it('clicking from play calls setMode with transcribe', () => {
    const div = document.createElement('div');
    const host = makeHost('play');
    renderModeToggle(div, host);
    (div.querySelector('button') as HTMLButtonElement).click();
    expect(host.currentMode).toBe('transcribe');
  });

  it('clears existing content before rendering', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>old</span>';
    renderModeToggle(div, makeHost());
    expect(div.querySelector('span')).toBeNull();
    expect(div.querySelectorAll('button').length).toBe(1);
  });
});

describe('updateModeToggle', () => {
  it('updates text to PLAY', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost('transcribe'));
    updateModeToggle(div, 'play');
    expect(div.querySelector('button')!.textContent).toBe('PLAY');
  });

  it('updates text to TRANSCRIBE', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost('play'));
    updateModeToggle(div, 'transcribe');
    expect(div.querySelector('button')!.textContent).toBe('TRANSCRIBE');
  });

  it('updates data-mode attribute', () => {
    const div = document.createElement('div');
    renderModeToggle(div, makeHost('transcribe'));
    updateModeToggle(div, 'play');
    expect((div.querySelector('button') as HTMLButtonElement).dataset.mode).toBe('play');
  });

  it('is a no-op when no button is present', () => {
    const div = document.createElement('div');
    expect(() => updateModeToggle(div, 'play')).not.toThrow();
  });
});
