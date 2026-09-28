import { describe, it, expect, vi } from 'vitest';
import { QWERTYToABCPiano } from '../src/QWERTYToABCPiano.js';

// Helper: bypass private access to add a note
function addNote(inst: QWERTYToABCPiano, note: string, octave: number) {
  const absoluteOctave = octave + ((inst as any)._octaveShift as number);
  (inst as any)._addNote(note, absoluteOctave);
}

// Helper: set internal duration/dotted state before adding a note
function setState(
  inst: QWERTYToABCPiano,
  opts: { duration?: string; isDotted?: boolean; octaveShift?: number },
) {
  if (opts.duration    !== undefined) (inst as any)._duration    = opts.duration;
  if (opts.isDotted    !== undefined) (inst as any)._isDotted    = opts.isDotted;
  if (opts.octaveShift !== undefined) (inst as any)._octaveShift = opts.octaveShift;
}

// Convenience: new instance with autoBarline disabled (most note-conversion tests)
function noBarline(extra = {}) {
  return new QWERTYToABCPiano({ autoBarline: false, ...extra });
}

// ── _noteToABC (tested via getABC) ──────────────────────────────────────────

describe('note → ABC octave encoding', () => {
  it('octave 4 → uppercase, no modifier (middle C)', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe('C');
  });

  it('octave 5 → lowercase, no modifier', () => {
    const inst = noBarline();
    addNote(inst, 'C', 5);
    expect(inst.getABC()).toBe("c");
  });

  it('octave 6 → lowercase + one apostrophe', () => {
    const inst = noBarline();
    addNote(inst, 'C', 6);
    expect(inst.getABC()).toBe("c'");
  });

  it('octave 3 → uppercase + one comma', () => {
    const inst = noBarline();
    addNote(inst, 'C', 3);
    expect(inst.getABC()).toBe('C,');
  });

  it('octave 2 → uppercase + two commas', () => {
    const inst = noBarline();
    addNote(inst, 'C', 2);
    expect(inst.getABC()).toBe('C,,');
  });

  it('octave 1 → uppercase + three commas', () => {
    const inst = noBarline();
    addNote(inst, 'C', 1);
    expect(inst.getABC()).toBe('C,,,');
  });
});

describe('note → ABC octave shift applied at record time', () => {
  it('+1 octave shift raises C4 to C5', () => {
    const inst = noBarline();
    setState(inst, { octaveShift: 1 });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe("c");
  });

  it('-1 octave shift lowers C4 to C3', () => {
    const inst = noBarline();
    setState(inst, { octaveShift: -1 });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe('C,');
  });
});

describe('note → ABC accidentals (inherent sharps in C major)', () => {
  it('inherent sharp (black key) → ^ prefix in C major', () => {
    const inst = noBarline();
    addNote(inst, 'F#', 3);
    expect(inst.getABC()).toBe('^F,');
  });

  it('G# in C major → ^G,', () => {
    const inst = noBarline();
    addNote(inst, 'G#', 3);
    expect(inst.getABC()).toBe('^G,');
  });

  it('A# in C major → ^A,', () => {
    const inst = noBarline();
    addNote(inst, 'A#', 3);
    expect(inst.getABC()).toBe('^A,');
  });
});

describe('note → ABC durations', () => {
  it.each([
    ['w', 'C4'],
    ['h', 'C2'],
    ['q', 'C'],
    ['e', 'C/2'],
    ['s', 'C/4'],
    ['t', 'C/8'],
  ])('duration %s → %s', (dur, expected) => {
    const inst = noBarline();
    setState(inst, { duration: dur });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe(expected);
  });
});

describe('note → ABC dotted durations', () => {
  it.each([
    ['w', 'C6'],
    ['h', 'C3'],
    ['q', 'C3/2'],
    ['e', 'C3/4'],
    ['s', 'C3/8'],
    ['t', 'C3/16'],
  ])('dotted %s → %s', (dur, expected) => {
    const inst = noBarline();
    setState(inst, { duration: dur, isDotted: true });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe(expected);
  });
});

// ── getABC / getFullABC ─────────────────────────────────────────────────────

describe('getABC', () => {
  it('returns empty string when no notes', () => {
    expect(noBarline().getABC()).toBe('');
  });

  it('returns a single note', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe('C');
  });

  it('joins multiple notes without spaces (enables beaming)', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    expect(inst.getABC()).toBe('CDE');
  });

  it('includes barlines with trailing space', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    (inst as any)._insertManualBarline();
    addNote(inst, 'D', 4);
    expect(inst.getABC()).toBe('C| D');
  });
});

