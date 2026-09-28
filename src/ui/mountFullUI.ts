import type { QWERTYToABCOptions } from '../types.js';
import { QWERTYToABCPiano } from '../QWERTYToABCPiano.js';
import { midiToNoteString } from './piano.js';
import { renderChordButton } from './chordButton.js';
import { TAP_HINT } from './tapButton.js';
import { injectStylesInto } from '../domStyles.js';
import { enharmonicDisplayName } from '../keymap.js';

const KEY_SIGS = ['C','G','D','A','E','B','F','Bb','Eb','Ab','Db','Gb'];

// ── Touch range helpers ───────────────────────────────────────────────────────

// All white note MIDI values from C2 (36) to B6 (95).
const WHITE_MIDI_PC = [0, 2, 4, 5, 7, 9, 11]; // pitch classes for C D E F G A B
const WHITE_MIDIS: number[] = [];
for (let oct = 2; oct <= 6; oct++) {
  for (const pc of WHITE_MIDI_PC) {
    const midi = (oct + 1) * 12 + pc;
    if (midi <= 95) WHITE_MIDIS.push(midi);
  }
}
// e.g. [36(C2), 38(D2), …, 60(C4), …, 83(B5), …, 95(B6)]

function whiteMidiIndex(midi: number): number {
  return WHITE_MIDIS.indexOf(midi);
}

// Default touch range: C4 (idx 14) to B5 (idx 27) — two clean octaves from middle C.
const DEFAULT_LOW_IDX  = whiteMidiIndex(60); // C4
const DEFAULT_HIGH_IDX = whiteMidiIndex(83); // B5
// Compact touch range: C4–B4, one octave — the phone board.
const COMPACT_HIGH_IDX = whiteMidiIndex(71); // B4
// Below this container width a two-octave board's white keys fall under the
// 44px touch target: 14 white keys → viewBox 880, key width 58, so 44 px is
// reached at 44 * 880 / 58 ≈ 668 px.
const COMPACT_MAX_WIDTH = 680;
const MIN_SPAN = 7; // minimum white keys between low and high (≈ 1 octave)
const OCTAVE_STEPS = 7; // white keys per octave — WHITE_MIDIS holds white keys only

/**
 * Picks the touch board's top note (an index into WHITE_MIDIS) from the mount
 * element's width in px. A width of 0 (a container not laid out yet, such as a
 * Flutter platform view before it is sized, or a DOM without layout like
 * happy-dom) falls through to the two-octave default rather than the compact
 * board, since an unknown width is not evidence of a narrow screen.
 */
function pickHighIdx(px: number): number {
  return (px > 0 && px < COMPACT_MAX_WIDTH) ? COMPACT_HIGH_IDX : DEFAULT_HIGH_IDX;
}
const TIME_SIGS = ['4/4','3/4','6/8','2/4','3/8','5/4','2/2'];
const BARLINE_MODES = ['auto','manual','none'] as const;
const CLEFS = ['treble','bass','alto','tenor'] as const;

// One live instance per container. Re-mounting into the same element without
// calling destroy() first would otherwise leave the previous instance's
// document-level keydown listener alive, and every key would play twice.
const MOUNTED = new WeakMap<Element, QWERTYToABCPiano>();
let mountSeq = 0;

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function btn(label: string, cls?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  return b;
}

// ── MIDI icon states + help panel content ────────────────────────────────────

/**
 * The MIDI icon's `data-state`:
 * - `unsupported` — no Web MIDI in this browser (Safari, WebViews).
 * - `idle`        — access not requested yet (or a mount-time request failed,
 *                   which is not reported). Clicking asks.
 * - `pending`     — waiting on the browser's permission prompt.
 * - `no-device`   — access granted, but no MIDI input is plugged in.
 * - `connected`   — at least one MIDI input is plugged in.
 * - `notGranted` / `refused` — a request the user made failed.
 */
type MidiIconState = 'unsupported' | 'idle' | 'pending' | 'no-device' | 'connected' | 'notGranted' | 'refused';

// The help panel's status sentence for each failure state, defined once.
const MIDI_STATUS_TEXT = {
  unsupported: "MIDI keyboards aren't supported in this browser",
  notGranted: 'MIDI needs permission for this site — allow MIDI in your browser’s site settings, then try again',
  refused: 'MIDI access was denied — check your browser’s site settings',
} as const;

/** Short aria-label / title for the icon in each state. */
const MIDI_ICON_LABEL: Record<MidiIconState, string> = {
  unsupported: "MIDI keyboards aren't supported in this browser",
  idle: 'Connect a MIDI keyboard',
  pending: 'Connecting to MIDI…',
  'no-device': 'MIDI on — no keyboard detected',
  connected: 'MIDI keyboard connected',
  notGranted: 'MIDI needs permission for this site',
  refused: 'MIDI access was denied',
};

/** The live status sentence shown in the help panel's MIDI section. */
function midiStatusText(state: MidiIconState, devices: number): string {
  switch (state) {
    case 'unsupported': return MIDI_STATUS_TEXT.unsupported;
    case 'notGranted':  return MIDI_STATUS_TEXT.notGranted;
    case 'refused':     return MIDI_STATUS_TEXT.refused;
    case 'idle':        return 'MIDI is off — press the 🎹 button to connect a MIDI keyboard';
    case 'pending':     return '🎹 Connecting…';
    case 'no-device':   return '🎹 MIDI on — no keyboard detected yet; plug one in and it is picked up automatically';
    case 'connected':   return `🎹 MIDI on — ${devices} keyboard${devices === 1 ? '' : 's'} connected`;
  }
}

const MIDI_LEGEND: Array<[MidiIconState, string]> = [
  ['idle',        'Grey outline — MIDI is off. Press it to connect.'],
  ['pending',     'Pulsing — waiting for the browser’s permission prompt.'],
  ['no-device',   'Amber — MIDI is on, but no keyboard is plugged in.'],
  ['connected',   'Green — a MIDI keyboard is connected; play it to enter notes.'],
  ['refused',     'Red — the browser did not allow MIDI for this site. Allow it in the site settings, then press the icon again.'],
  ['unsupported', 'Struck through — this browser has no Web MIDI (e.g. Safari).'],
];

function helpHeading(text: string): HTMLElement {
  const h = el('p', 'qap-help-heading');
  h.textContent = text;
  return h;
}

function midiLegend(): HTMLElement {
  const ul = el('ul', 'qap-midi-legend');
  for (const [state, text] of MIDI_LEGEND) {
    const li = el('li');
    const swatch = el('span', 'qap-midi-legend-swatch');
    swatch.dataset.state = state;
    swatch.setAttribute('aria-hidden', 'true');
    li.append(swatch, text);
    ul.appendChild(li);
  }
  return ul;
}

function midiHowTo(): HTMLElement {
  const p = el('p', 'qap-help-text');
  p.textContent =
    'To enable MIDI: plug in a MIDI keyboard, press the 🎹 button and allow MIDI when the browser asks. ' +
    'Chrome and Edge ask once; Firefox grants MIDI as a site permission. Safari and iOS have no Web MIDI.';
  return p;
}

/**
 * The help panel's keyboard-shortcut list, mirroring the bindings in
 * QWERTYToABCPiano's keydown handler. The Esc row appears only when Esc
 * actually does something (`escapeClears` or `onClearRequested`).
 */
function shortcutsSection(opts: MountFullUIOptions): HTMLElement {
  const rows: Array<[string, string]> = [
    ["A S D F G H J K L ; '", 'White keys, E3 to A4 (H is middle C)'],
    ['E R T U I P [',         'Black keys'],
    ['1 – 6',                 'Whole, half, quarter, eighth, 16th, 32nd'],
    ['.',                     'Dotted on / off'],
    ['Z',                     'Rest'],
    ['Q',                     'Triplet (the next three notes)'],
    ['( … )',                 'Start / end a chord'],
    ['Space',                 'Space between notes (breaks the beam)'],
    ['\\',                    'Barline'],
    ['+  −  0',               'Octave up / down / reset'],
    ['Backspace, Ctrl/⌘+Z',   'Undo'],
    ['Enter',                 'Play'],
    ['← →   ↑ ↓',             'Select a note; move it up / down a semitone'],
    ['X',                     'Switch Transcribe / Play mode'],
    ['| : ! " {',             'Type raw ABC (repeats, decorations, chord symbols, grace notes); Esc cancels it'],
  ];
  if (opts.escapeClears === true || opts.onClearRequested) rows.push(['Esc', 'Clear the transcription']);
  const section = el('section', 'qap-help-section qap-help-keys');
  const dl = el('dl', 'qap-help-shortcuts');
  for (const [keys, what] of rows) {
    const dt = el('dt');
    const kbd = el('kbd');
    kbd.textContent = keys;
    dt.appendChild(kbd);
    const dd = el('dd');
    dd.textContent = what;
    dl.append(dt, dd);
  }
  section.append(helpHeading('Keyboard shortcuts'), dl);
  return section;
}

