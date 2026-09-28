import type { Duration } from './types.js';

export type NoteInfo = {
  note: string;    // base note name, e.g. 'C', 'F#', 'G#'
  octave: number;
};

// White keys: home row A S D F G H J K L ; '
// At the default octave shift (0), H is middle C (C4) and the row spans E3–A4.
// The octaves listed here are for shift 0; the current shift is added on top.
export const WHITE_KEYS: Record<string, NoteInfo> = {
  'a':  { note: 'E', octave: 3 },
  's':  { note: 'F', octave: 3 },
  'd':  { note: 'G', octave: 3 },
  'f':  { note: 'A', octave: 3 },
  'g':  { note: 'B', octave: 3 },
  'h':  { note: 'C', octave: 4 },
  'j':  { note: 'D', octave: 4 },
  'k':  { note: 'E', octave: 4 },
  'l':  { note: 'F', octave: 4 },
  ';':  { note: 'G', octave: 4 },
  "'":  { note: 'A', octave: 4 },
};

// Black keys: QWERTY row Q W E R T Y U I O P [
// Each black key sits one QWERTY position to the RIGHT of the white key it
// follows, matching the physical stagger of a real keyboard (the home row is
// shifted right of the top row), so a black key visually lands between its two
// white neighbours. null = gap (no black key at this piano position).
// Q, W: gap before/at the low-E side (no black key)
// Y: gap for the B3–C4 interval (B and C are a natural half step)
// O: gap for the E4–F4 interval (E and F are a natural half step)
export const BLACK_KEYS: Record<string, NoteInfo | null> = {
  'q': null,
  'w': null,
  'e': { note: 'F#', octave: 3 },
  'r': { note: 'G#', octave: 3 },
  't': { note: 'A#', octave: 3 },
  'y': null,
  'u': { note: 'C#', octave: 4 },
  'i': { note: 'D#', octave: 4 },
  'o': null,
  'p': { note: 'F#', octave: 4 },
  '[': { note: 'G#', octave: 4 },
};

// Duration → ABC note-length suffix, assuming header L:1/4 (quarter note = default unit)
export const DURATION_MAP: Record<Duration, string> = {
  'w': '4',    // whole note:         4 quarter-note units
  'h': '2',    // half note:          2 quarter-note units
  'q': '',     // quarter note:       1 unit (no suffix needed)
  'e': '/2',   // eighth note:        1/2 unit
  's': '/4',   // sixteenth note:     1/4 unit
  't': '/8',   // thirty-second note: 1/8 unit
};

// Dotted duration → ABC length suffix (each entry is duration × 3/2)
export const DOTTED_DURATION_MAP: Record<Duration, string> = {
  'w': '6',     // dotted whole:         6 units
  'h': '3',     // dotted half:          3 units
  'q': '3/2',   // dotted quarter:       3/2 units
  'e': '3/4',   // dotted eighth:        3/4 units
  's': '3/8',   // dotted sixteenth:     3/8 units
  't': '3/16',  // dotted thirty-second: 3/16 units
};

// Duration → beat count in quarter-note units (for auto-barline tracking)
export const DURATION_BEATS: Record<Duration, number> = {
  'w': 4,
  'h': 2,
  'q': 1,
  'e': 0.5,
  's': 0.25,
  't': 0.125,
};

// All keys that can produce a note (white + black, including gap keys)
export const NOTE_KEYS: Set<string> = new Set([
  ...Object.keys(WHITE_KEYS),
  ...Object.keys(BLACK_KEYS),
]);

// Non-note control keys
export const CONTROL_KEYS: Set<string> = new Set([
  ' ',         // toggle mode
  '+',         // octave up
  '-',         // octave down
  '0',         // reset octave
  'Backspace', // undo
  '\\',        // manual barline
  'Enter',     // playback
  'Escape',    // clear
  '1', '2', '3', '4', '5', '6',  // duration selectors
  '.',         // dot toggle
  'z',         // rest
  '(',         // open simultaneous chord ('[' is the G#4 key, so it can't be used)
  ')',         // commit simultaneous chord
]);

// ── Enharmonic respelling tables ─────────────────────────────────────────────

/**
 * Maps a sharp note name to the letter of its flat enharmonic equivalent.
 * Used to detect when a black key should be spelled as a flat in the ABC output
 * (e.g. A# → 'B' because Bb's letter is B).
 */
export const SHARP_TO_FLAT_LETTER: Record<string, string> = {
  'F#': 'G',  // F# = Gb
  'C#': 'D',  // C# = Db
  'G#': 'A',  // G# = Ab
  'D#': 'E',  // D# = Eb
  'A#': 'B',  // A# = Bb
};

