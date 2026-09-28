import type { QWERTYToABCPiano } from '../QWERTYToABCPiano.js';

/** Hint under the TAP label. In percussion mode only the piano's note keys
 * record a tap (not "any key"), so the hint says exactly that. */
export const TAP_HINT = '(or press any note key)';

/**
 * Renders a large "TAP" button into `target`, replacing the piano SVG in
 * percussion mode. Clicking/tapping calls `instance.tap()`.
 */
export function renderTapButton(target: Element, instance: QWERTYToABCPiano): void {
  target.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qap-tap-btn';

  const label = document.createElement('span');
  label.className = 'qap-tap-label';
  label.textContent = 'TAP';

  const hint = document.createElement('small');
  hint.className = 'qap-tap-hint';
  hint.textContent = TAP_HINT;

  btn.appendChild(label);
  btn.appendChild(hint);

  const flash = () => {
    btn.classList.add('qap-tap-btn--active');
    setTimeout(() => btn.classList.remove('qap-tap-btn--active'), 100);
  };

  btn.addEventListener('click', () => {
    instance.tap();
    flash();
  });

  // No btn.focus() here: focusing on render would steal focus from the host
  // page and scroll it to the widget.
  target.appendChild(btn);
}