function referenceSection(url: string): HTMLElement {
  const section = el('section', 'qap-help-section qap-help-ref');
  const p = el('p', 'qap-help-text');
  const a = document.createElement('a');
  a.className = 'qap-help-link';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Full reference (opens in a new tab)';
  p.appendChild(a);
  section.append(helpHeading('Full reference'), p);
  return section;
}

/**
 * A mounted UI's programmatic handle, attached to the returned instance as
 * `fullUI`.
 *
 * The piano's own `setKeySignature` / `setTimeSignature` change what it WRITES
 * but know nothing about the Advanced panel's button rows, so calling them
 * directly leaves the highlighted buttons showing stale values. Use these
 * setters instead: they update the piano and the highlight together.
 *
 * @example
 * ```ts
 * const piano = mountFullUI('#piano');
 * piano.fullUI.setKeySignature('D');
 * piano.fullUI.setTimeSignature('3/4');
 * ```
 */
export interface MountFullUIHandle {
  /** Set the meter AND move the Time row's highlight. */
  setTimeSignature(ts: string): void;
  /** Set the key signature AND move the Key row's highlight. */
  setKeySignature(ks: string): void;
  /**
   * Request Web MIDI access and reflect the outcome in the MIDI icon and the
   * help panel's status line. Resolves `true` when access is held, `false`
   * otherwise (unsupported browser, or permission not granted); never rejects.
   *
   * Call it from a user action (a click handler): it is treated as the user
   * asking, so a refusal is explained on screen (the icon turns red and the
   * help panel opens at its MIDI section). The mount-time attempt made by
   * `enableMidi: true` is silent on failure instead.
   */
  connectMidi(): Promise<boolean>;
}

/** What {@link mountFullUI} returns: the instance, plus its UI handle. */
export type MountedFullUI = QWERTYToABCPiano & { fullUI: MountFullUIHandle };

/**
 * Options for {@link mountFullUI}: every {@link QWERTYToABCOptions} except the
 * UI targets (the mount creates those), plus the mount's own chrome flags.
 */
export interface MountFullUIOptions extends Omit<QWERTYToABCOptions, 'pianoTarget'|'durationTarget'|'modeTarget'|'notationTarget'|'playbackTarget'|'tupletTarget'> {
  /** Show the Piano/Percussion toggle bar. Default `true`. Set to `false` to lock to one mode. */
  shellToggle?: boolean;
  /**
   * Show the small MIDI status icon (`.qap-midi-indicator`) in the top bar.
   * Default `true`; shown when `showAdvanced` is on or `enableMidi: true` is
   * set. Its `data-state` is one of `unsupported`, `idle`, `pending`,
   * `no-device`, `connected`, `notGranted`, `refused`. Clicking it while
   * idle / notGranted / refused requests Web MIDI access (a user gesture);
   * in any other state it opens the help panel at its MIDI section.
   * `false` hides it entirely.
   */
  midiButton?: boolean;
  /**
   * Touch keyboard range. `'auto'` (default) measures the mount element and
   * picks a one-octave board (C4–B4) when it is narrower than 680 px or the
   * two-octave board (C4–B5) otherwise, re-picking on resize. Pass an explicit
   * `{ low, high }` to pin the window, or `false` to keep the QWERTY layout
   * even on a touch device.
   */
  touchRange?: 'auto' | false | { low: string; high: string };
  /**
   * Render the abcjs notation/transcription panel. Default `true`. Set to
   * `false` when the user should enter notes without seeing them engraved —
   * usually paired with `letterReadout`.
   */
  showNotation?: boolean;
  /**
   * Where the notation panel sits relative to the rest of the tool.
   * `'bottom'` (default) keeps it below the keyboard and controls; `'top'`
   * moves it above everything, so a host that mounts the tool inside a tall
   * fixed box shows the transcription first. Ignored when `showNotation` is
   * `false`.
   *
   * The playback transport TRAVELS WITH THE NOTATION: at
   * `'top'` it is rendered directly beneath the notation panel rather than at
   * the bottom of the tool, because it plays what the panel shows. With
   * `showTransport: false` there is nothing to move and nothing is rendered.
   */
  notationPosition?: 'top' | 'bottom';
  /**
   * Show a one-line readout of the entered notes as letters, in the order
   * they were played (repeats included), with the most recent highlighted.
   * Default `false`. Takes the notation panel's place when `showNotation` is
   * `false`, and can also sit alongside it.
   */
  letterReadout?: boolean;
  /**
   * Shrink the non-keyboard chrome — tighter rows, smaller labels, controls
   * at the touch-target minimum and no larger — so the keyboard gets the
   * room. Nothing is removed; only sizes change. Default `false`.
   */
  compactChrome?: boolean;
  /**
   * Render the note-duration palette (whole … 32nd, dot, rest). Default
   * `true`. Set to `false` when only pitch matters (e.g. an exercise scored
   * on pitch alone): a highlighted duration that is never read tells the
   * user it matters when it does not.
   */
  showDurations?: boolean;
  /**
   * Render the TRIPLET (tuplet) control. Default `true`. Set to `false`
   * wherever `showDurations` is false — a tuplet is a duration.
   */
  showTuplet?: boolean;
  /**
   * Render the playback transport (rewind / play / progress). Default
   * `true`. Set to `false` when what matters is what was entered rather
   * than what it sounds like.
   */
  showTransport?: boolean;
  /**
   * Render the "power tools" cluster — the ⚙ Advanced toggle and its panel
   * (key, clef, time signature, barlines, labels) and the MIDI icon (unless
   * `enableMidi: true` keeps it). Default `true`. Set to `false` for a
   * minimal mount that should only take a short answer.
   */
  showAdvanced?: boolean;
  /**
   * Let the Escape key clear the whole transcription. Default `false`: in a
   * mounted UI Escape does nothing, because a stray Esc (often pressed to
   * dismiss something else, such as a host page's dialog) would silently wipe
   * everything with no undo. When the
   * host supplies `onClearRequested`, Escape calls it instead, whatever this
   * flag says — the host then decides (e.g. after a confirmation). The
   * on-screen Clear button is unaffected.
   */
  escapeClears?: boolean;
  /**
   * Show the `?` help button (`.qap-help-toggle`) that folds out the help
   * panel: MIDI status and legend, keyboard shortcuts, and a link to the full
   * reference. Default `true`, independent of `showAdvanced`. With `false`
   * the MIDI icon can still open a panel holding just its MIDI section.
   */
  showHelp?: boolean;
  /** Where the help panel's "Full reference" link points. Default `"https://propellamstudios.com"`. */
  helpUrl?: string;
}