describe('getFullABC', () => {
  it('includes all required ABC headers', () => {
    const inst = noBarline();
    const full = inst.getFullABC();
    expect(full).toContain('X:1');
    expect(full).toContain('M:4/4');
    expect(full).toContain('L:1/4');
    expect(full).toContain('K:C');
  });

  it('uses the provided title', () => {
    const inst = noBarline();
    expect(inst.getFullABC({ title: 'My Tune' })).toContain('T:My Tune');
  });

  it('defaults title to "Transcription"', () => {
    expect(noBarline().getFullABC()).toContain('T:Transcription');
  });

  it('reflects keySignature and timeSignature', () => {
    const inst = noBarline({ keySignature: 'G', timeSignature: '3/4' });
    const full = inst.getFullABC();
    expect(full).toContain('K:G');
    expect(full).toContain('M:3/4');
  });
});

// ── undo ───────────────────────────────────────────────────────────────────

describe('undo', () => {
  it('does nothing when no notes', () => {
    const inst = noBarline();
    inst.undo();
    expect(inst.getABC()).toBe('');
  });

  it('removes the last note', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    inst.undo();
    expect(inst.getABC()).toBe('C');
  });

  it('removes the last barline', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    (inst as any)._insertManualBarline();
    inst.undo();
    expect(inst.getABC()).toBe('C');
  });

  it('recalculates beat position after undoing a note', () => {
    const inst = new QWERTYToABCPiano({ autoBarline: true, timeSignature: '4/4' });
    setState(inst, { duration: 'q' });
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    // 3 beats in, no barline yet
    inst.undo();
    // 2 beats in; adding 2 more should NOT yet trigger barline
    addNote(inst, 'E', 4);
    addNote(inst, 'F', 4);
    // 4 beats → barline after F
    expect(inst.getABC()).toBe('CDEF|');
  });
});

// ── clear ──────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('removes all notes', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    inst.clear();
    expect(inst.getABC()).toBe('');
  });

  it('resets beat position', () => {
    const inst = new QWERTYToABCPiano({ autoBarline: true, timeSignature: '4/4' });
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    inst.clear();
    // After clear, adding 4 notes should produce exactly one barline
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    addNote(inst, 'F', 4);
    expect(inst.getABC()).toBe('CDEF|');
  });
});

// ── setMode / getMode / lockMode ───────────────────────────────────────────

describe('setMode / getMode', () => {
  it('defaults to transcribe mode', () => {
    expect(noBarline().getMode()).toBe('transcribe');
  });

  it('sets mode to play', () => {
    const inst = noBarline();
    inst.setMode('play');
    expect(inst.getMode()).toBe('play');
  });

  it('does not change mode when lockMode is true', () => {
    const inst = noBarline({ defaultMode: 'play', lockMode: true });
    inst.setMode('transcribe');
    expect(inst.getMode()).toBe('play');
  });
});

// ── setOctave / getOctave ──────────────────────────────────────────────────

describe('setOctave', () => {
  it('sets and retrieves octave shift', () => {
    const inst = noBarline();
    inst.setOctave(1);
    expect(inst.getOctave()).toBe(1);
  });

  it('clamps to +2', () => {
    const inst = noBarline();
    inst.setOctave(5);
    expect(inst.getOctave()).toBe(2);
  });

  it('clamps to -2', () => {
    const inst = noBarline();
    inst.setOctave(-5);
    expect(inst.getOctave()).toBe(-2);
  });
});

// ── setKeySignature / setTimeSignature ────────────────────────────────────

describe('setKeySignature', () => {
  it('is reflected in getFullABC', () => {
    const inst = noBarline();
    inst.setKeySignature('D');
    expect(inst.getFullABC()).toContain('K:D');
  });
});

describe('setTimeSignature', () => {
  it('is reflected in getFullABC', () => {
    const inst = noBarline();
    inst.setTimeSignature('3/4');
    expect(inst.getFullABC()).toContain('M:3/4');
  });

  it('throws on a malformed time signature', () => {
    const inst = noBarline();
    expect(() => inst.setTimeSignature('wat')).toThrow();
  });
});

// ── auto-barline ───────────────────────────────────────────────────────────

