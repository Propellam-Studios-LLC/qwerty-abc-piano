import type { QWERTYToABCPiano } from '../QWERTYToABCPiano.js';

/**
 * Renders a "Start chord" / "End chord" toggle button into `target` and wires it
 * to the piano's {@link QWERTYToABCPiano.openChord}/{@link QWERTYToABCPiano.commitChord}.
 *
 * This gives touch-only devices (and mouse users) a keyboard-free way to enter a
 * chord, since the `(`/`)` keys are unavailable without a physical keyboard
 * and two-finger-touch chord grouping is fiddly.
 *
 * Returns a `setActive(active)` updater the caller invokes from
 * `onSimultaneousChange` so the button label always reflects the real state
 * (e.g. when a chord is committed by lifting all fingers, not by this button).
 */
export function renderChordButton(
  target: Element,
  instance: QWERTYToABCPiano,
): (active: boolean) => void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qap-chord-btn';
  btn.textContent = 'Start chord';
  btn.setAttribute('aria-pressed', 'false');

  const setActive = (active: boolean): void => {
    btn.textContent = active ? 'End chord' : 'Start chord';
    btn.classList.toggle('qap-chord-btn--active', active);
    btn.setAttribute('aria-pressed', String(active));
  };

  btn.addEventListener('click', () => {
    if (instance.isChordOpen()) instance.commitChord();
    else instance.openChord();
    setActive(instance.isChordOpen());
  });

  target.appendChild(btn);
  return setActive;
}