/**
 * Mounts the full qwerty-abc-piano UI into `container` and returns the
 * configured QWERTYToABCPiano instance. All target divs are created
 * automatically; pass any additional options (abcjs, callbacks, etc.)
 * via `options`.
 *
 * The UI has two instrument sub-shells — Piano and Percussion — toggled via
 * a pill button at the top. Both share a single QWERTYToABCPiano instance so
 * notes are preserved when switching shells. The duration row, notation area,
 * playback controls and Advanced panel are each independently suppressible —
 * `showDurations` / `showTuplet` / `showTransport` / `showAdvanced` /
 * `showNotation`, all default `true` — so a focused mount can offer only the
 * controls the user actually needs.
 *
 * The undo/clear edit row is the one thing that is NOT suppressible: on a
 * touch screen there is no Backspace, so these buttons are the only way to
 * delete what was entered.
 *
 * Pass `shellToggle: false` to hide the Piano/Percussion toggle bar and lock
 * the UI to whichever mode `percussionMode` specifies (default: piano).
 *
 * Lifecycle: call `destroy()` on the returned instance before re-mounting or
 * removing the UI — it removes the document keyboard listeners and empties
 * the container. (Mounting again into the same container destroys the
 * previous instance automatically, as a safety net.)
 *
 * @param container - The element to mount into, or a CSS selector for it.
 *   Its existing contents are replaced.
 * @param options - Any {@link QWERTYToABCOptions} (except the UI targets)
 *   plus the chrome flags in {@link MountFullUIOptions}.
 * @returns The QWERTYToABCPiano instance, with a `fullUI` handle
 *   ({@link MountFullUIHandle}) attached.
 * @throws Error if `container` is a selector that matches no element.
 *
 * @example
 * ```ts
 * import { mountFullUI } from 'qwerty-abc-piano';
 *
 * const piano = mountFullUI('#piano', {
 *   keySignature: 'G',
 *   timeSignature: '3/4',
 *   notationPosition: 'top',   // transcription above the keyboard
 *   showAdvanced: false,       // hide the ⚙ Advanced panel and MIDI icon
 *   letterReadout: true,       // show entered notes as letters too
 *   onClearRequested: () => {  // Esc asks before clearing
 *     if (confirm('Clear everything?')) piano.clear();
 *   },
 * });
 *
 * console.log(piano.getABC());
 * piano.destroy();             // before removing or re-mounting
 * ```
 */