describe('auto-barline', () => {
  it('inserts barline after 4 quarter notes in 4/4', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '4/4' });
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    addNote(inst, 'F', 4);
    expect(inst.getABC()).toBe('CDEF|');
  });

  it('inserts barline after 3 quarter notes in 3/4', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '3/4' });
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    expect(inst.getABC()).toBe('CDE|');
  });

  it('inserts barline after half note + 2 quarter notes in 4/4', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '4/4' });
    setState(inst, { duration: 'h' });
    addNote(inst, 'C', 4);
    setState(inst, { duration: 'q' });
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    expect(inst.getABC()).toBe('C2DE|');
  });

  it('handles pickup measure of 1 beat', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '4/4', pickupBeats: 1 });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe('C|');
  });

  it('pre-inserts barline when note would overflow the measure', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '4/4' });
    // Fill 3 beats
    addNote(inst, 'A', 4); addNote(inst, 'B', 4); addNote(inst, 'C', 5);
    // Half note (2 beats) would overflow → barline inserted before it
    setState(inst, { duration: 'h' });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe("ABc| C2");
  });

  it('does not insert barlines when autoBarline is false', () => {
    const inst = new QWERTYToABCPiano({ autoBarline: false });
    for (let i = 0; i < 8; i++) addNote(inst, 'C', 4);
    expect(inst.getABC()).not.toContain('|');
  });
});

// ── rests ──────────────────────────────────────────────────────────────────

function addRest(inst: QWERTYToABCPiano) {
  (inst as any)._addRest();
}

describe('rests', () => {
  it('quarter rest → z', () => {
    const inst = noBarline();
    addRest(inst);
    expect(inst.getABC()).toBe('z');
  });

  it('half rest → z2', () => {
    const inst = noBarline();
    setState(inst, { duration: 'h' });
    addRest(inst);
    expect(inst.getABC()).toBe('z2');
  });

  it('whole rest → z4', () => {
    const inst = noBarline();
    setState(inst, { duration: 'w' });
    addRest(inst);
    expect(inst.getABC()).toBe('z4');
  });

  it('eighth rest → z/2', () => {
    const inst = noBarline();
    setState(inst, { duration: 'e' });
    addRest(inst);
    expect(inst.getABC()).toBe('z/2');
  });

  it('dotted quarter rest → z3/2', () => {
    const inst = noBarline();
    setState(inst, { duration: 'q', isDotted: true });
    addRest(inst);
    expect(inst.getABC()).toBe('z3/2');
  });

  it('rest mixes with notes in getABC', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    addRest(inst);
    addNote(inst, 'D', 4);
    expect(inst.getABC()).toBe('CzD');
  });

  it('rest counts toward beat position for auto-barline', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '4/4' });
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    addRest(inst); // 4 beats total → barline after rest
    expect(inst.getABC()).toBe('CDEz|');
  });

  it('undo removes a rest', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    addRest(inst);
    inst.undo();
    expect(inst.getABC()).toBe('C');
  });

  it('undo rest fires onNoteDeleted', () => {
    const onNoteDeleted = vi.fn();
    const inst = noBarline({ onNoteDeleted });
    addRest(inst);
    inst.undo();
    expect(onNoteDeleted).toHaveBeenCalled();
  });

  it('setABC roundtrips a rest', () => {
    const inst = noBarline();
    inst.setABC('c z d');
    expect(inst.getABC()).toBe('c z d');
  });

  it('setABC roundtrips a half rest', () => {
    const inst = noBarline();
    inst.setABC('z2');
    expect(inst.getABC()).toBe('z2');
  });
});

// ── key-signature-aware rendering ─────────────────────────────────────────

