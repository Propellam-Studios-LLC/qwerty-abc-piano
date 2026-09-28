import type { Mode } from '../types.js';

/** Minimal interface the mode toggle needs from the host instance. */
export interface ModeHost {
  getMode(): Mode;
  setMode(mode: Mode): void;
}

/**
 * Renders a mode-toggle button into `target`.
 * Click toggles between 'transcribe' and 'play' modes.
 */
export function renderModeToggle(target: Element, host: ModeHost): void {
  target.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qwerty-abc-mode-btn';
  btn.addEventListener('click', () => {
    host.setMode(host.getMode() === 'transcribe' ? 'play' : 'transcribe');
  });

  target.appendChild(btn);
  updateModeToggle(target, host.getMode());
}

/**
 * Updates the mode button's text and `data-mode` attribute to match `mode`.
 */
export function updateModeToggle(target: Element, mode: Mode): void {
  const btn = target.querySelector<HTMLButtonElement>('.qwerty-abc-mode-btn');
  if (!btn) return;
  btn.dataset.mode = mode;
  btn.textContent = mode === 'transcribe' ? 'TRANSCRIBE' : 'PLAY';
}
