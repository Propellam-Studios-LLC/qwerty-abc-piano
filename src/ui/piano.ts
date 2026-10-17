import type { Mode, QwertyAnchor, NoteLabels, KeyMark } from '../types.js';
import { qwertyKeyMaps, WHITE_KEY_ROW, BLACK_KEY_ROW, noteToMidi } from '../keymap.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Piano layout constants ────────────────────────────────────────────────────
const MARGIN_L    = 20;   // px left/right margin inside viewBox
const WHITE_STRIDE = 60;  // x spacing between white key start positions
const WHITE_W     = 58;   // white key visual width (2px gap between keys)
const WHITE_H     = 100;  // white key height
const KEY_Y       = 5;    // top of all keys
const BLACK_W     = 36;   // black key width
const BLACK_H     = 62;   // black key height
const OCT_Y       = 135;  // octave indicator circle center y
const OCT_SPACING = 44;   // px between octave positions
const OCT_R       = 12;   // octave indicator circle radius
const OCT_HIT_R   = 22;   // invisible touch target around each octave dot (44px across)

// Full viewBox height for the default keyboard (keys + note names + octave row).
const VIEWBOX_H       = 150;
// Range keyboards have no octave row, so they end just under the note names.
// The extra ~20% of key height this buys is what makes a one-octave board
// comfortable at phone width.
const VIEWBOX_H_RANGE = 120;


// ── Octave mini-map ──────────────────────────────────────────────────────────
// A compact white-key strip showing where the currently-playable window sits on
// the wider keyboard, with a tick at middle C. Drawn on the octave row, right
// of the shift dots.
const MAP_LOW_MIDI  = 36; // C2
const MAP_HIGH_MIDI = 95; // B6
const MAP_STRIDE    = 4;  // px per white key in the strip
const MAP_H         = 14; // strip height

/**
 * The QWERTY layout for an anchor: each home-row key in order with its note
 * at shift 0, and each black key with the index of the white key to its left
 * (a black key at row position i sits between white keys i-1 and i).
 */
function _qwertyLayout(anchor: QwertyAnchor): {
  white: Array<{ key: string; note: string; octave: number }>;
  black: Array<{ key: string; note: string; octave: number; leftIdx: number }>;
} {
  const maps = qwertyKeyMaps(anchor);
  const white = WHITE_KEY_ROW.map(key => ({ key, ...maps.white[key] }));
  const black: Array<{ key: string; note: string; octave: number; leftIdx: number }> = [];
  BLACK_KEY_ROW.forEach((key, i) => {
    const info = maps.black[key];
    if (info) black.push({ key, ...info, leftIdx: i - 1 });
  });
  return { white, black };
}

// ── Pitch utilities for custom-range keyboards ────────────────────────────────

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]); // pitch classes for C D E F G A B

function _noteToMidi(note: string, octave: number): number {
  const pc = (PITCH_CLASSES as readonly string[]).indexOf(note);
  if (pc === -1) throw new Error(`qwerty-abc-piano: unknown note "${note}"`);
  return (octave + 1) * 12 + pc;
}

/**
 * Parses a pitch string like "C4", "F#3", "A#5" into {note, octave}.
 * Returns null if the string is not a recognised pitch string.
 * Used by the touch handler to resolve range-keyboard data-key values.
 */