describe('key-signature-aware rendering', () => {
  it('F# in G major is rendered as F (no ^ prefix)', () => {
    const inst = noBarline({ keySignature: 'G' });
    addNote(inst, 'F#', 3);
    expect(inst.getABC()).toBe('F,');
  });

  it('F# in D major is rendered as F', () => {
    const inst = noBarline({ keySignature: 'D' });
    addNote(inst, 'F#', 3);
    expect(inst.getABC()).toBe('F,');
  });

  it('C# in D major is rendered as C (no ^ prefix)', () => {
    const inst = noBarline({ keySignature: 'D' });
    addNote(inst, 'C#', 4);
    expect(inst.getABC()).toBe('C');
  });

  it('F# in C major still gets ^ (not in key sig)', () => {
    const inst = noBarline({ keySignature: 'C' });
    addNote(inst, 'F#', 3);
    expect(inst.getABC()).toBe('^F,');
  });

  it('C# in G major still gets ^ (C# not in G major)', () => {
    const inst = noBarline({ keySignature: 'G' });
    addNote(inst, 'C#', 4);
    expect(inst.getABC()).toBe('^C');
  });

  it('C# (black key) in G major → ^C (C# not in G major key sig)', () => {
    const inst = noBarline({ keySignature: 'G' });
    addNote(inst, 'C#', 4);
    expect(inst.getABC()).toBe('^C');
  });

  it('F natural (white key) in G major → =F (natural overrides key sig)', () => {
    const inst = noBarline({ keySignature: 'G' });
    addNote(inst, 'F', 3);
    expect(inst.getABC()).toBe('=F,');
  });

  it('C natural (white key) in D major → =C (natural overrides key sig)', () => {
    const inst = noBarline({ keySignature: 'D' });
    addNote(inst, 'C', 4);
    expect(inst.getABC()).toBe('=C');
  });

  // ── Flat key signature respelling ─────────────────────────────────────────

  it('A# in Bb major → B (enharmonic respelling, key sig implies Bb)', () => {
    const inst = noBarline({ keySignature: 'Bb' });
    addNote(inst, 'A#', 3);
    expect(inst.getABC()).toBe('B,');
  });

  it('D# in Bb major → E (D# = Eb, key sig implies Eb)', () => {
    const inst = noBarline({ keySignature: 'Bb' });
    addNote(inst, 'D#', 4);
    expect(inst.getABC()).toBe('E');
  });

  it('B natural (white key) in Bb major → =B (natural overrides key sig)', () => {
    const inst = noBarline({ keySignature: 'Bb' });
    addNote(inst, 'B', 3);
    expect(inst.getABC()).toBe('=B,');
  });

  it('D# in Eb major → E (D# = Eb; Eb major flattens E)', () => {
    const inst = noBarline({ keySignature: 'Eb' });
    addNote(inst, 'D#', 4);
    expect(inst.getABC()).toBe('E');
  });

  it('G# in Ab major → A (G# = Ab, key sig implies Ab)', () => {
    const inst = noBarline({ keySignature: 'Ab' });
    addNote(inst, 'G#', 4);
    expect(inst.getABC()).toBe('A');
  });

  it('Em (relative minor of G) also suppresses ^ on F#', () => {
    const inst = noBarline({ keySignature: 'Em' });
    addNote(inst, 'F#', 3);
    expect(inst.getABC()).toBe('F,');
  });

  it('rendering updates dynamically when key signature changes', () => {
    const inst = noBarline({ keySignature: 'C' });
    addNote(inst, 'F#', 3);
    expect(inst.getABC()).toBe('^F,'); // C major: explicit sharp needed
    inst.setKeySignature('G');
    expect(inst.getABC()).toBe('F,');  // G major: sharp implied
  });
});

// ── setABC roundtrip ───────────────────────────────────────────────────────

describe('setABC', () => {
  it('roundtrips a simple generated string', () => {
    const inst = new QWERTYToABCPiano({ timeSignature: '4/4' });
    addNote(inst, 'C', 4);
    addNote(inst, 'D', 4);
    addNote(inst, 'E', 4);
    addNote(inst, 'F', 4);
    const abc = inst.getABC(); // 'CDEF|'
    inst.setABC(abc);
    expect(inst.getABC()).toBe(abc);
  });

  it('parses a barline and preserves spacing', () => {
    const inst = noBarline();
    inst.setABC('c | d');
    expect(inst.getABC()).toBe('c | d');
  });

  it('clears existing notes before loading', () => {
    const inst = noBarline();
    addNote(inst, 'C', 4);
    inst.setABC('d');
    expect(inst.getABC()).toBe('d');
  });
});

// ── callbacks ──────────────────────────────────────────────────────────────

describe('callbacks', () => {
  it('fires onChange when a note is added', () => {
    const onChange = vi.fn();
    const inst = noBarline({ onChange });
    addNote(inst, 'C', 4);
    expect(onChange).toHaveBeenCalledWith('C');
  });

  it('fires onNoteAdded with the ABC string and last note', () => {
    const onNoteAdded = vi.fn();
    const inst = noBarline({ onNoteAdded });
    addNote(inst, 'C', 4);
    expect(onNoteAdded).toHaveBeenCalledWith('C', 'C');
  });

  it('fires onChange when clear() is called', () => {
    const onChange = vi.fn();
    const inst = noBarline({ onChange });
    addNote(inst, 'C', 4);
    onChange.mockClear();
    inst.clear();
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('fires onModeChange when mode changes', () => {
    const onModeChange = vi.fn();
    const inst = noBarline({ onModeChange });
    inst.setMode('play');
    expect(onModeChange).toHaveBeenCalledWith('play');
  });

  it('fires onNoteDeleted when undo removes a note', () => {
    const onNoteDeleted = vi.fn();
    const inst = noBarline({ onNoteDeleted });
    addNote(inst, 'C', 4);
    inst.undo();
    expect(onNoteDeleted).toHaveBeenCalled();
  });

  it('does not fire onNoteDeleted when undo removes a barline', () => {
    const onNoteDeleted = vi.fn();
    const inst = noBarline({ onNoteDeleted });
    (inst as any)._insertManualBarline();
    inst.undo();
    expect(onNoteDeleted).not.toHaveBeenCalled();
  });
});
