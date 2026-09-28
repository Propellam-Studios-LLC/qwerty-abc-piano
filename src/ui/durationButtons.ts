import type { Duration } from '../types.js';

/** Minimal interface the duration button UI needs from the host instance. */
export interface DurationHost {
  getDuration(): Duration;
  getIsDotted(): boolean;
  getRestMode(): boolean;
  setDuration(duration: Duration, isDotted?: boolean): void;
  setRestMode(on: boolean): void;
  insertRest?(): void;
}

type ButtonDef = { duration: Duration; key: string; label: string };

// Inline SVG note glyphs. All share viewBox="0 0 22 26" so with height:1.8em;width:auto
// every icon renders at exactly the same pixel dimensions.
const NOTE_ICONS: Partial<Record<Duration, string>> = {
  // Whole note: open oval (no stem), centred in the viewBox
  w: `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
        <ellipse cx="11" cy="20" rx="9" ry="5.5" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>`,
  // Half note: open oval + stem
  h: `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
        <ellipse cx="7" cy="20" rx="6.5" ry="4" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-20 7 20)"/>
        <line x1="13" y1="19" x2="13" y2="2" stroke="currentColor" stroke-width="2"/>
      </svg>`,
  // Quarter note: filled oval + stem
  q: `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
        <ellipse cx="7" cy="20" rx="6.5" ry="4" fill="currentColor" transform="rotate(-20 7 20)"/>
        <line x1="13" y1="19" x2="13" y2="2" stroke="currentColor" stroke-width="2"/>
      </svg>`,
  // Eighth note: filled oval + stem + 1 flag
  e: `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
        <ellipse cx="7" cy="20" rx="6.5" ry="4" fill="currentColor" transform="rotate(-20 7 20)"/>
        <line x1="13" y1="19" x2="13" y2="2" stroke="currentColor" stroke-width="2"/>
        <path d="M13,2 C20,5 19,13 13,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`,
  // 16th note: filled oval + stem + 2 flags
  s: `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
        <ellipse cx="7" cy="20" rx="6.5" ry="4" fill="currentColor" transform="rotate(-20 7 20)"/>
        <line x1="13" y1="19" x2="13" y2="2" stroke="currentColor" stroke-width="2"/>
        <path d="M13,2 C20,5 19,11 13,12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M13,8 C20,11 19,17 13,18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`,
  // 32nd note: filled oval + stem + 3 flags
  t: `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
        <ellipse cx="7" cy="20" rx="6.5" ry="4" fill="currentColor" transform="rotate(-20 7 20)"/>
        <line x1="13" y1="19" x2="13" y2="2" stroke="currentColor" stroke-width="2"/>
        <path d="M13,2 C20,5 19,9 13,10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M13,7 C20,10 19,14 13,15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M13,12 C20,15 19,19 13,20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`,
};

// Quarter-rest glyph: a recognisable zigzag used for the rest button.
const REST_ICON = `<svg class="qwerty-abc-dur-icon" viewBox="0 0 22 26" aria-hidden="true">
  <path d="M14,3 L7,9 L13,13 L7,20 Q4,23 9,25" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const DURATION_DEFS: ButtonDef[] = [
  { duration: 'w', key: '1', label: 'whole' },
  { duration: 'h', key: '2', label: 'half' },
  { duration: 'q', key: '3', label: 'quarter' },
  { duration: 'e', key: '4', label: 'eighth' },
  { duration: 's', key: '5', label: '16th' },
  { duration: 't', key: '6', label: '32nd' },
];

/**
 * Renders a row of duration buttons, a dot toggle and a rest-mode toggle into
 * `target`, wired to `host`. Replaces any existing content in the target
 * element.
 */
export function renderDurationButtons(target: Element, host: DurationHost): void {
  target.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'qwerty-abc-duration-buttons';

  for (const def of DURATION_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.duration = def.duration;
    btn.className = 'qwerty-abc-dur-btn';
    btn.title = `${def.label} (key: ${def.key})`;
    btn.innerHTML =
      (NOTE_ICONS[def.duration] ?? '') +
      `<span class="qwerty-abc-dur-key">${def.key}</span>` +
      `<span class="qwerty-abc-dur-label">${def.label}</span>`;
    btn.addEventListener('click', () => host.setDuration(def.duration));
    wrap.appendChild(btn);
  }

  const dotBtn = document.createElement('button');
  dotBtn.type = 'button';
  dotBtn.dataset.dot = 'true';
  dotBtn.className = 'qwerty-abc-dur-btn';
  dotBtn.title = 'Toggle dot (key: .)';
  dotBtn.innerHTML =
    '<span class="qwerty-abc-dur-key">.</span>' +
    '<span class="qwerty-abc-dur-label">dot</span>';
  dotBtn.addEventListener('click', () =>
    host.setDuration(host.getDuration(), !host.getIsDotted()),
  );
  wrap.appendChild(dotBtn);

  const restBtn = document.createElement('button');
  restBtn.type = 'button';
  restBtn.className = 'qwerty-abc-dur-btn qap-rest-btn';
  restBtn.title = 'Toggle rest mode (key: z inserts one rest)';
  restBtn.innerHTML =
    REST_ICON +
    '<span class="qwerty-abc-dur-key">z</span>' +
    '<span class="qwerty-abc-dur-label">rest</span>';
  restBtn.addEventListener('click', () => host.setRestMode(!host.getRestMode()));
  wrap.appendChild(restBtn);

  target.appendChild(wrap);
  updateDurationButtons(target, host.getDuration(), host.getIsDotted());
}

/**
 * Syncs the `active` CSS class and `aria-pressed` on the buttons inside
 * `target` to match the given duration, dot and rest-mode state.
 */
export function updateDurationButtons(
  target: Element,
  duration: Duration,
  isDotted: boolean,
  restMode = false,
): void {
  const setPressed = (btn: HTMLButtonElement, on: boolean): void => {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  };
  for (const btn of target.querySelectorAll<HTMLButtonElement>('[data-duration]')) {
    setPressed(btn, btn.dataset.duration === duration);
  }
  const dotBtn = target.querySelector<HTMLButtonElement>('[data-dot]');
  if (dotBtn) setPressed(dotBtn, isDotted);
  const restBtn = target.querySelector<HTMLButtonElement>('.qap-rest-btn');
  if (restBtn) setPressed(restBtn, restMode);
}