export function parsePitchString(s: string): { note: string; octave: number } | null {
  const m = s.match(/^([A-G]#?)(\d)$/);
  if (!m) return null;
  return { note: m[1], octave: parseInt(m[2], 10) };
}

/** Converts a MIDI note number to a pitch string like "C4" or "F#3". */
export function midiToNoteString(midi: number): string {
  return `${PITCH_CLASSES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

interface RangeLayout {
  whiteKeys: Array<{ dataKey: string; note: string; octave: number; idx: number }>;
  blackKeys: Array<{ dataKey: string; note: string; octave: number; leftIdx: number }>;
  viewBoxW: number;
}

function _computeRangeLayout(lowMidi: number, highMidi: number): RangeLayout {
  const whiteKeys: RangeLayout['whiteKeys'] = [];
  const blackKeys: RangeLayout['blackKeys'] = [];
  const midiToWhiteIdx = new Map<number, number>();

  for (let midi = lowMidi; midi <= highMidi; midi++) {
    const pc = midi % 12;
    if (WHITE_PC.has(pc)) {
      const idx    = whiteKeys.length;
      const octave = Math.floor(midi / 12) - 1;
      const note   = PITCH_CLASSES[pc];
      midiToWhiteIdx.set(midi, idx);
      whiteKeys.push({ dataKey: `${note}${octave}`, note, octave, idx });
    }
  }

  for (let midi = lowMidi; midi <= highMidi; midi++) {
    const pc = midi % 12;
    if (!WHITE_PC.has(pc)) {
      const leftIdx = midiToWhiteIdx.get(midi - 1);
      if (leftIdx === undefined) continue; // left white key not in range — skip this black key
      const octave = Math.floor(midi / 12) - 1;
      const note   = PITCH_CLASSES[pc];
      blackKeys.push({ dataKey: `${note}${octave}`, note, octave, leftIdx });
    }
  }

  return {
    whiteKeys,
    blackKeys,
    viewBoxW: 2 * MARGIN_L + whiteKeys.length * WHITE_STRIDE,
  };
}

/** Minimal interface the piano keyboard needs from the host instance. */
export interface PianoHost {
  getMode(): Mode;
  getOctave(): number;
  setOctave(shift: number): void;
  /** The QWERTY layout anchor. Default `'E3'`. */
  getQwertyAnchor?(): QwertyAnchor;
  /** The key-label style. Default `'auto'`. */
  getNoteLabels?(): NoteLabels;
}

// ── CSS injection (once per document) ────────────────────────────────────────

const STYLE_ID = 'qwerty-abc-piano-svg-styles';

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    'svg.qap-piano rect.qap-key-white{fill:white;stroke:#bbb;stroke-width:1;cursor:pointer}',
    'svg.qap-piano rect.qap-key-black{fill:#2c2c2c;stroke:#111;stroke-width:1;cursor:pointer}',
    'svg.qap-piano rect.qap-key-white.active{fill:var(--qwerty-abc-piano-transcribe-color,#5b9bd5)}',
    'svg.qap-piano[data-mode="play"] rect.qap-key-white.active{fill:var(--qwerty-abc-piano-play-color,#d97c3a)}',
    'svg.qap-piano rect.qap-key-black.active{fill:var(--qwerty-abc-piano-transcribe-color,#3a6ea0)}',
    'svg.qap-piano[data-mode="play"] rect.qap-key-black.active{fill:var(--qwerty-abc-piano-play-color,#a85f25)}',
    'svg.qap-piano text.qap-key-qwerty{font:bold 11px monospace;fill:#555;text-anchor:middle;pointer-events:none;user-select:none}',
    'svg.qap-piano text.qap-key-qwerty-black{fill:#bbb}',
    'svg.qap-piano text.qap-note-name{font:9px sans-serif;fill:#999;text-anchor:middle;pointer-events:none;user-select:none}',
    'svg.qap-piano text.qap-note-name-black{fill:#bbb;font:8px sans-serif}',
    'svg.qap-piano .qap-oct-pos{cursor:pointer}',
    'svg.qap-piano circle.qap-oct-hit{fill:transparent;stroke:none}',
    'svg.qap-piano .qap-oct-map{pointer-events:none}',
    'svg.qap-piano rect.qap-oct-map-key{fill:#fff;stroke:#ccc;stroke-width:0.5}',
    'svg.qap-piano rect.qap-oct-map-window{fill:var(--qwerty-abc-piano-transcribe-color,#5b9bd5);fill-opacity:0.35;stroke:var(--qwerty-abc-piano-transcribe-color,#5b9bd5);stroke-width:1}',
    'svg.qap-piano[data-mode="play"] rect.qap-oct-map-window{fill:var(--qwerty-abc-piano-play-color,#d97c3a);stroke:var(--qwerty-abc-piano-play-color,#d97c3a)}',
    'svg.qap-piano line.qap-oct-map-middle-c{stroke:#d05c54;stroke-width:1.5}',
    'svg.qap-piano text.qap-oct-map-label{font:8px sans-serif;fill:#999;text-anchor:middle;user-select:none}',
    'svg.qap-piano circle.qap-oct-indicator{fill:none;stroke:#ccc;stroke-width:1.5}',
    'svg.qap-piano .qap-oct-pos.active circle.qap-oct-indicator{fill:var(--qwerty-abc-piano-transcribe-color,#5b9bd5);stroke:var(--qwerty-abc-piano-transcribe-color,#5b9bd5)}',
    'svg.qap-piano[data-mode="play"] .qap-oct-pos.active circle.qap-oct-indicator{fill:var(--qwerty-abc-piano-play-color,#d97c3a);stroke:var(--qwerty-abc-piano-play-color,#d97c3a)}',
    'svg.qap-piano text.qap-oct-label{font:11px monospace;fill:#888;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    'svg.qap-piano .qap-oct-pos.active text.qap-oct-label{fill:white}',
  ].join('');
  document.head?.appendChild(s);
}

// ── SVG element factory ───────────────────────────────────────────────────────

function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Number of white keys in [MAP_LOW_MIDI, midi) — the strip's x index for `midi`. */
function _mapWhiteIndex(midi: number): number {
  let n = 0;
  for (let m = MAP_LOW_MIDI; m < midi; m++) if (WHITE_PC.has(m % 12)) n++;
  return n;
}

/** x position (left edge) of the strip key for `midi`, relative to the strip's origin. */
function _mapX(midi: number): number {
  return _mapWhiteIndex(Math.max(MAP_LOW_MIDI, Math.min(MAP_HIGH_MIDI + 1, midi))) * MAP_STRIDE;
}

/**
 * Builds the octave mini-map: a white-key strip spanning C2–B6 with a middle-C
 * tick and a translucent window over the currently-playable range, so the user
 * can see which octave they are in (the ± dots alone only show the shift).
 *
 * The base range is stored on the group as data attributes so
 * {@link updateOctaveIndicator} can move the window knowing only the new shift.
 */
function _renderOctaveMiniMap(
  originX: number,
  baseLowMidi: number,
  baseHighMidi: number,
  shift: number,
): SVGElement {
  const g = svgEl('g', {
    class: 'qap-oct-map',
    'data-base-low': String(baseLowMidi),
    'data-base-high': String(baseHighMidi),
  });
  const y = OCT_Y - MAP_H / 2;

  for (let m = MAP_LOW_MIDI; m <= MAP_HIGH_MIDI; m++) {
    if (!WHITE_PC.has(m % 12)) continue;
    g.appendChild(svgEl('rect', {
      class: 'qap-oct-map-key',
      x: originX + _mapX(m), y, width: MAP_STRIDE, height: MAP_H,
    }));
  }

  const middleC = originX + _mapX(60);
  g.appendChild(svgEl('line', {
    class: 'qap-oct-map-middle-c',
    x1: middleC, y1: y - 3, x2: middleC, y2: y + MAP_H + 3,
  }));
  const cLabel = svgEl('text', {
    class: 'qap-oct-map-label', x: middleC, y: y + MAP_H + 12,
  });
  cLabel.textContent = 'C4';
  g.appendChild(cLabel);

  const window = svgEl('rect', {
    class: 'qap-oct-map-window',
    x: originX + _mapX(baseLowMidi + 12 * shift), y: y - 1,
    width: _mapX(baseHighMidi + 12 * shift + 1) - _mapX(baseLowMidi + 12 * shift),
    height: MAP_H + 2, rx: 2,
    'data-origin-x': String(originX),
  });
  g.appendChild(window);
  return g;
}

function octaveLabel(shift: number, isActive: boolean): string {
  if (isActive) return '●';
  return shift > 0 ? `+${shift}` : String(shift);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Renders the SVG piano keyboard into `target` and returns the SVG element.
 *
 * If `target` already contains an `<svg>` with `data-key` attributes (custom
 * piano SVG), skips rendering and returns the existing element unchanged.
 *
 * Pass `range` to render a custom pitch range instead of the QWERTY layout
 * (E3–A4 by default, or C4–F5 when the host's anchor is `'C4'`). Range keys use pitch-string `data-key` values (e.g. "C4",
 * "F#3") and show note names rather than QWERTY labels.
 *
 * @throws Error if `range.low` or `range.high` is not a pitch string like "C4".
 */
export function renderPiano(
  target: Element,
  host: PianoHost,
  range?: { low: string; high: string },
): SVGSVGElement {
  const existing = target.querySelector('svg');
  if (existing?.querySelector('[data-key]')) return existing as SVGSVGElement;

  ensureStyles();

  // ── Determine layout ──────────────────────────────────────────────────────
  const anchor = host.getQwertyAnchor?.() ?? 'E3';
  const labels = host.getNoteLabels?.() ?? 'auto';
  const shift  = host.getOctave();
  let viewBoxW: number;
  let renderWhiteKeys: Array<{ dataKey: string; note: string; octave: number; idx: number; qKey?: string }>;
  let renderBlackKeys: Array<{ dataKey: string; note: string; octave: number; leftIdx: number; qKey?: string }>;
  let baseLowMidi = 0;
  let baseHighMidi = 0;

  if (range) {
    const lo = parsePitchString(range.low);
    const hi = parsePitchString(range.high);
    if (!lo || !hi) throw new Error(`qwerty-abc-piano: invalid range "${range.low}"–"${range.high}"`);
    const layout = _computeRangeLayout(_noteToMidi(lo.note, lo.octave), _noteToMidi(hi.note, hi.octave));
    viewBoxW        = layout.viewBoxW;
    renderWhiteKeys = layout.whiteKeys;
    renderBlackKeys = layout.blackKeys;
  } else {
    viewBoxW = 700;
    const layout = _qwertyLayout(anchor);
    renderWhiteKeys = layout.white.map((k, i) => ({
      dataKey: k.key, note: k.note, octave: k.octave, idx: i, qKey: k.key,
    }));
    renderBlackKeys = layout.black.map(k => ({
      dataKey: k.key, note: k.note, octave: k.octave, leftIdx: k.leftIdx, qKey: k.key,
    }));
    const first = layout.white[0];
    const last  = layout.white[layout.white.length - 1];
    baseLowMidi  = noteToMidi(first.note, first.octave);
    baseHighMidi = noteToMidi(last.note, last.octave);
  }

  // Octaves on the QWERTY layout move with the shift; range keys are absolute.
  const octaveOf = (k: { octave: number }): number => range ? k.octave : k.octave + shift;

  const svg = svgEl('svg', {
    class: 'qap-piano',
    viewBox: `0 0 ${viewBoxW} ${range ? VIEWBOX_H_RANGE : VIEWBOX_H}`,
    width: '100%',
    'data-mode': host.getMode(),
    'data-note-labels': labels,
  }) as SVGSVGElement;

  // ── White keys ────────────────────────────────────────────────────────────
  for (const k of renderWhiteKeys) {
    const x  = MARGIN_L + k.idx * WHITE_STRIDE;
    const cx = x + WHITE_W / 2;

    svg.appendChild(svgEl('rect', {
      class: 'qap-key-white',
      x, y: KEY_Y, width: WHITE_W, height: WHITE_H, rx: 3,
      'data-key': k.dataKey, 'data-note': k.note,
    }));

    if (k.qKey) {
      const lbl = svgEl('text', { class: 'qap-key-qwerty', x: cx, y: KEY_Y + WHITE_H - 14 });
      lbl.textContent = k.qKey;
      svg.appendChild(lbl);
    }

    // Below the key: the letter; with 'scientific' the full pitch (C4, D4…);
    // with 'auto' on a range keyboard, each C carries its octave for orientation.
    const noteLabel = svgEl('text', {
      class: 'qap-note-name', x: cx, y: KEY_Y + WHITE_H + 11, 'data-for': k.dataKey,
    });
    if (labels === 'scientific') noteLabel.textContent = `${k.note}${octaveOf(k)}`;
    else if (labels === 'auto' && range && k.note === 'C') noteLabel.textContent = `C${k.octave}`;
    else noteLabel.textContent = k.note;
    svg.appendChild(noteLabel);
  }

  // ── Black keys ────────────────────────────────────────────────────────────
  for (const k of renderBlackKeys) {
    const cx = MARGIN_L + (k.leftIdx + 1) * WHITE_STRIDE;
    const x  = cx - BLACK_W / 2;

    svg.appendChild(svgEl('rect', {
      class: 'qap-key-black',
      x, y: KEY_Y, width: BLACK_W, height: BLACK_H, rx: 2,
      'data-key': k.dataKey, 'data-note': k.note,
    }));

    if (k.qKey) {
      const lbl = svgEl('text', { class: 'qap-key-qwerty qap-key-qwerty-black', x: cx, y: KEY_Y + BLACK_H - 10 });
      lbl.textContent = k.qKey;
      svg.appendChild(lbl);
      // Scientific labels add the pitch above the QWERTY letter.
      if (labels === 'scientific') {
        const name = svgEl('text', {
          class: 'qap-note-name qap-note-name-black', x: cx, y: KEY_Y + BLACK_H - 26, 'data-for': k.dataKey,
        });
        name.textContent = `${k.note}${octaveOf(k)}`;
        svg.appendChild(name);
      }
    } else {
      // Range keyboard: show note name on black keys (no QWERTY label available)
      const lbl = svgEl('text', {
        class: 'qap-note-name qap-note-name-black', x: cx, y: KEY_Y + BLACK_H - 10, 'data-for': k.dataKey,
      });
      lbl.textContent = labels === 'scientific' ? `${k.note}${k.octave}` : k.note;
      svg.appendChild(lbl);
    }
  }

  // ── Octave indicator row (centered on viewBox width) ──────────────────────
  // Range keyboards carry absolute pitch labels ("C4"), and the ±2 octave SHIFT
  // does not apply to them (it would make every key label wrong). Their octave
  // is chosen by changing the range itself, so the dot row is omitted entirely
  // rather than rendered as a dead control.
  if (!range) {
    const octCenterX   = viewBoxW / 2;
    const currentOctave = host.getOctave();
    for (let s = -2; s <= 2; s++) {
      const cx      = octCenterX + s * OCT_SPACING;
      const isActive = s === currentOctave;
      const g = svgEl('g', {
        class: isActive ? 'qap-oct-pos active' : 'qap-oct-pos',
        'data-shift': String(s),
      });
      const shift = s;
      g.addEventListener('click', () => host.setOctave(shift));
      // Invisible 44px-wide hit circle first, so it sits UNDER the visible dot
      // and gives the ~24px dot a touch-sized target.
      g.appendChild(svgEl('circle', { class: 'qap-oct-hit', cx, cy: OCT_Y, r: OCT_HIT_R }));
      g.appendChild(svgEl('circle', { class: 'qap-oct-indicator', cx, cy: OCT_Y, r: OCT_R }));
      const label = svgEl('text', { class: 'qap-oct-label', x: cx, y: OCT_Y });
      label.textContent = octaveLabel(s, isActive);
      g.appendChild(label);
      svg.appendChild(g);
    }

    svg.appendChild(_renderOctaveMiniMap(
      octCenterX + 3 * OCT_SPACING,
      baseLowMidi,
      baseHighMidi,
      currentOctave,
    ));
  }

  target.innerHTML = '';
  target.appendChild(svg);
  return svg as SVGSVGElement;
}

/**
 * Adds the `active` CSS class to the key rect whose `data-key` is `key` (a
 * QWERTY key, or a pitch string such as "C4" on a range keyboard).
 */
export function highlightKey(target: Element, key: string): void {
  target.querySelector(`svg.qap-piano [data-key="${key}"]`)?.classList.add('active');
}

/**
 * Removes the `active` CSS class from the key rect whose `data-key` is `key`.
 */
export function unhighlightKey(target: Element, key: string): void {
  target.querySelector(`svg.qap-piano [data-key="${key}"]`)?.classList.remove('active');
}

/**
 * Moves the octave indicator (●) to the position matching `shift`
 * and updates labels on all positions.
 */
export function updateOctaveIndicator(target: Element, shift: number): void {
  const svg = target.querySelector('svg.qap-piano');
  if (!svg) return;
  for (const pos of svg.querySelectorAll<SVGElement>('.qap-oct-pos')) {
    const s        = parseInt(pos.getAttribute('data-shift') ?? '0', 10);
    const isActive = s === shift;
    pos.classList.toggle('active', isActive);
    const label = pos.querySelector('text');
    if (label) label.textContent = octaveLabel(s, isActive);
  }

  // Move the mini-map window with the shift.
  const map = svg.querySelector<SVGElement>('.qap-oct-map');
  const win = map?.querySelector<SVGElement>('rect.qap-oct-map-window');
  if (!map || !win) return;
  const baseLow  = parseInt(map.getAttribute('data-base-low')  ?? '0', 10);
  const baseHigh = parseInt(map.getAttribute('data-base-high') ?? '0', 10);
  const originX  = parseFloat(win.getAttribute('data-origin-x') ?? '0');
  const lowX = _mapX(baseLow + 12 * shift);
  win.setAttribute('x', String(originX + lowX));
  win.setAttribute('width', String(_mapX(baseHigh + 12 * shift + 1) - lowX));
}

/**
 * Updates the piano SVG's `data-mode` attribute so active-key CSS color
 * variables apply correctly for the current mode.
 */
export function updatePianoMode(target: Element, mode: Mode): void {
  target.querySelector('svg.qap-piano')?.setAttribute('data-mode', mode);
}

/**
 * Rewrites the scientific pitch labels after an octave shift. Only labels in
 * `'scientific'` style name an octave that moves with the shift; other styles
 * are left alone.
 *
 * @param pitchOf - Maps a key's `data-key` to its current pitch string.
 */
export function updateNoteLabels(target: Element, pitchOf: (dataKey: string) => string | null): void {
  const svg = target.querySelector('svg.qap-piano');
  if (!svg || svg.getAttribute('data-note-labels') !== 'scientific') return;
  for (const t of svg.querySelectorAll<SVGElement>('text.qap-note-name[data-for]')) {
    const pitch = pitchOf(t.getAttribute('data-for') ?? '');
    if (pitch) t.textContent = pitch;
  }
}

/** The CSS class each {@link KeyMark} state puts on a key. */
const MARK_CLASSES: Record<KeyMark, string> = {
  correct: 'qap-mark-correct',
  wrong:   'qap-mark-wrong',
  missed:  'qap-mark-missed',
};

/**
 * Applies the persistent key states to every key of the drawn piano: greyed
 * (`qap-key-disabled`, for a pitch outside `allowed`), highlighted
 * (`qap-key-highlight`) and marked (`qap-mark-correct` / `-wrong` /
 * `-missed`). These are independent of the transient pressed `active` class.
 *
 * @param midiOf - Maps a key's `data-key` to its current MIDI note number.
 * @returns The MIDI note numbers of the keys that are drawn.
 */
export function applyKeyStates(
  target: Element,
  midiOf: (dataKey: string) => number | null,
  state: {
    allowed: ReadonlySet<number> | null;
    highlight: ReadonlySet<number>;
    marks: ReadonlyMap<number, KeyMark>;
  },
): Set<number> {
  const drawn = new Set<number>();
  const svg = target.querySelector('svg');
  if (!svg) return drawn;
  for (const key of svg.querySelectorAll<SVGElement>('[data-key]')) {
    const midi = midiOf(key.getAttribute('data-key') ?? '');
    if (midi === null) continue;
    drawn.add(midi);
    key.classList.toggle('qap-key-disabled', state.allowed !== null && !state.allowed.has(midi));
    key.classList.toggle('qap-key-highlight', state.highlight.has(midi));
    const mark = state.marks.get(midi);
    for (const [m, cls] of Object.entries(MARK_CLASSES)) key.classList.toggle(cls, mark === m);
  }
  return drawn;
}