export function mountFullUI(
  container: string | Element,
  options: MountFullUIOptions = {},
): MountedFullUI {
  const root = typeof container === 'string'
    ? document.querySelector(container)
    : container;
  if (!root) throw new Error(`qwerty-abc-piano: container "${container}" not found`);

  // Re-mount into the same container: tear the previous instance down first.
  // (Hosts should still call destroy() themselves before re-mounting.)
  MOUNTED.get(root)?.destroy();
  const uid = ++mountSeq;

  root.innerHTML = '';
  root.classList.add('qap-full-ui');

  const initPercussion = !!options.percussionMode;
  const showShellToggle = options.shellToggle !== false;
  const showNotation    = options.showNotation !== false;
  const notationAtTop   = options.notationPosition === 'top';
  const showLetters     = options.letterReadout === true;
  const compactChrome   = options.compactChrome === true;
  // Each surface flag defaults to `true`: a mount that passes none of them
  // gets the complete UI.
  const showDurations   = options.showDurations !== false;
  const showTuplet      = options.showTuplet    !== false;
  const showTransport   = options.showTransport !== false;
  const showAdvanced    = options.showAdvanced  !== false;
  if (compactChrome) root.classList.add('qap-compact');

  // ── Shell toggle bar (omitted when shellToggle:false) ─────────────────
  const pianoBtn = btn('Piano',      'qap-shell-btn');
  const percBtn  = btn('Percussion', 'qap-shell-btn');
  if (showShellToggle) {
    const shellBar = el('div', 'qap-shell-bar');
    if (!initPercussion) pianoBtn.classList.add('active');
    else                 percBtn.classList.add('active');
    shellBar.append(pianoBtn, percBtn);
    root.appendChild(shellBar);
  }

  // ── Shared top bar (controls that apply to both shells) ───────────────
  const topBar     = el('div', 'qap-top-bar');
  const modeDiv    = el('div', 'qap-mode-wrap');
  const tripletDiv = el('div', 'qap-triplet-wrap');
  const advToggle  = btn('⚙ Advanced', 'qap-adv-toggle');
  // Live indicator for a raw ABC token being typed (|:, :|2, !trill!, "Gm", {gc}).
  // Hidden until the user opens a capture; turns red when the token can't parse.
  const rawIndicator = el('span', 'qap-raw-indicator');
  rawIndicator.style.display = 'none';
  if (initPercussion) (modeDiv as HTMLElement).style.display = 'none';

  // ── MIDI icon + help panel ────────────────────────────────────────────
  // One small icon button reports the Web MIDI state at a glance; the words
  // live in the help panel's MIDI section (the `?` fold-out). Web MIDI's
  // permission prompt can only be triggered by requestMIDIAccess() and cannot
  // be deferred until a device is plugged in, so the icon is the explicit,
  // user-gesture opt-in: clicking it while idle / not granted / refused asks.
  const hasWebMidi = QWERTYToABCPiano.isMidiSupported();
  const autoMidi = options.enableMidi === true;
  // Built whenever it could matter: the power-tools cluster is shown, or the
  // host asked for MIDI at mount (a mount-time failure is silent, so the icon
  // is what the user can click to retry). `midiButton: false` hides it.
  const showMidiIcon = options.midiButton !== false && (showAdvanced || autoMidi);
  const showHelp = options.showHelp !== false;
  const helpUrl = options.helpUrl ?? 'https://propellamstudios.com';

  const midiIcon = btn('', 'qap-midi-indicator');
  const midiGlyph = el('span', 'qap-midi-glyph');
  midiGlyph.textContent = '🎹';
  midiGlyph.setAttribute('aria-hidden', 'true');
  const midiDot = el('span', 'qap-midi-dot');
  midiDot.setAttribute('aria-hidden', 'true');
  midiIcon.append(midiGlyph, midiDot);

  // The live status sentence, rendered in the help panel (aria-live).
  const midiStatus = el('p', 'qap-midi-status');
  midiStatus.setAttribute('aria-live', 'polite');

  let midiState: MidiIconState = hasWebMidi ? 'idle' : 'unsupported';
  function setMidiState(state: MidiIconState, devices = 0): void {
    midiState = state;
    midiIcon.dataset.state = state;
    const label = MIDI_ICON_LABEL[state];
    midiIcon.setAttribute('aria-label', label);
    midiIcon.title = label;
    midiStatus.textContent = midiStatusText(state, devices);
    midiStatus.classList.toggle('qap-midi-status--ok', state === 'connected' || state === 'no-device');
    midiStatus.classList.toggle('qap-midi-status--warn',
      state === 'unsupported' || state === 'notGranted' || state === 'refused');
  }
  setMidiState(midiState);

  const helpToggle = btn('?', 'qap-help-toggle');
  helpToggle.setAttribute('aria-label', 'Help');
  helpToggle.title = 'Help: MIDI and keyboard shortcuts';
  const helpPanel = el('div', 'qap-help-panel qap-adv-hidden');
  helpPanel.id = `qap-help-panel-${uid}`;
  helpToggle.setAttribute('aria-expanded', 'false');
  helpToggle.setAttribute('aria-controls', helpPanel.id);
  const midiSection = el('section', 'qap-help-section qap-help-midi');
  if (showMidiIcon) {
    midiSection.append(helpHeading('MIDI keyboard'), midiStatus, midiLegend(), midiHowTo());
    helpPanel.appendChild(midiSection);
  }
  if (showHelp) {
    helpPanel.append(shortcutsSection(options), referenceSection(helpUrl));
  }
  function setHelpOpen(open: boolean): void {
    helpPanel.classList.toggle('qap-adv-hidden', !open);
    helpToggle.classList.toggle('active', open);
    helpToggle.setAttribute('aria-expanded', String(open));
  }
  helpToggle.addEventListener('click', () => {
    setHelpOpen(helpPanel.classList.contains('qap-adv-hidden'));
  });
  /** Open the help panel at its MIDI section. */
  function openMidiHelp(): void {
    setHelpOpen(true);
    midiSection.scrollIntoView?.({ block: 'nearest' });
  }

  topBar.appendChild(modeDiv);
  if (showTuplet) topBar.appendChild(tripletDiv);
  topBar.appendChild(rawIndicator);
  if (showMidiIcon) topBar.append(midiIcon);
  if (showHelp) topBar.append(helpToggle);
  if (showAdvanced) topBar.append(advToggle);
  root.appendChild(topBar);
  // The help panel folds out directly under the bar that opens it.
  if (showHelp || showMidiIcon) root.appendChild(helpPanel);

  // ── Touch device detection ────────────────────────────────────────────
  const isTouchDevice = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // ── Instrument wrap — holds the two sub-shells ────────────────────────
  const instrumentWrap = el('div', 'qap-instrument-wrap');

  // Piano shell: keyboard SVG rendered here by QWERTYToABCPiano
  const pianoShell = el('div', 'qap-piano-shell');
  const pianoDiv   = el('div', 'qap-piano-wrap');
  pianoShell.appendChild(pianoDiv);
  // The keyboard-free "Start chord / End chord" toggle lives on the duration
  // row (right-justified), so it's created further down, after the piano exists.
  if (initPercussion) { pianoShell.style.display = 'none'; }

  // Range controls (touch mode only — shown inside pianoShell below the keyboard)
  let lowIdx  = DEFAULT_LOW_IDX;
  let highIdx = DEFAULT_HIGH_IDX;

  const rangeRow   = el('div', 'qap-range-row');
  const lowLabel   = el('span', 'qap-range-val');
  const highLabel  = el('span', 'qap-range-val');
  lowLabel.textContent  = midiToNoteString(WHITE_MIDIS[lowIdx]);
  highLabel.textContent = midiToNoteString(WHITE_MIDIS[highIdx]);

  const lowDec  = btn('−', 'qap-adv-btn qap-range-btn');
  const lowInc  = btn('+', 'qap-adv-btn qap-range-btn');
  const highDec = btn('−', 'qap-adv-btn qap-range-btn');
  const highInc = btn('+', 'qap-adv-btn qap-range-btn');

  // Octave-shift pair — moves the whole window without changing its span. On a
  // one-octave board this is how the user reaches a bass note below the window.
  // It modifies the range, so it sits to the LEFT of the Low/High controls.
  const octDown  = btn('◀ 8ve', 'qap-adv-btn qap-range-btn qap-oct-shift');
  const octUp    = btn('8ve ▶', 'qap-adv-btn qap-range-btn qap-oct-shift');
  const octLabel = el('span', 'qap-range-val qap-range-window');
  octDown.title = 'Move the keyboard down an octave';
  octUp.title   = 'Move the keyboard up an octave';
  const octGroup = el('span', 'qap-range-group');
  octGroup.append(octDown, octLabel, octUp);
  rangeRow.appendChild(octGroup);

  const lowGroup = el('span', 'qap-range-group');
  lowGroup.append(
    Object.assign(el('span', 'qap-adv-label'), { textContent: 'Low:' }),
    lowDec, lowLabel, lowInc,
  );
  const highGroup = el('span', 'qap-range-group');
  highGroup.append(
    Object.assign(el('span', 'qap-adv-label'), { textContent: 'High:' }),
    highDec, highLabel, highInc,
  );
  rangeRow.append(lowGroup, highGroup);
  pianoShell.appendChild(rangeRow);

  // Hide range row when there is no range keyboard (non-touch, percussion, or
  // touchRange:false keeps the QWERTY layout).
  const usesRangeKeyboard = isTouchDevice && options.touchRange !== false;
  if (!usesRangeKeyboard || initPercussion) rangeRow.style.display = 'none';

  // Percussion shell: large tap button, wired after piano is created
  const percShell = el('div', 'qap-percussion-shell');
  if (!initPercussion) percShell.style.display = 'none';

  instrumentWrap.append(pianoShell, percShell);
  root.appendChild(instrumentWrap);

  // ── Shared controls below the instrument ─────────────────────────────
  // Duration row holds the note-duration buttons (left) and the Start/End chord
  // toggle (right-justified, same height) — the toggle is appended after the
  // piano is constructed.
  const durRow      = el('div', 'qap-dur-row');
  const durDiv      = el('div', 'qap-dur-wrap');
  durRow.appendChild(durDiv);
  // Letter readout — the entered notes as letters in play order. Stands in for
  // the notation panel when the host suppresses it.
  const lettersWrap = el('div', 'qap-letters-wrap');
  const lettersLbl  = el('span', 'qap-letters-label');
  lettersLbl.textContent = 'Notes:';
  const lettersOut  = el('span', 'qap-letters');
  lettersOut.setAttribute('aria-live', 'polite');
  lettersWrap.append(lettersLbl, lettersOut);

  const notationDiv = el('div', 'qap-notation-wrap');
  // abcjs (responsive: 'resize') stamps `style="overflow: hidden"` INLINE on
  // whatever element it renders into, which would override the wrap's
  // overflow-y: auto and leave a long transcription unscrollable. Render into
  // an inner child instead: abcjs overwrites the inner div's inline style;
  // the wrap keeps the max-height + scroll.
  const notationInner = el('div', 'qap-notation-inner');
  notationDiv.appendChild(notationInner);
  const playbackDiv = el('div', 'qap-playback-wrap');

  // ── Edit row: undo-last + clear-all ───────────────────────────────────
  // Unconditional in EVERY shell, compact and full alike: Backspace is not a
  // deletion affordance on a phone, so without these an entered note cannot be
  // removed by any means the user can reach. Placed directly under the
  // keyboard — grouped with the input it modifies and adjacent to where
  // entries appear — and away from anything a host places below the whole
  // tool (such as a Submit button), because a destructive clear-all must be
  // hard to hit by accident.
  const editRow  = el('div', 'qap-edit-row');
  const undoBtn  = btn('⌫ Undo', 'qap-edit-btn qap-undo-btn');
  const clearBtn = btn('Clear', 'qap-edit-btn qap-clear-btn');
  undoBtn.title  = 'Remove the last note you entered';
  clearBtn.title = 'Remove everything you have entered';
  editRow.append(undoBtn, clearBtn);

  if (showDurations) root.appendChild(durRow);
  root.appendChild(editRow);
  if (showLetters)  root.appendChild(lettersWrap);
  // `notationPosition: 'top'` puts the rendered notation ABOVE the keyboard and
  // every control associated with it, rather than below them: in a tall
  // embedded mount the transcription is otherwise off-screen
  // until the host scrolls past the whole tool. The panel keeps its own capped
  // height and inner scroll either way, so a long transcription scrolls inside
  // the panel instead of pushing the keyboard down.
  if (showNotation) {
    if (notationAtTop) root.insertBefore(notationDiv, root.firstChild);
    else root.appendChild(notationDiv);
  }
  // The transport plays THE TRANSCRIPTION, so when the notation moves to the
  // top the play button and scrubber travel with it — otherwise they would sit
  // at the bottom of the whole tool, below the keyboard and the edit row, a
  // scroll away (on a phone) from the thing they control. With `'bottom'` the
  // transport stays last.
  if (showTransport) {
    if (showNotation && notationAtTop) {
      root.insertBefore(playbackDiv, notationDiv.nextSibling);
    } else {
      root.appendChild(playbackDiv);
    }
  }

  // ── Advanced panel ────────────────────────────────────────────────────
  const advPanel = el('div', 'qap-adv-panel qap-adv-hidden');
  advPanel.id = `qap-adv-panel-${uid}`;
  advToggle.setAttribute('aria-expanded', 'false');
  advToggle.setAttribute('aria-controls', advPanel.id);
  if (showAdvanced) root.appendChild(advPanel);

  advToggle.addEventListener('click', () => {
    const open = advPanel.classList.toggle('qap-adv-hidden') === false;
    advToggle.classList.toggle('active', open);
    advToggle.setAttribute('aria-expanded', String(open));
  });

  // ── Instantiate — always with percussionMode:false so the piano SVG is
  //    always rendered; the shell toggle controls display and calls
  //    setPercussionMode() to flip the behavioral flag. ──────────────────
  // Keep the chord button's label in sync with the real chord state (which can
  // change via the keyboard/touch too, not only the button) without clobbering a
  // caller-supplied onSimultaneousChange.
  let setChordActive: ((active: boolean) => void) | null = null;
  const userSimChange = options.onSimultaneousChange;
  const userRawChange = options.onRawChange;
  const userMidiStateChange = options.onMidiStateChange;

  const piano = new QWERTYToABCPiano({
    ...options,
    // The mount owns the MIDI connection so it can report the outcome in the
    // MIDI icon and help-panel status line; letting the instance auto-connect
    // too would fire a second requestMIDIAccess for the same mount.
    enableMidi: false,
    // Escape clears only when the host opts in (escapeClears) or handles it
    // (onClearRequested). Otherwise a no-op handler makes Esc do nothing.
    onClearRequested: options.onClearRequested
      ?? (options.escapeClears === true ? null : () => {}),
    percussionMode: false,   // shell swap manages display; piano manages behaviour flag
    pianoTarget:    pianoDiv,
    // No target at all when a surface is suppressed — the instance then builds
    // nothing for it, rather than building controls into a detached node.
    // QWERTYToABCPiano accepts a null target for each of these.
    durationTarget: showDurations ? durDiv : null,
    modeTarget:     modeDiv,
    notationTarget: showNotation ? notationInner : null,
    playbackTarget: showTransport
      ? ((options as QWERTYToABCOptions).playbackTarget ?? playbackDiv)
      : null,
    tupletTarget:   showTuplet ? tripletDiv : null,
    onSimultaneousChange: (active, count) => {
      setChordActive?.(active);
      userSimChange?.(active, count);
    },
    // Device plugged in / unplugged after access was granted.
    onMidiStateChange: (connectedInputs) => {
      if (piano.isMidiConnected()) {
        setMidiState(connectedInputs > 0 ? 'connected' : 'no-device', connectedInputs);
      }
      userMidiStateChange?.(connectedInputs);
    },
    onRawChange: (buffer, valid) => {
      if (buffer) {
        rawIndicator.style.display = '';
        rawIndicator.textContent = `ABC: ${buffer}  ${valid ? '✓' : '✗ invalid'}`;
        rawIndicator.classList.toggle('qap-raw-invalid', !valid);
      } else {
        rawIndicator.style.display = 'none';
        rawIndicator.textContent = '';
        rawIndicator.classList.remove('qap-raw-invalid');
      }
      userRawChange?.(buffer, valid);
    },
  });

  // Connect Web MIDI and reflect the outcome in the icon. Shared by the icon,
  // the handle's connectMidi() and the mount-time `enableMidi: true` path.
  const deviceState = (): MidiIconState =>
    piano.getMidiInputCount() > 0 ? 'connected' : 'no-device';
  async function connectMidi(userInitiated: boolean): Promise<boolean> {
    if (!hasWebMidi) { setMidiState('unsupported'); return false; }
    if (piano.isMidiConnected()) {
      setMidiState(deviceState(), piano.getMidiInputCount());
      return true;
    }
    setMidiState('pending');
    const result = await piano.enableMidiInput();
    if (result.state === 'connected') {
      setMidiState(deviceState(), piano.getMidiInputCount());
      return true;
    }
    if (result.state === 'unsupported') { setMidiState('unsupported'); return false; }
    // Failure states are reported ONLY for a request the user made. Telling a
    // user who was never asked that they denied access sends them looking for
    // a decision they never made — so a mount-time failure is SILENT: the
    // icon simply stays idle, clickable.
    if (userInitiated) {
      setMidiState(result.state);
      // Show the reason as visible text, not just a tooltip (touch screens
      // have no hover).
      openMidiHelp();
    } else {
      setMidiState('idle');
    }
    return false;
  }

  if (showMidiIcon) {
    midiIcon.addEventListener('click', () => {
      // A genuine user gesture: the only place the prompt may fire.
      if (midiState === 'idle' || midiState === 'notGranted' || midiState === 'refused') {
        void connectMidi(true);
      } else {
        openMidiHelp();
      }
    });
  }

  // `enableMidi: true` — the host wants a plugged-in keyboard to just work, so
  // access is requested at mount. The browser's permission
  // prompt is unavoidable on the web; there is no silent auto-connect.
  if (autoMidi) void connectMidi(false);

  // Wire the edit-row delete controls. `undo` and `clear` are the instance's
  // own public methods — the same path Backspace and a host's clear use —
  // so a note removed by touch behaves identically to one removed by key.
  undoBtn.addEventListener('click', () => piano.undo());
  clearBtn.addEventListener('click', () => piano.clear());

  // Populate the keyboard-free chord toggle now that the piano exists, and grab
  // the button so the shell switch can hide it. It normally rides the duration
  // row; when that row is suppressed it moves to the edit row, because on a
  // touch screen the button is the only way to enter a chord and must not
  // disappear with the duration palette.
  const chordHost = showDurations ? durRow : editRow;
  setChordActive = renderChordButton(chordHost, piano);
  const chordBtnEl = chordHost.querySelector<HTMLElement>('.qap-chord-btn');

  // If the caller requested percussion at startup, flip the flag now.
  if (initPercussion) {
    piano.setPercussionMode(true);
    if (chordBtnEl) chordBtnEl.style.display = 'none';
  }

  // ── Touch range keyboard ──────────────────────────────────────────────
  // On touch devices, switch to the range keyboard immediately and wire controls.
  const pinnedRange = (options.touchRange && options.touchRange !== 'auto')
    ? options.touchRange
    : null;
  const autoRange = options.touchRange === undefined || options.touchRange === 'auto';

  // On a narrow board, cap the notation panel so the whole tool — keyboard,
  // range row, duration row, transcription, playback — fits a phone without an
  // inner scrollbar. The variable is already honoured by .qap-notation-wrap.
  function applyNotationCap(): void {
    const narrow = pickHighIdx((root as HTMLElement).clientWidth) === COMPACT_HIGH_IDX;
    if (narrow) (root as HTMLElement).style.setProperty('--qwerty-abc-piano-notation-max-height', '140px');
    else        (root as HTMLElement).style.removeProperty('--qwerty-abc-piano-notation-max-height');
  }

  if (isTouchDevice && options.touchRange !== false) {
    if (pinnedRange) {
      piano.setTouchKeyRange(pinnedRange.low, pinnedRange.high);
    } else {
      if (autoRange) highIdx = pickHighIdx((root as HTMLElement).clientWidth);
      piano.setTouchKeyRange(
        midiToNoteString(WHITE_MIDIS[lowIdx]),
        midiToNoteString(WHITE_MIDIS[highIdx]),
      );
    }

    function applyRange(): void {
      const low  = midiToNoteString(WHITE_MIDIS[lowIdx]);
      const high = midiToNoteString(WHITE_MIDIS[highIdx]);
      lowLabel.textContent  = low;
      highLabel.textContent = high;
      octLabel.textContent  = `${low}–${high}`;
      octDown.disabled = lowIdx - OCTAVE_STEPS < 0;
      octUp.disabled   = highIdx + OCTAVE_STEPS > WHITE_MIDIS.length - 1;
      piano.setTouchKeyRange(low, high);
    }

    // Label + disabled states for the initial window.
    octLabel.textContent = `${midiToNoteString(WHITE_MIDIS[lowIdx])}–${midiToNoteString(WHITE_MIDIS[highIdx])}`;
    octDown.disabled = lowIdx - OCTAVE_STEPS < 0;
    octUp.disabled   = highIdx + OCTAVE_STEPS > WHITE_MIDIS.length - 1;

    // Shift the whole window by an octave, keeping its span. At the ends of the
    // range the buttons are disabled, not hidden, so the layout stays put.
    octDown.addEventListener('click', () => {
      if (lowIdx - OCTAVE_STEPS < 0) return;
      lowIdx  -= OCTAVE_STEPS;
      highIdx -= OCTAVE_STEPS;
      applyRange();
    });
    octUp.addEventListener('click', () => {
      if (highIdx + OCTAVE_STEPS > WHITE_MIDIS.length - 1) return;
      lowIdx  += OCTAVE_STEPS;
      highIdx += OCTAVE_STEPS;
      applyRange();
    });

    // Re-pick the board when the host resizes the mount (a Flutter platform
    // view is created before it is sized, so the first measurement is often 0).
    // setTouchKeyRange wipes and re-renders the SVG, so only act on a real
    // change of board — an unguarded observer would destroy the keyboard on
    // every resize tick.
    if (autoRange && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const picked = pickHighIdx((root as HTMLElement).clientWidth);
        if (picked === highIdx) return;
        highIdx = picked;
        applyRange();
        applyNotationCap();
      });
      ro.observe(root as HTMLElement);
      piano.addTeardown(() => ro.disconnect());
    }
    applyNotationCap();

    lowDec.addEventListener('click', () => {
      if (lowIdx > 0 && lowIdx - 1 <= highIdx - MIN_SPAN) { lowIdx--; applyRange(); }
    });
    lowInc.addEventListener('click', () => {
      if (lowIdx < highIdx - MIN_SPAN) { lowIdx++; applyRange(); }
    });
    highDec.addEventListener('click', () => {
      if (highIdx > lowIdx + MIN_SPAN) { highIdx--; applyRange(); }
    });
    highInc.addEventListener('click', () => {
      if (highIdx < WHITE_MIDIS.length - 1 && highIdx + 1 >= lowIdx + MIN_SPAN) { highIdx++; applyRange(); }
    });
  }

  // ── Letter readout ────────────────────────────────────────────────────
  // Ordered as played, repeats included (a deduplicated set reads as confusing
  // feedback). Driven by the display listener so notes
  // buffered into an open chord appear as they are tapped, not only on commit.
  if (showLetters) {
    const renderLetters = (): void => {
      const letters = piano.getNoteLetters();
      lettersOut.textContent = '';
      if (letters.length === 0) {
        const empty = el('span', 'qap-letters-empty');
        empty.textContent = '—';
        lettersOut.appendChild(empty);
        return;
      }
      letters.forEach((letter, i) => {
        const span = el('span', i === letters.length - 1
          ? 'qap-letter qap-letter--last'
          : 'qap-letter');
        // Black keys show both spellings, e.g. 'G#/Ab'.
        span.textContent = enharmonicDisplayName(letter);
        lettersOut.appendChild(span);
      });
    };
    piano.setDisplayListener(renderLetters);
    renderLetters();
  }

  // ── Percussion shell: tap button ──────────────────────────────────────
  _mountPercussionShell(percShell, piano);

  // ── Advanced panel controls ───────────────────────────────────────────

  // Key signature (hidden in percussion mode — fixed pitch)
  const keySigRow = el('div', 'qap-adv-row');
  keySigRow.appendChild(Object.assign(el('span', 'qap-adv-label'), { textContent: 'Key:' }));
  const keySigBtns = el('div', 'qap-btn-group');
  for (const ks of KEY_SIGS) {
    const b = btn(ks, 'qap-adv-btn');
    if (ks === (options.keySignature ?? 'C')) b.classList.add('active');
    b.addEventListener('click', () => {
      piano.setKeySignature(ks);
      keySigBtns.querySelectorAll('.qap-adv-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    keySigBtns.appendChild(b);
  }
  keySigRow.appendChild(keySigBtns);
  advPanel.appendChild(keySigRow);

  // Clef (hidden in percussion mode — fixed pitch)
  const clefRow = el('div', 'qap-adv-row');
  clefRow.appendChild(Object.assign(el('span', 'qap-adv-label'), { textContent: 'Clef:' }));
  const clefBtns = el('div', 'qap-btn-group');
  for (const clef of CLEFS) {
    const b = btn(clef, 'qap-adv-btn');
    if (clef === (options.clef ?? 'treble')) b.classList.add('active');
    b.addEventListener('click', () => {
      piano.setClef(clef);
      clefBtns.querySelectorAll('.qap-adv-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    clefBtns.appendChild(b);
  }
  clefRow.appendChild(clefBtns);
  advPanel.appendChild(clefRow);

  // Time signature
  const timeSigRow = el('div', 'qap-adv-row');
  timeSigRow.appendChild(Object.assign(el('span', 'qap-adv-label'), { textContent: 'Time:' }));
  const timeSigBtns = el('div', 'qap-btn-group');
  for (const ts of TIME_SIGS) {
    const b = btn(ts, 'qap-adv-btn');
    if (ts === (options.timeSignature ?? '4/4')) b.classList.add('active');
    b.addEventListener('click', () => {
      piano.setTimeSignature(ts);
      timeSigBtns.querySelectorAll('.qap-adv-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    timeSigBtns.appendChild(b);
  }
  timeSigRow.appendChild(timeSigBtns);
  advPanel.appendChild(timeSigRow);

  // Barline mode
  const barRow = el('div', 'qap-adv-row');
  barRow.appendChild(Object.assign(el('span', 'qap-adv-label'), { textContent: 'Barlines:' }));
  const barBtns = el('div', 'qap-btn-group');
  for (const mode of BARLINE_MODES) {
    const b = btn(mode, 'qap-adv-btn');
    const initMode = (options as QWERTYToABCOptions).barlineMode ?? 'auto';
    if (mode === initMode) b.classList.add('active');
    b.addEventListener('click', () => {
      piano.setBarlineMode(mode);
      barBtns.querySelectorAll('.qap-adv-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    barBtns.appendChild(b);
  }
  barRow.appendChild(barBtns);
  advPanel.appendChild(barRow);

  // Insert barline + measures-per-line stepper
  const actionRow = el('div', 'qap-adv-row');
  const insertBarBtn = btn('Insert barline (\\)', 'qap-adv-btn');
  insertBarBtn.addEventListener('click', () => piano.insertBarline());
  actionRow.appendChild(insertBarBtn);

  const mplWrap  = el('span', 'qap-mpl-wrap');
  const mplLabel = Object.assign(el('span', 'qap-adv-label'), { textContent: 'Measures/line:' });
  const mplDec   = btn('−', 'qap-adv-btn qap-mpl-btn');
  const mplVal   = Object.assign(el('span', 'qap-mpl-val'), { textContent: String((options as QWERTYToABCOptions & { measuresPerLine?: number }).measuresPerLine ?? 4) });
  const mplInc   = btn('+', 'qap-adv-btn qap-mpl-btn');
  let currentMPL = parseInt(mplVal.textContent!, 10);
  mplDec.addEventListener('click', () => {
    currentMPL = Math.max(0, currentMPL - 1);
    mplVal.textContent = String(currentMPL);
    piano.setMeasuresPerLine(currentMPL);
  });
  mplInc.addEventListener('click', () => {
    currentMPL++;
    mplVal.textContent = String(currentMPL);
    piano.setMeasuresPerLine(currentMPL);
  });
  mplWrap.append(mplLabel, mplDec, mplVal, mplInc);
  actionRow.appendChild(mplWrap);
  advPanel.appendChild(actionRow);

  // Label toggles (hidden in percussion mode — labels are on the piano SVG)
  const labelRow = el('div', 'qap-adv-row');

  // Each checkbox sits INSIDE its <label> (no for/id), so two mounts on one
  // page cannot collide on ids. Initial state follows the options.
  function labelledCheckbox(text: string, checked: boolean, onChange: (on: boolean) => void): HTMLLabelElement {
    const chk = document.createElement('input');
    chk.type    = 'checkbox';
    chk.checked = checked;
    chk.addEventListener('change', () => onChange(chk.checked));
    const label = document.createElement('label');
    label.append(chk, ` ${text}`);
    return label;
  }
  const noteNamesLabel = labelledCheckbox('Note names', options.showNoteNames !== false,
    on => piano.setShowNoteNames(on));
  noteNamesLabel.classList.add('qap-show-note-names');
  const keyLabelsLabel = labelledCheckbox('Key labels', options.showKeyLabels !== false,
    on => piano.setShowKeyLabels(on));
  keyLabelsLabel.classList.add('qap-show-key-labels');

  labelRow.append(noteNamesLabel, keyLabelsLabel);
  advPanel.appendChild(labelRow);

  // Apply initial hide state for percussion-irrelevant rows
  if (initPercussion) {
    keySigRow.classList.add('qap-adv-row--hidden');
    clefRow.classList.add('qap-adv-row--hidden');
    labelRow.classList.add('qap-adv-row--hidden');
  }

  // ── Shell switch logic ────────────────────────────────────────────────
  // Each shell keeps its own ABC body so notes are preserved across switches.
  let savedPianoABC = '';
  let savedPercABC  = '';

  function switchShell(toPercussion: boolean): void {
    // Save the note state of the shell we're leaving.
    if (toPercussion) {
      savedPianoABC = piano.getABC();
    } else {
      savedPercABC = piano.getABC();
    }

    // Flip the behavioral flag (updates _percussionMode, re-renders with old notes briefly).
    piano.setPercussionMode(toPercussion);

    // Restore the saved state for the shell we're entering — this re-renders immediately.
    piano.setABC(toPercussion ? savedPercABC : savedPianoABC);

    pianoShell.style.display = toPercussion ? 'none' : '';
    percShell.style.display  = toPercussion ? '' : 'none';
    if (chordBtnEl) chordBtnEl.style.display = toPercussion ? 'none' : '';
    (modeDiv as HTMLElement).style.display = toPercussion ? 'none' : '';

    pianoBtn.classList.toggle('active', !toPercussion);
    percBtn.classList.toggle('active',  toPercussion);

    keySigRow.classList.toggle('qap-adv-row--hidden', toPercussion);
    clefRow.classList.toggle('qap-adv-row--hidden',   toPercussion);
    labelRow.classList.toggle('qap-adv-row--hidden',  toPercussion);

    if (usesRangeKeyboard) rangeRow.style.display = toPercussion ? 'none' : '';
  }

  if (showShellToggle) {
    pianoBtn.addEventListener('click', () => switchShell(false));
    percBtn.addEventListener('click',  () => switchShell(true));
  }

  // ── Inject layout CSS ─────────────────────────────────────────────────
  // Injected into the root node containing the mount element so the styles
  // also apply when the host places the widget inside a shadow root
  // (Flutter web platform views do this, for example).
  _injectFullUIStyles(root);

  // ── The mount's programmatic handle (MountFullUIHandle) ───────────────
  function highlight(group: Element, value: string): void {
    group.querySelectorAll('.qap-adv-btn').forEach(b => {
      b.classList.toggle('active', b.textContent === value);
    });
  }

  const fullUI: MountFullUIHandle = {
    setTimeSignature(ts: string): void {
      piano.setTimeSignature(ts);
      highlight(timeSigBtns, ts);
    },
    setKeySignature(ks: string): void {
      piano.setKeySignature(ks);
      highlight(keySigBtns, ks);
    },
    connectMidi: () => connectMidi(true),
  };

  // destroy() also empties the container this mount built into.
  MOUNTED.set(root, piano);
  piano.addTeardown(() => {
    if (MOUNTED.get(root!) === piano) MOUNTED.delete(root!);
    root!.innerHTML = '';
    root!.classList.remove('qap-full-ui', 'qap-compact');
    (root as HTMLElement).style?.removeProperty('--qwerty-abc-piano-notation-max-height');
  });

  return Object.assign(piano, { fullUI });
}

/** Builds the percussion sub-shell: a large TAP button. */
function _mountPercussionShell(target: Element, piano: QWERTYToABCPiano): void {
  const tapBtn = document.createElement('button');
  tapBtn.type = 'button';
  tapBtn.className = 'qap-tap-btn';

  const label = document.createElement('span');
  label.className = 'qap-tap-label';
  label.textContent = 'TAP';

  const hint = document.createElement('small');
  hint.className = 'qap-tap-hint';
  hint.textContent = TAP_HINT;

  tapBtn.append(label, hint);
  tapBtn.addEventListener('click', () => piano.tap());
  target.appendChild(tapBtn);
}

const FULL_UI_STYLE_ID = 'qap-full-ui-styles';

function _injectFullUIStyles(refEl: Element): void {
  injectStylesInto(refEl, FULL_UI_STYLE_ID, `
    .qap-full-ui { display: flex; flex-direction: column; gap: 0.5rem; font-family: sans-serif; }
    .qap-shell-bar { display: flex; gap: 0.25rem; }
    .qap-shell-btn {
      padding: 0.35rem 1rem; font-size: 0.85rem; font-weight: 600; font-family: inherit;
      border: 1px solid #bbb; border-radius: 999px; background: #f5f5f5;
      cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .qap-shell-btn:hover:not(.active) { background: #e8f0fe; border-color: #6b9bd5; }
    .qap-shell-btn.active { background: #1a5fb4; color: #fff; border-color: #1a5fb4; }
    .qap-top-bar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .qap-raw-indicator {
      font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.8rem;
      padding: 0.2rem 0.5rem; border: 1px solid #6b9bd5; border-radius: 4px;
      background: #e8f0fe; color: #1a5fb4; white-space: nowrap;
    }
    .qap-raw-indicator.qap-raw-invalid { border-color: #d05c54; background: #fde8e6; color: #b02a20; }
    .qap-instrument-wrap { width: 100%; }
    .qap-piano-wrap svg { display: block; }
    .qap-dur-row { display: flex; align-items: stretch; gap: 0.5rem; }
    .qap-dur-wrap { display: flex; flex-wrap: wrap; gap: 0.25rem; flex: 1 1 auto; }
    /* Cap the notation height and scroll within it, so a long transcription
       stays fully viewable when the widget is embedded in a fixed-height host
       instead of overflowing and getting clipped. Hosts that want
       unbounded growth can set --qwerty-abc-piano-notation-max-height: none. */
    .qap-notation-wrap { min-height: 100px; max-height: var(--qwerty-abc-piano-notation-max-height, 260px); overflow-y: auto; overflow-x: auto; }
    /* The WRAP owns both scroll axes, not the inner: abcjs stamps an inline
       "overflow: hidden" on its own render target (which is .qap-notation-inner),
       so a rule there would be overridden. The inner sizes to the engraved SVG
       via max-content, which is what gives the wrap a horizontal scroll range
       at all; min-width keeps a short staff filling the panel. At phone width
       abcjs engraves ~740px, so without the horizontal scroll the right-hand
       end of every staff line would be clipped and out of reach. */
    .qap-notation-inner { width: max-content; min-width: 100%; }
    .qap-adv-panel { display: flex; flex-direction: column; gap: 0.5rem; border: 1px solid #ccc; border-radius: 4px; padding: 0.75rem; background: #fafafa; }
    .qap-adv-hidden { display: none; }
    .qap-adv-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .qap-adv-row--hidden { display: none; }
    .qap-adv-label { font-size: 0.85rem; color: #555; min-width: 4rem; }
    .qap-btn-group { display: flex; flex-wrap: wrap; gap: 0.25rem; }
    .qap-adv-btn { padding: 0.2rem 0.5rem; font-size: 0.8rem; border: 1px solid #bbb; border-radius: 3px; background: white; cursor: pointer; }
    .qap-adv-btn.active { background: #1a5fb4; color: white; border-color: #1a5fb4; }
    .qap-adv-btn:hover:not(:disabled) { background: #e8f0fe; }
    .qap-mpl-wrap { display: flex; align-items: center; gap: 0.25rem; }
    .qap-mpl-btn { min-width: 28px; padding: 0.2rem 0.4rem; }
    .qap-mpl-val { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; }
    .qap-adv-toggle.active { background: #1a5fb4; color: white; }
    /* MIDI icon: one small button, its state in data-state and a dot. */
    .qap-midi-indicator {
      position: relative; display: inline-flex; align-items: center; justify-content: center;
      width: 2rem; height: 2rem; padding: 0; font-size: 1rem; line-height: 1; font-family: inherit;
      border: 1px solid #bbb; border-radius: 6px; background: #f5f5f5; color: #333; cursor: pointer;
      transition: background 0.12s, border-color 0.12s, opacity 0.12s;
    }
    .qap-midi-indicator:hover { background: #e8f0fe; }
    .qap-midi-dot {
      position: absolute; right: 2px; bottom: 2px; width: 7px; height: 7px; border-radius: 50%;
      background: transparent; border: 1px solid #999; box-sizing: border-box;
    }
    .qap-midi-indicator[data-state="idle"] { border-style: dashed; }
    .qap-midi-indicator[data-state="pending"] .qap-midi-dot { background: #6b9bd5; border-color: #6b9bd5; animation: qap-midi-pulse 1s ease-in-out infinite; }
    .qap-midi-indicator[data-state="no-device"] { border-color: #d99a1e; }
    .qap-midi-indicator[data-state="no-device"] .qap-midi-dot { background: #e0a526; border-color: #b7801a; }
    .qap-midi-indicator[data-state="connected"] { border-color: #2a9d4a; }
    .qap-midi-indicator[data-state="connected"] .qap-midi-dot { background: #2a9d4a; border-color: #2a9d4a; }
    .qap-midi-indicator[data-state="notGranted"], .qap-midi-indicator[data-state="refused"] { border-color: #b02a20; }
    .qap-midi-indicator[data-state="notGranted"] .qap-midi-dot,
    .qap-midi-indicator[data-state="refused"] .qap-midi-dot { background: #b02a20; border-color: #b02a20; }
    .qap-midi-indicator[data-state="unsupported"] { opacity: 0.5; }
    .qap-midi-indicator[data-state="unsupported"]::after {
      content: ''; position: absolute; left: 15%; right: 15%; top: 50%; height: 2px;
      background: #666; transform: rotate(-35deg);
    }
    @keyframes qap-midi-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
    @media (prefers-reduced-motion: reduce) {
      .qap-midi-indicator[data-state="pending"] .qap-midi-dot { animation: none; }
    }
    /* Help toggle + panel (same fold-out pattern as Advanced). */
    .qap-help-toggle {
      min-width: 2rem; height: 2rem; padding: 0 0.5rem; font: 700 0.9rem/1 inherit; font-family: inherit;
      border: 1px solid #bbb; border-radius: 999px; background: #f5f5f5; color: #333; cursor: pointer;
    }
    .qap-help-toggle:hover { background: #e8f0fe; border-color: #6b9bd5; }
    .qap-help-toggle.active { background: #1a5fb4; color: #fff; border-color: #1a5fb4; }
    .qap-help-panel { display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid #ccc; border-radius: 4px; padding: 0.75rem; background: #fafafa; color: #333; font-size: 0.85rem; }
    .qap-help-panel.qap-adv-hidden { display: none; }
    .qap-help-heading { margin: 0 0 0.35rem; font-weight: 700; font-size: 0.9rem; }
    .qap-help-text { margin: 0.35rem 0 0; }
    /* MIDI status line: the reason MIDI is or isn't working,
       as visible text — a tooltip does not exist for a finger. */
    .qap-midi-status { margin: 0; font-size: 0.85rem; color: #555; }
    .qap-midi-status--ok   { color: #2a9d4a; font-weight: 600; }
    .qap-midi-status--warn { color: #b02a20; }
    .qap-midi-legend { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.25rem; }
    .qap-midi-legend li { display: flex; align-items: center; gap: 0.5rem; }
    .qap-midi-legend-swatch { flex: none; width: 10px; height: 10px; border-radius: 50%; border: 1px solid #999; box-sizing: border-box; }
    .qap-midi-legend-swatch[data-state="idle"] { border-style: dashed; }
    .qap-midi-legend-swatch[data-state="pending"] { background: #6b9bd5; border-color: #6b9bd5; }
    .qap-midi-legend-swatch[data-state="no-device"] { background: #e0a526; border-color: #b7801a; }
    .qap-midi-legend-swatch[data-state="connected"] { background: #2a9d4a; border-color: #2a9d4a; }
    .qap-midi-legend-swatch[data-state="refused"] { background: #b02a20; border-color: #b02a20; }
    .qap-midi-legend-swatch[data-state="unsupported"] { opacity: 0.5; background: linear-gradient(135deg, transparent 45%, #666 45%, #666 55%, transparent 55%); }
    .qap-help-shortcuts { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; margin: 0; }
    .qap-help-shortcuts dt { margin: 0; }
    .qap-help-shortcuts dd { margin: 0; }
    .qap-help-shortcuts kbd {
      font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.8rem; white-space: nowrap;
      padding: 0.05rem 0.35rem; border: 1px solid #ccc; border-radius: 3px; background: #fff;
    }
    .qap-help-link { color: #1a5fb4; }
    .qap-range-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding: 0.35rem 0 0; }
    .qap-range-group { display: flex; align-items: center; gap: 0.25rem; }
    .qap-range-group .qap-adv-label { min-width: auto; }
    .qap-range-val { font-size: 0.85rem; font-variant-numeric: tabular-nums; min-width: 3ch; text-align: center; }
    /* The chord toggle sits on the duration row, pushed to the right and
       stretched to the duration buttons' height for a tidy, aligned look. */
    .qap-dur-row > .qap-chord-btn { margin-left: auto; align-self: stretch; }
    .qap-chord-btn {
      padding: 0.4rem 1rem; font-size: 0.9rem; font-weight: 600; font-family: inherit;
      border: 1px solid #bbb; border-radius: 6px; background: #f5f5f5; cursor: pointer;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .qap-chord-btn:hover:not(.qap-chord-btn--active) { background: #e8f0fe; border-color: #6b9bd5; }
    .qap-chord-btn--active { background: #2a9d4a; color: #fff; border-color: #2a9d4a; }
    /* Edit row: undo-last + clear-all, always present.
       Clear is pushed away from Undo so a miss on Undo cannot wipe the entry. */
    .qap-edit-row { display: flex; align-items: center; gap: 0.5rem; }
    .qap-edit-row > .qap-chord-btn { margin-left: auto; }
    .qap-edit-btn {
      padding: 0.4rem 0.9rem; font-size: 0.9rem; font-weight: 600; font-family: inherit;
      border: 1px solid #bbb; border-radius: 6px; background: #f5f5f5; cursor: pointer;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .qap-edit-btn:hover { background: #e8f0fe; border-color: #6b9bd5; }
    .qap-clear-btn { margin-left: 1.5rem; color: #b02a20; border-color: #d9b4b0; }
    .qap-clear-btn:hover { background: #fde8e6; border-color: #b02a20; }
    .qap-letters-wrap {
      display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
      min-height: 2rem; padding: 0.25rem 0;
    }
    .qap-letters-label { font-size: 0.85rem; color: #555; }
    .qap-letters { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .qap-letter {
      font: 600 1rem/1 ui-monospace, Menlo, Consolas, monospace;
      padding: 0.25rem 0.4rem; border-radius: 4px; background: #eef3fa; color: #1a5fb4;
    }
    .qap-letter--last { background: #1a5fb4; color: #fff; }
    .qap-letters-empty { font-size: 0.95rem; color: #999; }
    /* Compact chrome: the keyboard is the main input; everything else shrinks
       to touch-target size and no larger. Purely dimensional — no control
       loses its function here. */
    .qap-full-ui.qap-compact { gap: 0.35rem; }
    .qap-full-ui.qap-compact .qap-top-bar { gap: 0.35rem; }
    .qap-full-ui.qap-compact .qap-adv-panel { padding: 0.5rem; gap: 0.35rem; }
    .qap-full-ui.qap-compact .qap-adv-label { min-width: auto; font-size: 0.8rem; }
    .qap-full-ui.qap-compact .qap-range-row { gap: 0.5rem; padding: 0.25rem 0 0; }
    .qap-full-ui.qap-compact .qap-dur-row { gap: 0.35rem; }
    .qap-full-ui.qap-compact .qap-letters-wrap { padding: 0; }
    @media (hover: none) and (pointer: coarse) {
      /* Touch has no :hover, so without this a button gives nothing back on
         press. */
      .qap-adv-btn:active, .qap-shell-btn:active, .qap-chord-btn:active,
      .qap-midi-indicator:active, .qap-help-toggle:active, .qap-adv-toggle:active, .qap-edit-btn:active {
        transform: scale(0.97); filter: brightness(0.95);
      }
      /* Compact must not mean unreachable: a full 44px touch target in every
         layout, including the most minimal mounts. */
      .qap-edit-btn { min-height: 44px; min-width: 44px; font-size: 1rem; padding: 0.5rem 1rem; }
      .qap-shell-btn { min-height: 44px; padding: 0.5rem 1.25rem; font-size: 1rem; }
      .qap-adv-btn { min-height: 44px; min-width: 44px; font-size: 1rem; padding: 0.5rem; }
      .qap-adv-toggle { min-height: 44px; padding: 0.5rem 1rem; }
      .qap-midi-indicator, .qap-help-toggle { min-height: 44px; min-width: 44px; }
      .qap-range-btn { min-height: 44px; min-width: 44px; font-size: 1.1rem; }
      .qap-chord-btn { min-height: 44px; font-size: 1rem; }
    }
  `);
}