/**
 * How a note name is *shown to a reader*: a black key carries BOTH of its
 * standard spellings, sharp first — 'G#' → 'G#/Ab', 'A#' → 'A#/Bb'. Naturals
 * are returned unchanged.
 *
 * A readout is a live echo of what was played, with no key or chord context of
 * its own, so it cannot know which spelling the user means; asserting the sharp
 * looks wrong whenever the material is flat-spelled (playing Fdim7 and being
 * told 'G#' rather than 'Ab'). Display only: the internal note name and
 * everything derived from it (ABC output, undo) are untouched.
 *
 * @example
 * enharmonicDisplayName('G#'); // 'G#/Ab'
 * enharmonicDisplayName('E');  // 'E'
 */
export function enharmonicDisplayName(note: string): string {
  const flatLetter = SHARP_TO_FLAT_LETTER[note];
  return flatLetter === undefined ? note : `${note}/${flatLetter}b`;
}

/**
 * Maps a note letter to the sharp note name of its enharmonic equivalent
 * when that letter is flattened (e.g. 'B' → 'A#' because Bb = A#).
 * Used when parsing ABC flat tokens back into our internal note representation.
 */
export const FLAT_TO_SHARP_NOTE: Record<string, string> = {
  'B': 'A#',  // Bb = A#
  'E': 'D#',  // Eb = D#
  'A': 'G#',  // Ab = G#
  'D': 'C#',  // Db = C#
  'G': 'F#',  // Gb = F#
  'C': 'B',   // Cb = B natural
  'F': 'E',   // Fb = E natural
};

// ── Key-signature accidental lookup ──────────────────────────────────────────
// Sharp key signatures: maps note letters sharpened in each major key.
// Order follows the circle of fifths (F C G D A E B).
const KS_SHARPS: Record<string, readonly string[]> = {
  'C':  [],
  'G':  ['F'],
  'D':  ['F', 'C'],
  'A':  ['F', 'C', 'G'],
  'E':  ['F', 'C', 'G', 'D'],
  'B':  ['F', 'C', 'G', 'D', 'A'],
  'F#': ['F', 'C', 'G', 'D', 'A', 'E'],
  'C#': ['F', 'C', 'G', 'D', 'A', 'E', 'B'],
};

// Flat key signatures: maps note letters flattened in each major key.
// Order follows the circle of fifths (B E A D G C F).
const KS_FLATS: Record<string, readonly string[]> = {
  'F':  ['B'],
  'Bb': ['B', 'E'],
  'Eb': ['B', 'E', 'A'],
  'Ab': ['B', 'E', 'A', 'D'],
  'Db': ['B', 'E', 'A', 'D', 'G'],
  'Gb': ['B', 'E', 'A', 'D', 'G', 'C'],
  'Cb': ['B', 'E', 'A', 'D', 'G', 'C', 'F'],
};

// Minor key → relative major (shares the same key signature)
const MINOR_TO_MAJOR: Record<string, string> = {
  'Am': 'C',  'Em': 'G',  'Bm': 'D',  'F#m': 'A', 'C#m': 'E', 'G#m': 'B', 'D#m': 'F#', 'A#m': 'C#',
  'Dm': 'F',  'Gm': 'Bb', 'Cm': 'Eb', 'Fm':  'Ab','Bbm': 'Db','Ebm': 'Gb','Abm': 'Cb',
};

function resolveToMajor(keySignature: string): string {
  // Strip verbose suffixes ('maj', 'min' → '' or 'm')
  const normalized = keySignature.replace(/maj$/i, '').replace(/min$/i, 'm');
  return MINOR_TO_MAJOR[normalized] ?? normalized;
}

/**
 * Returns the set of note letters (e.g. 'F', 'C') that are sharpened by
 * the given key signature. Returns an empty set for unrecognised keys.
 */
export function getKeyImpliedSharps(keySignature: string): ReadonlySet<string> {
  return new Set(KS_SHARPS[resolveToMajor(keySignature)] ?? []);
}

/**
 * Returns the set of note letters (e.g. 'B', 'E') that are flattened by
 * the given key signature. Returns an empty set for unrecognised keys.
 */
export function getKeyImpliedFlats(keySignature: string): ReadonlySet<string> {
  return new Set(KS_FLATS[resolveToMajor(keySignature)] ?? []);
}

// ── MIDI note number conversion ───────────────────────────────────────────────

const MIDI_PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Converts a MIDI note number to a {note, octave} pair.
 * MIDI note 60 = C4 (middle C), written `C` in ABC. Octave follows scientific
 * pitch notation. Black keys are returned as sharps (61 → C#4).
 */
export function midiNoteToNoteInfo(noteNumber: number): { note: string; octave: number } {
  return {
    note:   MIDI_PITCH_CLASSES[noteNumber % 12],
    octave: Math.floor(noteNumber / 12) - 1,
  };
}
