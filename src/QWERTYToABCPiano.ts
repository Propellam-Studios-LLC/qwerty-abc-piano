import { type Duration, type Mode, type NoteEntry, type QWERTYToABCOptions, type MIDIAccess, type MIDIInput, type MIDIMessageEvent, type AbcjsSynthController, type MidiEnableResult } from './types.js';
import { DURATION_MAP, DOTTED_DURATION_MAP, DURATION_BEATS, WHITE_KEYS, BLACK_KEYS, NOTE_KEYS, getKeyImpliedSharps, getKeyImpliedFlats, SHARP_TO_FLAT_LETTER, FLAT_TO_SHARP_NOTE, midiNoteToNoteInfo } from './keymap.js';
import { renderDurationButtons, updateDurationButtons } from './ui/durationButtons.js';
import { renderModeToggle, updateModeToggle } from './ui/modeToggle.js';
import { renderPiano, highlightKey, unhighlightKey, updateOctaveIndicator, updatePianoMode, parsePitchString } from './ui/piano.js';
import { renderTapButton } from './ui/tapButton.js';
import { resolveTarget } from './ui/utils.js';
import { injectStylesInto } from './domStyles.js';

const DEFAULTS = {
  defaultDuration:  'q' as Duration,
  defaultMode:      'transcribe' as Mode,
  lockMode:         false,
  timeSignature:    '4/4',
  keySignature:     'C',
  clef:             'treble',
  autoBarline:      true,
  pickupBeats:      0,
  notationTheme:    'black' as 'default' | 'black',
} as const;

const LIB_STYLE_ID = 'qwerty-abc-piano-lib-styles';

// ── Raw ABC passthrough ────────────────────────────────────────────────────
// Characters that, when typed in transcribe mode, open a raw-ABC capture
// instead of being ignored. '|' and ':' begin a barline/repeat/volta token;
// '!', '"', '{' begin a self-closing decoration / chord-symbol / grace token.
// None of these collide with the piano's note or control keys.
const RAW_OPENERS: Record<string, string | null> = {
  '|': null,   // barline family — flushes on a non-barline boundary key
  ':': null,   // repeat end (':|') / double repeat ('::')
  '!': '!',    // decoration  '!trill!'
  '"': '"',    // chord symbol '"Gm"'
  '{': '}',    // grace notes  '{gc}'
};
// While in a barline-family capture, these characters extend the token; any
// other key is the flush boundary. Covers | : and volta digits / brackets.
const RAW_BAR_CHARS = new Set(['|', ':', '[', ']', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);

/**
 * A piano that writes ABC notation. It listens to the computer keyboard (and,
 * optionally, touch on the rendered piano and Web MIDI input) and builds an
 * ABC tune body note by note, with durations, rests, dots, triplets, chords,
 * automatic barlines and raw ABC passthrough.
 *
 * Pitches follow standard ABC 2.1: uppercase `C` is middle C (C4, MIDI 60),
 * lowercase `c` is C5, each `'` raises and each `,` lowers an octave. With no
 * octave shift the QWERTY row spans E3–A4, with H on middle C; `octaveShift`
 * (or {@link setOctave}) moves that starting octave.
 *
 * Every UI piece is optional: pass a target element for the piano, duration
 * buttons, mode toggle, notation panel or playback transport to have the
 * instance render it. For a complete ready-made instrument, see `mountFullUI`.
 * Call {@link destroy} when you are done, to remove the document keyboard
 * listeners.
 *
 * @example
 * ```ts
 * import { QWERTYToABCPiano } from 'qwerty-abc-piano';
 *
 * const piano = new QWERTYToABCPiano({
 *   onChange: (abc) => console.log(abc),
 * });
 * // The user types H J K L → piano.getABC() === 'CDEF|'
 * piano.destroy();
 * ```
 */
export class QWERTYToABCPiano {
  // Mutable state
  private _mode: Mode;
  private _duration: Duration;
  private _isDotted = false;
  private _restMode = false;
  private _octaveShift = 0;
  private _notes: NoteEntry[] = [];
  private _displayListener: (() => void) | null = null;
  private _teardowns: Array<() => void> = [];
  private _beatPosition = 0;
  private _pickupComplete: boolean;
  private _tupletRemaining = 0;
  private _tupletCount = 0;

  // Raw ABC passthrough capture state. `_rawBuffer` holds the token being typed
  // ('' = not capturing). `_rawClose` is the delimiter that ends a self-closing
  // token ('!', '"', '}') or null for the barline/repeat/volta family (which
  // flushes when a non-barline key is pressed). `_rawValid` mirrors the last
  // validation result for the live indicator.
  private _rawBuffer = '';
  private _rawClose: string | null = null;
  private _rawValid = true;

  // Simultaneous (chord) mode state
  private _simultaneousActive = false;
  private _simultaneousBuffer: Array<{ note: string; octave: number }> = [];
  private _simultaneousBufferDuration: Duration = 'q';
  private _simultaneousBufferDotted  = false;

  // Touch state
  private readonly _activeTouches = new Map<number, string>(); // touchId → data-key
  private _boundTouchStart?: (e: TouchEvent) => void;
  private _boundTouchEnd?:   (e: TouchEvent) => void;
  private _boundTouchCancel?: (e: TouchEvent) => void;

  // Settings (mutable via public methods)
  private _keySignature: string;
  private _clef: string;
  private _timeSignature: string;
  private _beatsPerMeasure: number;
  private _barlineMode: 'auto' | 'manual' | 'none';
  private _measuresPerLine: number;
  private _pickupBeats: number;
  private _lockMode: boolean;
  // Piano label visibility — kept here (not only on the SVG) so a re-render
  // (setTouchKeyRange: 8ve shift, range steppers, resize) preserves it.
  private _showKeyLabels: boolean;
  private _showNoteNames: boolean;

  /** Playback tempo in quarter-note BPM, or null for "no Q: header at all".
   *  Written into the header by {@link _abcHeader}, which is what actually
   *  decides playback speed: abcjs's SynthController derives its tempo from the
   *  tune's own `Q:` (`go()` reads `visualObj.millisecondsPerMeasure()`). */
  private _tempoBpm: number | null;

  // Percussion mode — fixed pitch B4 ('B' in ABC notation, drawn on the line
  // of the one-line percussion staff); only rhythm matters
  private _percussionMode: boolean;
  private static readonly PERCUSSION_NOTE   = 'B';
  private static readonly PERCUSSION_OCTAVE = 4;  // B4 = 'B' in ABC (the treble staff's middle line; snare convention)

  // Selection state
  private _selectedIndex: number | null = null;
  private _lastTuneObject: unknown = null;

  // Playback via SynthController
  private _synthController: AbcjsSynthController | null = null;
  private _prevCursorGroups: HTMLElement[][] = [];

  // Bound handler refs — stored so they can be removed in destroy()
  private readonly _boundKeyDown: (e: KeyboardEvent) => void;
  private readonly _boundKeyUp:   (e: KeyboardEvent) => void;

  // Lifecycle
  private _destroyed = false;
  private _warnedNoSynth = false;

  // MIDI state
  private _midiAccess: MIDIAccess | null = null;
  private readonly _midiHandlers = new Map<MIDIInput, (e: MIDIMessageEvent) => void>();

  // Resolved UI targets (null when not provided)
  private readonly _durationTarget: Element | null;
  private readonly _modeTarget: Element | null;
  private readonly _pianoTarget: Element | null;
  private readonly _notationTarget: Element | null;
  private readonly _playbackTarget: Element | null;
  private readonly _tupletTarget: Element | null;
  private readonly _simultaneousTarget: Element | null;

  // Stored options with defaults applied (callbacks, UI targets, abcjs hooks)
  private readonly _options: Required<QWERTYToABCOptions>;

  /**
   * Creates a piano and starts listening for keyboard input on `document`
   * immediately. Every option is optional; any UI target given (as an element
   * or a CSS selector) is rendered into straight away, and the notation panel
   * is drawn once abcjs is supplied.
   *
   * @param options - Settings, UI targets, abcjs hooks and callbacks; see
   *   {@link QWERTYToABCOptions}.
   * @throws Error if `timeSignature` is not of the form `N/M`.
   *
   * @example
   * ```ts
   * const piano = new QWERTYToABCPiano({
   *   abcjs: ABCJS,
   *   notationTarget: '#notation',
   *   pianoTarget: '#piano',
   *   keySignature: 'G',
   *   onChange: (abc) => save(abc),
   * });
   * ```
   */
  constructor(options: QWERTYToABCOptions = {}) {
    this._options = {
      defaultDuration:    options.defaultDuration    ?? DEFAULTS.defaultDuration,
      defaultMode:        options.defaultMode        ?? DEFAULTS.defaultMode,
      lockMode:           options.lockMode           ?? DEFAULTS.lockMode,
      timeSignature:      options.timeSignature      ?? DEFAULTS.timeSignature,
      keySignature:       options.keySignature       ?? DEFAULTS.keySignature,
      clef:               options.clef               ?? DEFAULTS.clef,
      autoBarline:        options.autoBarline        ?? DEFAULTS.autoBarline,
      pickupBeats:        options.pickupBeats        ?? DEFAULTS.pickupBeats,
      pianoTarget:        options.pianoTarget        ?? null,
      durationTarget:     options.durationTarget     ?? null,
      modeTarget:         options.modeTarget         ?? null,
      notationTarget:     options.notationTarget     ?? null,
      playbackTarget:     options.playbackTarget     ?? null,
      tupletTarget:       options.tupletTarget       ?? null,
      abcjs:              options.abcjs              ?? null,
      abcjsRenderOptions: options.abcjsRenderOptions ?? {},
      abcjsAudioContext:  options.abcjsAudioContext  ?? null,
      synthOptions:       options.synthOptions       ?? {},
      tempoBpm:           options.tempoBpm           ?? null,
      enableMidi:         options.enableMidi         ?? false,
      notationTheme:      options.notationTheme      ?? DEFAULTS.notationTheme,
      barlineMode:        options.barlineMode        ?? 'auto',
      onNoteAdded:        options.onNoteAdded        ?? null,
      onNoteDeleted:      options.onNoteDeleted      ?? null,
      onModeChange:       options.onModeChange       ?? null,
      onBarlineInserted:  options.onBarlineInserted  ?? null,
      onChange:           options.onChange           ?? null,
      onPlayback:         options.onPlayback         ?? null,
      onClearRequested:   options.onClearRequested   ?? null,
      onSelectionChange:  options.onSelectionChange  ?? null,
      onMeasureOverflow:  options.onMeasureOverflow  ?? null,
      onTupletChange:         options.onTupletChange         ?? null,
      onRawChange:            options.onRawChange            ?? null,
      onMidiStateChange:      options.onMidiStateChange      ?? null,
      measuresPerLine:        options.measuresPerLine        ?? 4,
      simultaneousTarget:     options.simultaneousTarget     ?? null,
      onSimultaneousChange:   options.onSimultaneousChange   ?? null,
      enableTouch:            options.enableTouch            ?? true,
      touchGlide:             options.touchGlide             ?? false,
      showKeyLabels:          options.showKeyLabels          ?? true,
      showNoteNames:          options.showNoteNames          ?? true,
      percussionMode:         options.percussionMode         ?? false,
      octaveShift:        options.octaveShift        ?? 0,
    };
    // The starting octave shift (clamped to −2…+2, like setOctave). A host whose
    // material sits higher or lower than the default E3–A4 keyboard (e.g. fiddle
    // tunes around C5) can start the keys an octave up with `octaveShift: 1`.
    this._octaveShift = Math.max(-2, Math.min(2, Math.round(options.octaveShift ?? 0)));

    this._mode            = this._options.defaultMode;
    this._duration        = this._options.defaultDuration;
    this._lockMode        = this._options.lockMode;
    this._keySignature    = this._options.keySignature;
    this._clef            = this._options.clef;
    this._timeSignature   = this._options.timeSignature;
    this._beatsPerMeasure = this._parseTimeSignature(this._timeSignature);
    // barlineMode takes priority; otherwise the autoBarline boolean decides
    this._barlineMode     = options.barlineMode ?? (options.autoBarline === false ? 'manual' : 'auto');
    this._measuresPerLine  = this._options.measuresPerLine;
    this._pickupBeats      = this._options.pickupBeats;
    this._pickupComplete   = this._pickupBeats === 0;
    this._percussionMode   = this._options.percussionMode;
    this._tempoBpm         = this._options.tempoBpm;
    this._showKeyLabels    = this._options.showKeyLabels;
    this._showNoteNames    = this._options.showNoteNames;

    // Resolve UI targets and render components
    this._durationTarget = resolveTarget(this._options.durationTarget);
    if (this._durationTarget) renderDurationButtons(this._durationTarget, this);

    this._modeTarget = resolveTarget(this._options.modeTarget);
    if (this._modeTarget) {
      if (this._percussionMode) {
        (this._modeTarget as HTMLElement).style.display = 'none';
      } else {
        renderModeToggle(this._modeTarget, this);
      }
    }

    this._pianoTarget = resolveTarget(this._options.pianoTarget);
    if (this._pianoTarget) {
      if (this._percussionMode) {
        renderTapButton(this._pianoTarget, this);
      } else {
        renderPiano(this._pianoTarget, this);
        this._applyLabelVisibility();
      }
    }

    this._notationTarget      = resolveTarget(this._options.notationTarget);
    this._playbackTarget      = resolveTarget(this._options.playbackTarget);
    this._tupletTarget        = resolveTarget(this._options.tupletTarget);
    this._simultaneousTarget  = resolveTarget(this._options.simultaneousTarget);

    // Initialize SynthController for play/pause/restart UI if a target and abcjs are provided
    const { abcjs } = this._options;
    if (this._playbackTarget && abcjs?.synth?.SynthController) {
      this._synthController = new (abcjs.synth.SynthController as new () => AbcjsSynthController)();
      this._synthController.load(this._playbackTarget, {
        onEvent: (event) => {
          for (const g of this._prevCursorGroups) for (const el of g) el.classList.remove('qap-cursor');
          this._prevCursorGroups = event?.elements ?? [];
          for (const g of this._prevCursorGroups) for (const el of g) el.classList.add('qap-cursor');
        },
        onFinished: () => {
          for (const g of this._prevCursorGroups) for (const el of g) el.classList.remove('qap-cursor');
          this._prevCursorGroups = [];
        },
      }, {
        displayLoop: false,
        displayRestart: true,
        displayPlay: true,
        displayProgress: true,
      });
    }

    // Attach keyboard listeners (removed in destroy())
    this._boundKeyDown = this._onKeyDown.bind(this);
    this._boundKeyUp   = this._onKeyUp.bind(this);
    document.addEventListener('keydown', this._boundKeyDown);
    document.addEventListener('keyup',   this._boundKeyUp);

    if (this._options.enableMidi) void this._initMidi(true);

    // Touch support for piano keys (skipped in percussion mode — tap button handles its own touch)
    if (this._pianoTarget && !this._percussionMode && this._options.enableTouch !== false) {
      this._attachTouchListeners(this._pianoTarget);
    }

    // Render initial triplet button state if a tuplet target was provided
    if (this._tupletTarget) {
      this._fireTupletChange(false, 0);
    }

    this._injectLibStyles();
    this._renderNotation();
  }

  // ── Private: time signature ──────────────────────────────────────────────

  private _parseTimeSignature(ts: string): number {
    const parts = ts.split('/');
    if (parts.length !== 2) throw new Error(`Invalid time signature: "${ts}"`);
    const numer = parseInt(parts[0], 10);
    const denom = parseInt(parts[1], 10);
    if (isNaN(numer) || isNaN(denom) || denom === 0) {
      throw new Error(`Invalid time signature: "${ts}"`);
    }
    // Convert to quarter-note units: (N/M) × 4
    return (numer / denom) * 4;
  }

  // ── Private: ABC note conversion ─────────────────────────────────────────

  /**
   * ABC for one note.
   *
   * `bar` is the accidental state of the current bar: for each letter and
   * octave written with an explicit accidental earlier in the bar, the
   * alteration it set (+1 sharp, -1 flat, 0 natural). ABC accidentals last
   * to the end of the bar for notes of the same letter and octave, so a note
   * needs its own accidental whenever its pitch differs from what the key
   * signature and that state imply (after `^d`, a D natural in the same bar
   * must be written `=d`). Pass the same map for every note of a bar, and a
   * new one after each barline; without it, the note is spelled against the
   * key signature alone.
   */
  private _noteToABC(note: string, octave: number, duration: Duration, isDotted: boolean,
                     bar?: Map<string, number>): string {
    const baseLetter        = note[0];
    const hasInherentSharp  = note.length === 2 && note[1] === '#';
    const keySharps         = getKeyImpliedSharps(this._keySignature);
    const keyFlats          = getKeyImpliedFlats(this._keySignature);

    // The letter to write and the alteration the pitch needs on it.
    let outputLetter: string;
    let alter: number;
    if (hasInherentSharp) {
      // Black key: a flat spelling when the key signature implies it
      // (A# in Bb major is written as B, i.e. Bb), otherwise a sharp.
      const enharmonicLetter = SHARP_TO_FLAT_LETTER[note];
      if (enharmonicLetter && keyFlats.has(enharmonicLetter)) {
        outputLetter = enharmonicLetter;
        alter = -1;
      } else {
        outputLetter = baseLetter;
        alter = 1;
      }
    } else {
      outputLetter = baseLetter;
      alter = 0;
    }

    // What the letter sounds like without an accidental here: the bar's
    // earlier accidental on this letter and octave, else the key signature.
    const keyAlter = keySharps.has(outputLetter) ? 1 : keyFlats.has(outputLetter) ? -1 : 0;
    const slot = `${outputLetter}${octave}`;
    const implied = bar?.has(slot) ? bar.get(slot)! : keyAlter;
    let prefix = '';
    if (alter !== implied) {
      prefix = alter === 1 ? '^' : alter === -1 ? '_' : '=';
      bar?.set(slot, alter);
    }

    // ABC octave encoding, standard ABC 2.1 (and abcjs): `C` is middle C (C4,
    // MIDI 60), `c` is C5, each `'` raises and each `,` lowers an octave.
    let abcLetter: string;
    if (octave >= 5) {
      abcLetter = outputLetter.toLowerCase() + "'".repeat(octave - 5);
    } else if (octave === 4) {
      abcLetter = outputLetter.toUpperCase();
    } else {
      abcLetter = outputLetter.toUpperCase() + ','.repeat(4 - octave);
    }

    const suffix = isDotted ? DOTTED_DURATION_MAP[duration] : DURATION_MAP[duration];
    return `${prefix}${abcLetter}${suffix}`;
  }

  // ── Private: beat tracking ───────────────────────────────────────────────

  private _beatsForDuration(duration: Duration, isDotted: boolean): number {
    return DURATION_BEATS[duration] * (isDotted ? 1.5 : 1);
  }

  private _getMeasureTarget(): number {
    return !this._pickupComplete && this._pickupBeats > 0
      ? this._pickupBeats
      : this._beatsPerMeasure;
  }

  private _getEffectiveBeats(duration: Duration, isDotted: boolean): number {
    const raw = this._beatsForDuration(duration, isDotted);
    if (this._tupletRemaining > 0 && this._tupletCount > 0) {
      return raw * (this._tupletCount - 1) / this._tupletCount;
    }
    return raw;
  }

  private _fireTupletChange(active: boolean, remaining: number): void {
    this._options.onTupletChange?.(active, remaining);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('qwerty-abc-piano:tuplet-change', {
        detail: { active, remaining },
      }));
    }
    if (!this._tupletTarget) return;
    // Render or update the triplet toggle button
    let btn = this._tupletTarget.querySelector<HTMLButtonElement>('.qap-triplet-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qap-triplet-btn';
      btn.addEventListener('click', () => {
        if (this._tupletRemaining === 0) {
          this.startTriplet();
        } else if (this._tupletRemaining === this._tupletCount) {
          this.cancelTriplet();
        }
        // mid-triplet: button is disabled, click is no-op
      });
      this._tupletTarget.innerHTML = '';
      this._tupletTarget.appendChild(btn);
    }
    if (active) {
      btn.textContent = `TRIPLET (${remaining} left)`;
      btn.disabled    = remaining < this._tupletCount; // disable mid-triplet
    } else {
      btn.textContent = 'TRIPLET (Q)';
      btn.disabled    = false;
    }
  }

  private _fireSimultaneousChange(active: boolean, noteCount: number): void {
    this._options.onSimultaneousChange?.(active, noteCount);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('qwerty-abc-piano:simultaneous-change', {
        detail: { active, noteCount },
      }));
    }
    if (this._simultaneousTarget) {
      this._simultaneousTarget.textContent = active ? `CHORD (${noteCount} notes)` : '';
    }
  }

  private _openSimultaneous(): void {
    if (this._simultaneousActive) return;
    this._simultaneousActive         = true;
    this._simultaneousBuffer         = [];
    this._simultaneousBufferDuration = this._duration;
    this._simultaneousBufferDotted   = this._isDotted;
    this._fireSimultaneousChange(true, 0);
    if (this._pianoTarget) this._pianoTarget.querySelector('svg')?.classList.add('qap-simultaneous-active');
  }

  private _commitSimultaneous(): void {
    if (!this._simultaneousActive) return;
    this._simultaneousActive = false;
    if (this._pianoTarget) this._pianoTarget.querySelector('svg')?.classList.remove('qap-simultaneous-active');
    if (this._simultaneousBuffer.length === 0) {
      this._fireSimultaneousChange(false, 0);
      return;
    }
    const entry: Extract<NoteEntry, { type: 'simultaneous' }> = {
      type:     'simultaneous',
      notes:    [...this._simultaneousBuffer],
      duration: this._simultaneousBufferDuration,
      isDotted: this._simultaneousBufferDotted,
    };
    this._simultaneousBuffer = [];

    const beats = this._getEffectiveBeats(entry.duration, entry.isDotted);

    if (this._barlineMode === 'auto' && this._beatPosition > 0) {
      const preTarget = this._getMeasureTarget();
      if (this._beatPosition + beats > preTarget) {
        this._notes.push({ type: 'barline' });
        this._beatPosition   = 0;
        this._pickupComplete = true;
        this._fireEvent('barline');
      }
    }

    this._notes.push(entry);
    this._beatPosition += beats;

    if (this._barlineMode === 'auto') {
      const postTarget = this._getMeasureTarget();
      if (this._beatPosition >= postTarget) {
        this._notes.push({ type: 'barline' });
        this._beatPosition   = Math.max(0, this._beatPosition - postTarget);
        this._pickupComplete = true;
        this._fireEvent('barline');
      }
    }

    this._fireSimultaneousChange(false, 0);
    this._fireEvent('change');
  }

  private _cancelSimultaneous(): void {
    this._simultaneousActive = false;
    this._simultaneousBuffer = [];
    if (this._pianoTarget) this._pianoTarget.querySelector('svg')?.classList.remove('qap-simultaneous-active');
    this._fireSimultaneousChange(false, 0);
    this._renderNotation(); // drop the in-progress chord from the preview
  }

  private _attachTouchListeners(pianoTarget: Element): void {
    const svg = pianoTarget.querySelector('svg.qap-piano');
    if (!svg) return;

    this._boundTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const el    = document.elementFromPoint(touch.clientX, touch.clientY);

        // Octave dots first: this handler preventDefault()s every touchstart
        // on the SVG, which suppresses the synthesized click the dots' mouse
        // listener relies on, so a tap on a dot has to be handled here.
        const octPos = el?.closest('.qap-oct-pos');
        if (octPos) {
          this.setOctave(parseInt(octPos.getAttribute('data-shift') ?? '0', 10));
          continue;
        }

        const key = el?.closest('[data-key]')?.getAttribute('data-key');
        if (!key) continue;
        this._activeTouches.set(touch.identifier, key);

        // If this is the second+ finger and we're NOT already in sim mode, open it
        if (this._activeTouches.size === 2 && !this._simultaneousActive && this._mode === 'transcribe') {
          this._openSimultaneous();
        }

        const white = WHITE_KEYS[key];
        const black = white ? null : BLACK_KEYS[key];
        const qwertyInfo = white ?? black;
        if (qwertyInfo) {
          // QWERTY keys are relative to the layout's home octave — the ± shift
          // is what moves them.
          this._handleNoteFromPitch(qwertyInfo.note, qwertyInfo.octave + this._octaveShift);
          if (this._pianoTarget) highlightKey(this._pianoTarget, key);
          continue;
        }
        // Pitch-string keys (e.g. "C4", "F#3") on a custom-range touch keyboard
        // are ABSOLUTE: the key is labelled with its own pitch, so the octave
        // shift is not added (otherwise the key labelled C4 would emit C5).
        const pitchInfo = parsePitchString(key);
        if (pitchInfo) {
          this._handleNoteFromPitch(pitchInfo.note, pitchInfo.octave);
          if (this._pianoTarget) highlightKey(this._pianoTarget, key);
        }
      }
    };

    this._boundTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const id  = e.changedTouches[i].identifier;
        const key = this._activeTouches.get(id);
        if (key) {
          if (this._pianoTarget) unhighlightKey(this._pianoTarget, key);
          this._activeTouches.delete(id);
        }
      }
      if (this._activeTouches.size === 0 && this._simultaneousActive) {
        this._commitSimultaneous();
      }
    };

    this._boundTouchCancel = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const id  = e.changedTouches[i].identifier;
        const key = this._activeTouches.get(id);
        if (key) {
          if (this._pianoTarget) unhighlightKey(this._pianoTarget, key);
          this._activeTouches.delete(id);
        }
      }
      if (this._simultaneousActive) this._cancelSimultaneous();
    };

    svg.addEventListener('touchstart',  this._boundTouchStart  as EventListener, { passive: false });
    svg.addEventListener('touchend',    this._boundTouchEnd    as EventListener, { passive: false });
    svg.addEventListener('touchcancel', this._boundTouchCancel as EventListener, { passive: false });
  }

  private _recalcBeatPosition(): void {
    let pos = 0;
    let barlineSeen = false;
    let tupletCount = 0;
    let tupletRemaining = 0;
    for (const entry of this._notes) {
      if (entry.type === 'barline') {
        pos = 0;
        barlineSeen = true;
      } else if (entry.type === 'raw') {
        // A raw barline-family token resets the measure the same way a plain
        // barline does; decorations / chord symbols carry no duration.
        if (entry.text.includes('|')) { pos = 0; barlineSeen = true; }
      } else if (entry.type === 'tuplet-start') {
        tupletCount = entry.count;
        tupletRemaining = entry.count;
      } else if (entry.type === 'note' || entry.type === 'rest') {
        const raw = this._beatsForDuration(entry.duration, entry.isDotted);
        if (tupletRemaining > 0) {
          pos += raw * (tupletCount - 1) / tupletCount;
          tupletRemaining--;
        } else {
          pos += raw;
        }
      } else if (entry.type === 'simultaneous') {
        const raw = this._beatsForDuration(entry.duration, entry.isDotted);
        if (tupletRemaining > 0) {
          pos += raw * (tupletCount - 1) / tupletCount;
          tupletRemaining--;
        } else {
          pos += raw;
        }
      }
      // space: no-op
    }
    this._beatPosition    = pos;
    this._pickupComplete  = barlineSeen || this._pickupBeats === 0;
    this._tupletRemaining = tupletRemaining;
    this._tupletCount     = tupletCount;
  }

  // ── Private: style injection ─────────────────────────────────────────────

  private _injectLibStyles(): void {
    const refEl =
      this._pianoTarget ?? this._notationTarget ?? this._playbackTarget;
    injectStylesInto(refEl, LIB_STYLE_ID, [
      // abcjs sets fill="currentColor" on the root <svg>; white background keeps it readable on any page
      '.qap-notation { background: #fff; border-radius: 4px; padding: 4px; }',
      '.qap-notation svg { color: #000 !important; }',
      // Selected note: blue highlight on all child SVG elements of the note group
      '.qap-selected * { fill: #1a5fb4 !important; stroke: #1a5fb4 !important; }',
      // Playback cursor: red highlight
      '.qap-cursor * { fill: #c01c28 !important; stroke: #c01c28 !important; }',
      // Simultaneous (chord) mode active: green keys
      'svg.qap-piano.qap-simultaneous-active rect.qap-key-white { fill: var(--qwerty-abc-piano-sim-color, #4caf50); }',
      'svg.qap-piano.qap-simultaneous-active rect.qap-key-black { fill: var(--qwerty-abc-piano-sim-color-dark, #388e3c); }',
      // A key pressed *while building a chord* still flashes a distinct colour so
      // each note registers visually. Higher specificity (`.active` added) than the
      // green chord-mode fill above, and placed after it, so the flash wins.
      'svg.qap-piano.qap-simultaneous-active rect.qap-key-white.active { fill: var(--qwerty-abc-piano-sim-flash, #1a5fb4); }',
      'svg.qap-piano.qap-simultaneous-active rect.qap-key-black.active { fill: var(--qwerty-abc-piano-sim-flash-dark, #114a8a); }',
      // Touch support
      'svg.qap-piano { touch-action: none; user-select: none; -webkit-user-select: none; }',
      // ── Control button base ───────────────────────────────────────────────
      '.qwerty-abc-dur-btn, .qwerty-abc-mode-btn, .qap-triplet-btn, .qap-adv-toggle {',
      '  font-family: inherit; cursor: pointer; border: 1px solid #bbb; border-radius: 4px;',
      // Explicit dark text so the label stays legible on the light button
      // background even when the host page sets a light-on-dark text colour.
      // (Active/mode variants below re-set colour to #fff on their darker fills.)
      '  color: #333; background: #f5f5f5; transition: background 0.12s, border-color 0.12s, color 0.12s; }',
      // Duration buttons: stacked icon + key-number + label layout
      // align-items:stretch ensures every button in the row is the same height.
      '.qwerty-abc-duration-buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: stretch; }',
      '.qwerty-abc-dur-btn { display: inline-flex; flex-direction: column; align-items: center;',
      '  justify-content: center; gap: 2px; padding: 0.3rem 0.5rem; min-width: 3rem; }',
      '.qwerty-abc-dur-icon { display: block; width: auto; height: 1.6em; }',
      '.qwerty-abc-dur-btn:hover:not(:disabled) { background: #e8f0fe; border-color: #6b9bd5; }',
      '.qwerty-abc-dur-btn.active { background: #1a5fb4; color: #fff; border-color: #1a5fb4; }',
      '.qwerty-abc-dur-key { font-size: 0.65rem; font-weight: 700; font-family: monospace;',
      '  opacity: 0.55; line-height: 1; }',
      '.qwerty-abc-dur-btn.active .qwerty-abc-dur-key { opacity: 0.85; }',
      '.qwerty-abc-dur-label { font-size: 0.75rem; line-height: 1; }',
      // Mode toggle: coloured by mode via CSS custom properties
      '.qwerty-abc-mode-btn { padding: 0.3rem 0.85rem; font-size: 0.8rem; font-weight: 600; }',
      '.qwerty-abc-mode-btn[data-mode="transcribe"] {',
      '  background: var(--qwerty-abc-piano-transcribe-color, #1a5fb4);',
      '  color: #fff; border-color: var(--qwerty-abc-piano-transcribe-color, #1a5fb4); }',
      '.qwerty-abc-mode-btn[data-mode="play"] {',
      '  background: var(--qwerty-abc-piano-play-color, #d97c3a);',
      '  color: #fff; border-color: var(--qwerty-abc-piano-play-color, #d97c3a); }',
      // Triplet button
      '.qap-triplet-btn { padding: 0.3rem 0.75rem; font-size: 0.8rem; }',
      '.qap-triplet-btn:hover:not(:disabled) { background: #e8f0fe; border-color: #6b9bd5; }',
      '.qap-triplet-btn:disabled { opacity: 0.5; cursor: default; }',
      // Advanced toggle (mountFullUI)
      '.qap-adv-toggle { padding: 0.3rem 0.75rem; font-size: 0.8rem; }',
      '.qap-adv-toggle:hover { background: #e8f0fe; border-color: #6b9bd5; }',
      '.qap-adv-toggle.active { background: #1a5fb4; color: #fff; border-color: #1a5fb4; }',
      // ── Touch-responsive sizing ───────────────────────────────────────────
      '@media (hover: none) and (pointer: coarse) {',
      '  .qwerty-abc-dur-btn { min-height: 44px; min-width: 44px; font-size: 1.1rem; padding: 0.5rem; }',
      '  .qap-rest-btn       { min-height: 44px; min-width: 44px; }',
      '  .qap-triplet-btn    { min-height: 44px; padding: 0.5rem 1rem; }',
      '}',
      // Key/note label toggles
      'svg.qap-piano.qap-no-key-labels .qap-key-qwerty { display: none; }',
      'svg.qap-piano.qap-no-note-names .qap-note-name  { display: none; }',
      // Tap button (percussion mode) — explicit background so it's legible on any page colour
      '.qap-tap-btn { display: flex; flex-direction: column; align-items: center; justify-content: center;',
      '  width: 100%; min-height: 80px; font-size: 1.5rem; font-weight: bold; cursor: pointer;',
      '  border: 2px solid #bbb; border-radius: 8px; background: #f5f5f5; color: #333;',
      '  transition: background 0.1s, border-color 0.1s; gap: 4px; box-sizing: border-box; }',
      '.qap-tap-btn:hover { background: #e8f0fe; border-color: #6b9bd5; }',
      '.qap-tap-btn--active { background: #dce8f8; border-color: #5b9bd5; }',
      '.qap-tap-hint { font-size: 0.75rem; font-weight: normal; opacity: 0.6; }',
      '@media (hover: none) and (pointer: coarse) { .qap-tap-btn { min-height: 120px; font-size: 2rem; } }',
    ].join('\n'));
  }

  // ── Private: abcjs integration ───────────────────────────────────────────

  private _renderNotation(): void {
    // Fired first and unconditionally: a host may suppress the notation panel
    // entirely (showNotation:false) and still need the entered-note display to
    // track every change, including chord-preview notes.
    this._displayListener?.();

    const { abcjs, abcjsRenderOptions, notationTheme } = this._options;
    // A transport can be mounted without a notation panel (showNotation:false),
    // and its Play button still needs a tune.
    if (!abcjs || !this._notationTarget) { this._pushTuneToTransport(); return; }
    if (notationTheme === 'black') this._notationTarget.classList.add('qap-notation');

    // Force a clean slate on every render so that structural directives like
    // %%stafflines take effect immediately, even when abcjs re-uses a container
    // it has rendered into before.
    (this._notationTarget as HTMLElement).innerHTML = '';

    // While a chord is being built, include the in-progress chord so the user
    // sees each note as they add it — committed state (getABC) is untouched.
    const previewNotes = this._notesWithChordPreview();

    // Show a placeholder staff until the user has entered actual sound (note, rest, or chord).
    // Structural-only entries (tuplet-start, barline, space) don't produce valid ABC on their own
    // and would cause abcjs to render nothing, making the staff disappear.
    const hasContent = previewNotes.some(
      n => n.type === 'note' || n.type === 'rest' || n.type === 'simultaneous',
    );
    let abc: string;
    if (hasContent) {
      abc = `${this._abcHeader('Transcription')}\n${this._bodyFor(previewNotes)}\n`;
    } else if (this._percussionMode) {
      abc = `X:1\nT:\nM:${this._timeSignature}\nL:1/4\nK:none clef=perc stafflines=1\nV:1 stem=up\nz\n`;
    } else {
      const clefStr = this._clef !== 'treble' ? ` clef=${this._clef}` : '';
      abc = `X:1\nT:\nM:${this._timeSignature}\nL:1/4\nK:${this._keySignature}${clefStr}\nz\n`;
    }
    const result = abcjs.renderAbc(this._notationTarget, abc, abcjsRenderOptions);
    if (result.length) this._lastTuneObject = result[0];
    this._updateSelectionHighlight();
    this._pushTuneToTransport();
  }

  /**
   * Hands the CURRENT transcription to the playback transport.
   *
   * The transport's own Play button is inert until `setTune` has run:
   * abcjs's `SynthController.play()` goes through `runWhenReady`, which
   * returns `{status:'loading'}` and does nothing at all while `visualObj` is
   * undefined (as of abcjs 6.6.3). `load()` only builds the buttons and the
   * progress bar, so the tune is pushed here on every render; otherwise the
   * Play button would do nothing until the user had pressed Enter.
   *
   * `userAction: false` stores the tune WITHOUT starting audio or fetching a
   * soundfont (`setTune` only calls `go()` when the flag is true), so doing
   * this on every edit is cheap; the soundfont download still happens on the
   * first real play.
   */
  private _pushTuneToTransport(): void {
    if (!this._synthController) return;
    const { abcjs } = this._options;
    let visualObj = this._lastTuneObject;
    if (!visualObj) {
      // No notation panel to borrow a render from: engrave off-screen.
      if (!abcjs) return;
      try {
        visualObj = abcjs.renderAbc('*', this.getFullABC(), {})[0] ?? null;
      } catch (err) {
        console.warn('qwerty-abc-piano: could not render for playback', err);
        return;
      }
      if (!visualObj) return;
    }
    try {
      void this._synthController
        .setTune(visualObj, false, this._options.synthOptions)
        .catch((err: unknown) => console.warn('qwerty-abc-piano: setTune failed', err));
    } catch (err) {
      console.warn('qwerty-abc-piano: setTune threw', err);
    }
  }

  private async _synthesizeAndPlay(abc: string): Promise<void> {
    const { abcjs, abcjsAudioContext } = this._options;
    if (!abcjs || !abcjsAudioContext || !abcjs.synth) {
      // Once per instance, not on every Enter.
      if (!this._warnedNoSynth) {
        this._warnedNoSynth = true;
        console.warn('qwerty-abc-piano: no abcjs synth or audio context — cannot play');
      }
      return;
    }

    // Use SynthController (play/pause/restart UI) when a playback target is configured
    if (this._synthController) {
      try {
        const visualObj = this._lastTuneObject ?? abcjs.renderAbc('*', abc, {})[0];
        if (!visualObj) return;
        // `userAction: true` — this call IS the user's play gesture, so abcjs
        // may start audio. The third argument is the synth OPTIONS bag, which
        // is where a host's own soundfont lives. (An audio context passed here
        // would be an options object abcjs does not understand, leaving it on
        // its default CDN font at 1.0x volume.)
        await this._synthController.setTune(visualObj, true, this._options.synthOptions);
      } catch (err) { console.warn('qwerty-abc-piano: playback failed', err); }
      return;
    }

    // Fallback: raw CreateSynth (no playback UI, no pause)
    try {
      let visualObj = this._lastTuneObject;
      if (!visualObj) {
        const rendered = abcjs.renderAbc('*', abc, {});
        if (!rendered.length) return;
        visualObj = rendered[0];
      }
      const synth = new abcjs.synth.CreateSynth();
      await synth.init({
        audioContext: abcjsAudioContext,
        visualObj,
        options: this._options.synthOptions,
      });
      await synth.prime();
      synth.start();
    } catch (err) { console.warn('qwerty-abc-piano: playback failed', err); }
  }

  private _playNoteAudio(note: string, octave: number): void {
    const { abcjs, abcjsAudioContext } = this._options;
    if (!abcjs || !abcjsAudioContext || !abcjs.synth) return;
    const token = this._noteToABC(note, octave, this._duration, this._isDotted);
    const abc   = `X:1\nT:\nM:4/4\nL:1/4\nK:${this._keySignature}\n${token}\n`;
    // Per-note audio always renders to '*' (no cursor needed for individual notes)
    const playDirect = async () => {
      try {
        const rendered = abcjs.renderAbc('*', abc, {});
        if (!rendered.length) return;
        const synth = new abcjs.synth!.CreateSynth();
        await synth.init({ audioContext: abcjsAudioContext, visualObj: rendered[0] });
        await synth.prime();
        synth.start();
      } catch { /* non-fatal */ }
    };
    void playDirect();
  }

  // ── Private: selection ───────────────────────────────────────────────────

  private _updateSelectionHighlight(): void {
    if (!this._notationTarget) return;
    for (const el of this._notationTarget.querySelectorAll('.qap-selected')) {
      (el as Element).classList.remove('qap-selected');
    }
    if (this._selectedIndex === null || !this._lastTuneObject) return;

    let eventIdx = 0;
    for (let i = 0; i < this._selectedIndex; i++) {
      if (this._notes[i].type === 'note' || this._notes[i].type === 'rest') eventIdx++;
    }
    try {
      type TuneObj = { setupEvents: (a: number, b: number, c: number) => Array<{ elements?: HTMLElement[][] }> };
      const events = (this._lastTuneObject as TuneObj).setupEvents(0, 1, 120).filter(e => e.elements);
      const ev = events[eventIdx];
      if (ev?.elements) for (const g of ev.elements) for (const el of g) el.classList.add('qap-selected');
    } catch { /* non-browser or mocked env */ }
  }

  private _moveSelection(delta: number): void {
    const noteIndices = this._notes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.type === 'note' || n.type === 'rest' || n.type === 'simultaneous')
      .map(({ i }) => i);
    if (noteIndices.length === 0) { this._selectedIndex = null; return; }

    if (this._selectedIndex === null) {
      this._selectedIndex = delta > 0 ? noteIndices[0] : noteIndices[noteIndices.length - 1];
    } else {
      const pos    = noteIndices.indexOf(this._selectedIndex);
      const newPos = Math.max(0, Math.min(noteIndices.length - 1, pos + delta));
      this._selectedIndex = noteIndices[newPos];
    }
    this._options.onSelectionChange?.(this._selectedIndex);
    this._renderNotation();
  }

  // ── Private: event dispatch ───────────────────────────────────────────────

  private _fireEvent(name: string, detail: Record<string, unknown> = {}): void {
    const abc = this.getABC();
    if (name === 'change') {
      this._options.onChange?.(abc);
      this._renderNotation();
    }
    if (name === 'note-added')      this._options.onNoteAdded?.(abc, String(detail.lastNote ?? ''));
    if (name === 'note-deleted')    this._options.onNoteDeleted?.(abc);
    if (name === 'barline')         this._options.onBarlineInserted?.(abc);
    if (name === 'mode-change')     this._options.onModeChange?.(this._mode);
    if (name === 'playback')        this._options.onPlayback?.();
    if (name === 'clear-requested') this._options.onClearRequested?.();

    if (typeof document !== 'undefined') {
      document.dispatchEvent(
        new CustomEvent(`qwerty-abc-piano:${name}`, { detail: { ...detail, abc } }),
      );
    }
  }

  // ── Internal: note / barline insertion (called by the input handlers) ─────

  // Takes an absolute octave (octave shift already applied by the caller).
  private _addNote(note: string, absoluteOctave: number): void {
    const entry: Extract<NoteEntry, { type: 'note' }> = {
      type:     'note',
      note,
      octave:   absoluteOctave,
      duration: this._duration,
      isDotted: this._isDotted,
    };

    const beats = this._getEffectiveBeats(entry.duration, entry.isDotted);

    // Pre-check: note would push past the end of the current measure → barline first
    if (this._barlineMode === 'auto' && this._beatPosition > 0) {
      const preTarget = this._getMeasureTarget();
      if (this._beatPosition + beats > preTarget) {
        this._notes.push({ type: 'barline' });
        this._beatPosition  = 0;
        this._pickupComplete = true;
        this._fireEvent('barline');
      }
    }

    this._notes.push(entry);
    this._beatPosition += beats;

    // Tuplet countdown
    if (this._tupletRemaining > 0) {
      this._tupletRemaining--;
      if (this._tupletRemaining === 0) this._fireTupletChange(false, 0);
      else this._fireTupletChange(true, this._tupletRemaining);
    }

    // Post-check: note exactly filled or overflowed the measure → barline after (auto mode)
    if (this._barlineMode === 'auto') {
      const postTarget = this._getMeasureTarget();
      if (this._beatPosition >= postTarget) {
        this._notes.push({ type: 'barline' });
        this._beatPosition   = Math.max(0, this._beatPosition - postTarget);
        this._pickupComplete = true;
        this._fireEvent('barline');
      }
    } else if (this._beatPosition > this._getMeasureTarget()) {
      // Manual/none barline mode: report an overfull measure
      const beats2 = this._beatPosition;
      const maxBeats = this._getMeasureTarget();
      this._options.onMeasureOverflow?.(beats2, maxBeats);
      this._fireEvent('measure-overflow', { beats: beats2, maxBeats });
    }

    const abcNote = this._noteToABC(entry.note, entry.octave, entry.duration, entry.isDotted);
    this._fireEvent('note-added', { lastNote: abcNote });
    this._fireEvent('change');
  }

  private _insertManualBarline(): void {
    this._notes.push({ type: 'barline' });
    this._beatPosition   = 0;
    this._pickupComplete = true;
    this._fireEvent('barline');
    this._fireEvent('change');
  }

  private _addRest(): void {
    const entry: Extract<NoteEntry, { type: 'rest' }> = {
      type:     'rest',
      duration: this._duration,
      isDotted: this._isDotted,
    };

    const beats = this._getEffectiveBeats(entry.duration, entry.isDotted);

    if (this._barlineMode === 'auto' && this._beatPosition > 0) {
      const preTarget = this._getMeasureTarget();
      if (this._beatPosition + beats > preTarget) {
        this._notes.push({ type: 'barline' });
        this._beatPosition  = 0;
        this._pickupComplete = true;
        this._fireEvent('barline');
      }
    }

    this._notes.push(entry);
    this._beatPosition += beats;

    // Tuplet countdown
    if (this._tupletRemaining > 0) {
      this._tupletRemaining--;
      if (this._tupletRemaining === 0) this._fireTupletChange(false, 0);
      else this._fireTupletChange(true, this._tupletRemaining);
    }

    if (this._barlineMode === 'auto') {
      const postTarget = this._getMeasureTarget();
      if (this._beatPosition >= postTarget) {
        this._notes.push({ type: 'barline' });
        this._beatPosition   = Math.max(0, this._beatPosition - postTarget);
        this._pickupComplete = true;
        this._fireEvent('barline');
      }
    }

    this._fireEvent('change');
  }

  // ── Private: raw ABC passthrough capture ────────────────────────────────
  //
  // ABC-fluent users can type structural / decoration tokens directly — '|',
  // '|:', ':|2', '!trill!', '"Gm"', '{gc}' — and have them pass through into
  // the tune verbatim. Typing an opener character (see RAW_OPENERS) silently
  // enters a capture state; subsequent keys build up the token instead of
  // playing notes. Each keystroke re-validates via abcjs; an invalid token is
  // never committed (it stays editable, flagged invalid, until fixed).

  /** True while a raw ABC token is being typed.
   * @internal Not part of the supported public API; may change without notice. */
  get rawCaptureActive(): boolean { return this._rawBuffer !== ''; }

  private _startRawCapture(opener: string): void {
    this._rawBuffer = opener;
    this._rawClose  = RAW_OPENERS[opener] ?? null;
    this._rawValid  = this._rawTokenValid(opener);
    this._fireRawChange();
  }

  private _endRawCapture(): void {
    this._rawBuffer = '';
    this._rawClose  = null;
    this._rawValid  = true;
    this._fireRawChange();
  }

  /** Discard the in-progress token (Escape while capturing). */
  private _cancelRawCapture(): void {
    this._endRawCapture();
    // getABC no longer includes the buffer, so refresh listeners / notation.
    this._fireEvent('change');
  }

  private _fireRawChange(): void {
    this._options.onRawChange?.(this._rawBuffer, this._rawValid);
    // Keep the assembled-ABC preview and host validation in step with the buffer.
    this._fireEvent('change');
  }

  /** Commit the current buffer as a raw entry if it validates; returns whether
   * it committed. On failure the buffer is kept (flagged invalid) for editing. */
  private _tryCommitRaw(): boolean {
    const token = this._rawBuffer;
    if (!this._rawTokenValid(token)) {
      this._rawValid = false;
      this._fireRawChange();
      return false;
    }
    // If the previous entry is a bare (e.g. auto-inserted) barline and the user
    // typed a repeat/volta barline, upgrade that barline in place instead of
    // appending a second one: `… |` + `|:` → `… |:`.
    const last = this._notes[this._notes.length - 1];
    if (token.includes('|') && last && last.type === 'barline') {
      this._notes[this._notes.length - 1] = { type: 'raw', text: token };
    } else {
      // Commit into the note list in the correct position (before any following note).
      this._notes.push({ type: 'raw', text: token });
    }
    if (token.includes('|')) { this._beatPosition = 0; this._pickupComplete = true; }
    this._endRawCapture();
    this._fireEvent('change');
    return true;
  }

  /** Validate a candidate raw token by test-rendering `header + body + token`
   * with abcjs and checking that it introduces no new parse warnings. When no
   * abcjs instance is available we fall back to a permissive structural check. */
  private _rawTokenValid(token: string): boolean {
    // A lone ':' (or run of them) is never a complete barline token.
    if (/^:+$/.test(token)) return false;
    // A self-closing token isn't valid until its closing delimiter is present.
    if (this._rawClose && !(token.length > 1 && token.endsWith(this._rawClose))) return false;

    const abcjs = this._options.abcjs;
    if (!abcjs) return true; // can't parse-check → don't block the user

    // Decorations / chord symbols / grace notes attach to a following note, so
    // probe them with a trailing 'C'; barlines stand alone.
    const probe = token.includes('|') ? '' : 'C';
    const header = this._abcHeader('probe');
    const body   = this._bodyFor(this._notes);
    const count  = (abc: string): number => {
      try {
        const tunes = abcjs.renderAbc('*', abc, {}) as Array<{ warnings?: unknown[] }>;
        return tunes?.[0]?.warnings?.length ?? 0;
      } catch { return Number.POSITIVE_INFINITY; }
    };
    const base = count(`${header}\n${body}\nC\n`);
    const test = count(`${header}\n${body} ${token}${probe}\nC\n`);
    return Number.isFinite(test) && test <= base;
  }

  // ── Private: ABC parser (for setABC) ────────────────────────────────────

  /**
   * Parse one ABC note token into an absolute pitch.
   *
   * `bar` is the accidental state of the current bar, as in {@link _noteToABC}:
   * a note written without an accidental takes the alteration of an earlier
   * accidental on the same letter and octave in the bar, else the key
   * signature's; a note with an accidental records it for the rest of the bar.
   */
  private _parseABCToken(token: string, bar?: Map<string, number>): Extract<NoteEntry, { type: 'note' }> | null {
    // Matches the ABC subset this library produces:
    // optional-accidental  letter  octave-modifiers  optional-duration
    const match = token.match(/^([_^=]?)([A-Ga-g])([',]*)(\d+\/\d+|\d+|\/\d+)?$/);
    if (!match) return null;

    const [, accStr, letterStr, octMod, durStr] = match;

    const isLower     = letterStr === letterStr.toLowerCase();
    const apostrophes = (octMod.match(/'/g) ?? []).length;
    const commas      = (octMod.match(/,/g) ?? []).length;
    // Standard ABC: `C` = C4 (middle C), `c` = C5 (the inverse of _noteToABC).
    const octave      = isLower ? 5 + apostrophes : 4 - commas;

    const upperLetter = letterStr.toUpperCase();
    const keySharps   = getKeyImpliedSharps(this._keySignature);
    const keyFlats    = getKeyImpliedFlats(this._keySignature);

    // The alteration this note sounds with: its own accidental, else an
    // earlier accidental on this letter and octave in the bar, else the key.
    const slot = `${upperLetter}${octave}`;
    let alter: number;
    if (accStr) {
      alter = accStr === '^' ? 1 : accStr === '_' ? -1 : 0;
      bar?.set(slot, alter);
    } else if (bar?.has(slot)) {
      alter = bar.get(slot)!;
    } else {
      alter = keySharps.has(upperLetter) ? 1 : keyFlats.has(upperLetter) ? -1 : 0;
    }

    // As an absolute-pitch note name (sharps for black keys).
    let note: string;
    if (alter === 1) {
      note = upperLetter + '#';                                // ^F, or F in K:G → F#
    } else if (alter === -1) {
      note = FLAT_TO_SHARP_NOTE[upperLetter] ?? upperLetter;  // _B, or B in K:Bb → A#
    } else {
      note = upperLetter;                                      // =F, or C in K:C → natural
    }

    const durLookup: Record<string, [Duration, boolean]> = {
      '4':    ['w', false], '6':    ['w', true],
      '2':    ['h', false], '3':    ['h', true],
      '1':    ['q', false], '3/2':  ['q', true],
      '/2':   ['e', false], '3/4':  ['e', true],
      '/4':   ['s', false], '3/8':  ['s', true],
      '/8':   ['t', false], '3/16': ['t', true],
    };

    let duration: Duration = 'q';
    let isDotted = false;
    if (durStr) {
      const mapped = durLookup[durStr];
      if (mapped) [duration, isDotted] = mapped;
    }

    return { type: 'note', note, octave, duration, isDotted };
  }

  private _parseRestToken(token: string): Extract<NoteEntry, { type: 'rest' }> | null {
    const match = token.match(/^z(\d+\/\d+|\d+|\/\d+)?$/);
    if (!match) return null;

    const [, durStr] = match;
    const durLookup: Record<string, [Duration, boolean]> = {
      '':     ['q', false], '1':    ['q', false],
      '4':    ['w', false], '6':    ['w', true],
      '2':    ['h', false], '3':    ['h', true],
      '3/2':  ['q', true],
      '/2':   ['e', false], '3/4':  ['e', true],
      '/4':   ['s', false], '3/8':  ['s', true],
      '/8':   ['t', false], '3/16': ['t', true],
    };

    const [duration, isDotted] = durLookup[durStr ?? ''] ?? ['q', false];
    return { type: 'rest', duration, isDotted };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Returns the ABC body entered so far (notes, rests, chords, barlines and raw
   * tokens), without the tune header. A raw ABC token that is still being
   * typed is appended as-is. Use {@link getFullABC} for a complete tune.
   *
   * @returns The ABC body, e.g. `'CDEF|'`; an empty string when nothing has
   *   been entered.
   */
  getABC(): string {
    const body = this._bodyFor(this._notes);
    // A raw token still being typed is shown in the output (and thus the host's
    // live validation / save) so what the user sees matches what they'd save.
    // It commits into `_notes` on the next boundary key; until then it rides
    // along here read-only.
    if (this._rawBuffer) {
      return body ? `${body} ${this._rawBuffer}` : this._rawBuffer;
    }
    return body;
  }

  /** Serialize a note list to an ABC body. Factored out of {@link getABC} so the
   * live chord-building preview can render `_notes` plus a provisional chord
   * without mutating committed state. */
  private _bodyFor(notes: NoteEntry[]): string {
    const parts: string[] = [];
    let barlineCount = 0;
    let bar = new Map<string, number>();
    for (const entry of notes) {
      if (entry.type === 'barline') {
        bar = new Map();
        barlineCount++;
        if (this._measuresPerLine > 0 && barlineCount % this._measuresPerLine === 0) {
          parts.push('|\n');
        } else {
          parts.push('| ');
        }
      } else if (entry.type === 'raw') {
        // A barline-family token (contains '|') behaves like a barline: it wraps
        // the line at the measures-per-line boundary and is space-separated.
        // Decorations / chord symbols / grace notes glue to the following note.
        if (entry.text.includes('|')) {
          bar = new Map();
          barlineCount++;
          if (this._measuresPerLine > 0 && barlineCount % this._measuresPerLine === 0) {
            parts.push(entry.text + '\n');
          } else {
            parts.push(entry.text + ' ');
          }
        } else {
          parts.push(entry.text);
        }
      } else if (entry.type === 'space') {
        parts.push(' ');
      } else if (entry.type === 'tuplet-start') {
        parts.push(`(${entry.count}`);
      } else if (entry.type === 'rest') {
        const suffix = entry.isDotted
          ? DOTTED_DURATION_MAP[entry.duration]
          : DURATION_MAP[entry.duration];
        parts.push(`z${suffix}`);
      } else if (entry.type === 'simultaneous') {
        const notes = entry.notes.map(n => this._noteToABC(n.note, n.octave, entry.duration, entry.isDotted, bar)).join('');
        parts.push(`[${notes}]`);
      } else {
        parts.push(this._noteToABC(entry.note, entry.octave, entry.duration, entry.isDotted, bar));
      }
    }
    return parts.join('').trimEnd();
  }

  /** The ABC tune header (X/T/M/[Q/]L/K) for the current meter/key/clef/mode.
   *
   * `Q:` is emitted only when a tempo has been set ({@link setTempo}); the unit
   * is `1/4` — an absolute quarter-note speed, independent of the meter — which
   * is what abcjs reads to decide playback speed. Compound meters are felt in
   * dotted quarters, but that is a DISPLAY concern for the host: the header
   * only has to state the right absolute speed. */
  private _abcHeader(title: string): string {
    const tempo = this._tempoBpm === null ? [] : [`Q:1/4=${this._tempoBpm}`];
    if (this._percussionMode) {
      return ['X:1', `T:${title}`, `M:${this._timeSignature}`, ...tempo, 'L:1/4', 'K:none clef=perc stafflines=1', 'V:1 stem=up'].join('\n');
    }
    const clefStr = this._clef !== 'treble' ? ` clef=${this._clef}` : '';
    return ['X:1', `T:${title}`, `M:${this._timeSignature}`, ...tempo, 'L:1/4', `K:${this._keySignature}${clefStr}`].join('\n');
  }

  /** The committed notes plus the in-progress chord (if a chord is open and has
   * at least one buffered note), without mutating `_notes` — for the live
   * notation preview while building a chord. */
  private _notesWithChordPreview(): NoteEntry[] {
    if (!this._simultaneousActive || this._simultaneousBuffer.length === 0) {
      return this._notes;
    }
    return [
      ...this._notes,
      {
        type: 'simultaneous',
        notes: [...this._simultaneousBuffer],
        duration: this._simultaneousBufferDuration,
        isDotted: this._simultaneousBufferDotted,
      },
    ];
  }

  /**
   * Sets how many measures are written per line of ABC before a line break.
   * Takes effect on the next change.
   *
   * @param n - Measures per line; fractions are floored, and 0 (or less)
   *   disables line breaks.
   */
  setMeasuresPerLine(n: number): void {
    this._measuresPerLine = Math.max(0, Math.floor(n));
  }

  /** Inserts a barline at the current position, as the `\` key does. No-op
   * when the barline mode is `'none'`. */
  insertBarline(): void {
    if (this._barlineMode !== 'none') this._insertManualBarline();
  }

  /**
   * Changes the barline mode at runtime.
   *
   * @param mode - `'auto'` inserts barlines as measures fill, `'manual'` only
   *   where the user inserts them (reporting overfull measures through
   *   `onMeasureOverflow`), `'none'` never.
   */
  setBarlineMode(mode: 'auto' | 'manual' | 'none'): void {
    this._barlineMode = mode;
  }

  /** Inserts a rest of the current duration, as the `z` key does. No-op in
   * play mode. */
  insertRest(): void {
    if (this._mode === 'transcribe') this._addRest();
  }

  /** Starts a triplet (same as pressing Q): the next three notes or rests are
   * written as a `(3` group. No-op in play mode or if already in a triplet. */
  startTriplet(): void {
    if (this._mode === 'transcribe' && this._tupletRemaining === 0) {
      this._tupletCount     = 3;
      this._tupletRemaining = 3;
      this._notes.push({ type: 'tuplet-start', count: 3 });
      this._fireTupletChange(true, 3);
      this._fireEvent('change');
    }
  }

  /** Show or hide QWERTY key labels on the piano. Remembered across re-renders. */
  setShowKeyLabels(show: boolean): void {
    this._showKeyLabels = show;
    this._applyLabelVisibility();
  }

  /** Show or hide note name labels on the piano. Remembered across re-renders. */
  setShowNoteNames(show: boolean): void {
    this._showNoteNames = show;
    this._applyLabelVisibility();
  }

  private _applyLabelVisibility(): void {
    const svg = this._pianoTarget?.querySelector('svg.qap-piano');
    svg?.classList.toggle('qap-no-key-labels', !this._showKeyLabels);
    svg?.classList.toggle('qap-no-note-names', !this._showNoteNames);
  }

  /** Cancel an active triplet (only if no notes have been entered into it yet). */
  cancelTriplet(): void {
    if (this._tupletRemaining === this._tupletCount && this._tupletRemaining > 0) {
      // No notes entered yet — remove the tuplet-start entry
      const last = this._notes[this._notes.length - 1];
      if (last?.type === 'tuplet-start') this._notes.pop();
      this._tupletRemaining = 0;
      this._tupletCount     = 0;
      this._fireTupletChange(false, 0);
      this._fireEvent('change');
    }
  }

  /**
   * Returns a complete ABC tune: a header (`X:`, `T:`, `M:`, an optional `Q:`,
   * `L:1/4`, `K:` with the clef) followed by {@link getABC}.
   *
   * @param opts.title - The `T:` title; defaults to `'Transcription'`.
   * @returns The full tune, ending in a newline.
   *
   * @example
   * ```ts
   * piano.getFullABC({ title: 'Scale' });
   * // 'X:1\nT:Scale\nM:4/4\nL:1/4\nK:C\nCDEF|\n'
   * ```
   */
  getFullABC(opts: { title?: string } = {}): string {
    return `${this._abcHeader(opts.title ?? 'Transcription')}\n${this.getABC()}\n`;
  }

  /**
   * Replaces the current notes with the given ABC body (no header), so a saved
   * transcription can be loaded back for further editing. Notes, rests, chords,
   * triplets and barlines become editable entries; anything else (repeats,
   * decorations, ties, inline fields, …) is kept verbatim and written back out
   * unchanged. Clears the selection and fires `change`.
   *
   * @param abc - An ABC tune body, e.g. `'CDEF|GABc|'`. Unaccidentalled notes
   *   are read against the current key signature.
   */
  setABC(abc: string): void {
    this._notes = [];
    this._rawBuffer = '';
    this._rawClose  = null;

    // Regex scanner. Order matters: chord symbols / decorations / grace notes
    // and the barline-repeat-volta family are matched before the plain note,
    // rest, and simultaneous-chord alternatives so their delimiters aren't
    // mis-read as notes.
    // The trailing `[^\s]` catch-all is what makes this LOSSLESS: anything the
    // alternatives above do not recognise — a tie `-`, broken rhythm `>`/`<`,
    // slur parens, a `$` — is captured one character at a time and stored as
    // `raw`, which {@link _bodyFor} re-emits verbatim in position. Without it,
    // `matchAll` would skip those characters and the ABC would not round-trip.
    const re = /("[^"]*"|![^!]*!|\{[^}]*\}|\[\||:\|\d*|\|:|\|\||\|\]|\|\d+|::|\||\[[^\]]*\]|\(\d+|[_^=]?[A-Ga-g][',]*(?:\d+\/\d+|\d+|\/\d+)?|z(?:\d+\/\d+|\d+|\/\d+)?|\s+|[^\s])/g;
    let lastWasBarline = false;
    let bar = new Map<string, number>(); // accidentals in force in the current bar
    for (const match of abc.matchAll(re)) {
      const token = match[0];
      if (/^\s+$/.test(token)) {
        // Whitespace immediately after a barline is already implicit (barlines output '| ')
        if (!lastWasBarline) this._notes.push({ type: 'space' });
        lastWasBarline = false;
        continue;
      }
      // Plain single barline keeps its dedicated entry (drives measures-per-line wrapping).
      if (token === '|') {
        bar = new Map();
        this._notes.push({ type: 'barline' });
        lastWasBarline = true;
        continue;
      }
      // Repeats / voltas / double & end barlines pass through verbatim as raw.
      if (/^(?:\|:|:\|\d*|\|\||\|\]|\[\||\|\d+|::)$/.test(token)) {
        bar = new Map();
        this._notes.push({ type: 'raw', text: token });
        lastWasBarline = true;
        continue;
      }
      // Decorations, chord symbols, and grace notes pass through verbatim as raw.
      if (token[0] === '!' || token[0] === '"' || token[0] === '{') {
        this._notes.push({ type: 'raw', text: token });
        lastWasBarline = false;
        continue;
      }
      lastWasBarline = false;
      // An INLINE FIELD — [K:D], [M:3/4], [Q:1/4=90] — wears the same brackets
      // as a chord but is not one. Read as a chord its contents would be
      // mined for note letters ('K:D' yielding a stray D), so it passes
      // through untouched instead.
      if (/^\[[A-Za-z]:/.test(token)) {
        this._notes.push({ type: 'raw', text: token });
        continue;
      }
      // Simultaneous chord: [notes]
      if (token.startsWith('[') && token.endsWith(']')) {
        const inner = token.slice(1, -1);
        const noteRe = /([_^=]?[A-Ga-g][',]*(?:\d+\/\d+|\d+|\/\d+)?)/g;
        const notes: Array<{ note: string; octave: number }> = [];
        let firstDuration: Duration = this._duration;
        let firstDotted = false;
        let isFirst = true;
        for (const nm of inner.matchAll(noteRe)) {
          const parsed = this._parseABCToken(nm[1], bar);
          if (parsed) {
            notes.push({ note: parsed.note, octave: parsed.octave });
            if (isFirst) { firstDuration = parsed.duration; firstDotted = parsed.isDotted; isFirst = false; }
          }
        }
        if (notes.length > 0) {
          this._notes.push({ type: 'simultaneous', notes, duration: firstDuration, isDotted: firstDotted });
        }
        continue;
      }
      if (/^\(\d+$/.test(token)) {
        const count = parseInt(token.slice(1), 10);
        this._notes.push({ type: 'tuplet-start', count });
        continue;
      }
      // Anything the note/rest parsers cannot read is kept VERBATIM rather than
      // dropped — a tie, a broken-rhythm mark, a slur paren, an
      // oddly-spelled duration. The piano cannot edit it, but the user's typed
      // ABC comes back exactly as they wrote it.
      if (/^z/.test(token)) {
        const rest = this._parseRestToken(token);
        this._notes.push(rest ?? { type: 'raw', text: token });
      } else {
        const entry = this._parseABCToken(token, bar);
        this._notes.push(entry ?? { type: 'raw', text: token });
      }
    }
    // Rebuild _beatPosition, _pickupComplete, _tupletRemaining, _tupletCount from notes
    this._recalcBeatPosition();
    this._fireTupletChange(this._tupletRemaining > 0, this._tupletRemaining);
    this._selectedIndex = null;
    this._options.onSelectionChange?.(null);
    this._fireEvent('change');
    this._renderNotation();
  }

  /**
   * Removes every entered note and resets the beat position, pickup, triplet
   * and selection state, then fires `change`. Settings (key, meter, clef,
   * tempo, duration, octave) are kept.
   */
  clear(): void {
    this._notes          = [];
    this._rawBuffer      = '';
    this._rawClose       = null;
    this._beatPosition   = 0;
    this._pickupComplete = this._pickupBeats === 0;
    this._selectedIndex  = null;
    this._options.onSelectionChange?.(null);
    if (this._tupletRemaining > 0) {
      this._tupletRemaining = 0;
      this._tupletCount     = 0;
      this._fireTupletChange(false, 0);
    }
    this._fireEvent('change');
  }

  /**
   * Switches between `'transcribe'` (keys write notes) and `'play'` (keys only
   * sound). Fires `onModeChange`. No-op when the instance was created with
   * `lockMode: true`.
   */
  setMode(mode: Mode): void {
    if (this._lockMode) return;
    this._mode = mode;
    if (this._modeTarget)  updateModeToggle(this._modeTarget, mode);
    if (this._pianoTarget) updatePianoMode(this._pianoTarget, mode);
    this._fireEvent('mode-change', { mode });
  }

  /** The current mode: `'transcribe'` or `'play'`. */
  getMode(): Mode {
    return this._mode;
  }

  /**
   * Sets the key signature used for the `K:` header and for spelling notes
   * (e.g. a black key is written `F` in G major but `^F` in C). Notes already
   * entered are re-spelled in the new key; the notation is redrawn.
   *
   * @param ks - An ABC key, e.g. `'C'`, `'G'`, `'Bb'`, `'Am'`.
   */
  setKeySignature(ks: string): void {
    this._keySignature = ks;
    this._renderNotation();
  }

  /**
   * Sets the clef written into the `K:` header and redraws the notation.
   *
   * @param clef - An ABC clef name, e.g. `'treble'`, `'bass'`, `'alto'`.
   */
  setClef(clef: string): void {
    this._clef = clef;
    this._renderNotation();
  }

  /**
   * Sets the time signature. Automatic barlines follow the new meter from the
   * next note on; the `M:` header and notation are updated immediately.
   *
   * @param ts - A meter of the form `N/M`, e.g. `'3/4'` or `'6/8'`.
   * @throws Error if `ts` is not a valid `N/M` meter; the current meter is
   *   left unchanged.
   */
  setTimeSignature(ts: string): void {
    // Parse FIRST: an invalid meter throws without touching the stored one.
    const beats = this._parseTimeSignature(ts);
    this._timeSignature   = ts;
    this._beatsPerMeasure = beats;
    // The staff shows `M:` too, so it has to be redrawn; otherwise barlines
    // would follow the new meter under a staff still engraved in the old one.
    this._renderNotation();
  }

  /**
   * Sets the playback tempo in quarter-note BPM, or `null` to leave the header
   * without a `Q:` line (abcjs's own default speed).
   *
   * The new tempo takes effect on the NEXT play — abcjs pre-renders its audio
   * buffer at setTune time, so a tempo change mid-playback cannot retime what
   * is already sounding.
   *
   * @param bpm - Quarter notes per minute (rounded to an integer), or `null`.
   */
  setTempo(bpm: number | null): void {
    const next = bpm === null ? null : Math.round(bpm);
    if (next === this._tempoBpm) return;
    this._tempoBpm = next;
    this._renderNotation();
  }

  /** The playback tempo in quarter-note BPM, or null when none is set. */
  getTempo(): number | null {
    return this._tempoBpm;
  }

  /**
   * Sets the absolute octave shift applied to the QWERTY keys (clamped to
   * −2…+2). At 0 the keys span E3–A4; `1` moves them up an octave. MIDI input
   * and custom-range touch keys are absolute and are not shifted.
   */
  setOctave(shift: number): void {
    this._octaveShift = Math.max(-2, Math.min(2, shift));
    if (this._pianoTarget) updateOctaveIndicator(this._pianoTarget, this._octaveShift);
  }

  /** The current octave shift, −2…+2. */
  getOctave(): number {
    return this._octaveShift;
  }

  /**
   * The note letters entered so far, **in the order they were played** —
   * including repeats, and including the notes of a chord that is still being
   * built. Accidentals are kept ("C#"); octaves are not, because this is a
   * reading aid, not a transcription (useful for a host that hides the
   * notation panel).
   */
  getNoteLetters(): string[] {
    const out: string[] = [];
    for (const entry of this._notesWithChordPreview()) {
      if (entry.type === 'note') out.push(entry.note);
      else if (entry.type === 'simultaneous') for (const n of entry.notes) out.push(n.note);
    }
    return out;
  }

  /**
   * Registers a callback fired whenever the entered-note display should
   * refresh — every committed change *and* every note buffered into an open
   * chord. `mountFullUI` uses it to drive the letter readout; hosts that render
   * their own note display can use it too. Pass `null` to clear.
   * @internal Used by mountFullUI; not part of the supported public API.
   */
  setDisplayListener(cb: (() => void) | null): void {
    this._displayListener = cb;
  }

  /**
   * Registers a cleanup callback run by {@link destroy}. `mountFullUI` uses it to
   * disconnect the `ResizeObserver` it attaches to the mount element, so the
   * setup and teardown paths stay together.
   * @internal Used by mountFullUI; not part of the supported public API.
   */
  addTeardown(fn: () => void): void {
    this._teardowns.push(fn);
  }

  /**
   * Removes the most recent entry (note, rest, chord, barline, …), as
   * Backspace and Ctrl/Cmd+Z do. While a chord is being built, removes the
   * last note from the chord instead, or cancels the chord if it is empty.
   */
  undo(): void {
    if (this._simultaneousActive) {
      if (this._simultaneousBuffer.length > 0) {
        this._simultaneousBuffer.pop();
        this._fireSimultaneousChange(true, this._simultaneousBuffer.length);
        this._renderNotation(); // live preview reflects the removed note
      } else {
        this._cancelSimultaneous();
      }
      return;
    }
    if (this._notes.length === 0) return;
    const popped = this._notes.pop()!;
    this._recalcBeatPosition();
    // Fire tuplet change if the state shifted after undo
    this._fireTupletChange(this._tupletRemaining > 0, this._tupletRemaining);
    // If the removed note was selected, clear selection
    if (this._selectedIndex !== null && this._selectedIndex >= this._notes.length) {
      this._selectedIndex = null;
      this._options.onSelectionChange?.(null);
    }
    if (popped.type === 'note' || popped.type === 'rest') this._fireEvent('note-deleted');
    this._fireEvent('change');
  }

  /**
   * Re-renders the piano keyboard to cover the given pitch range and re-attaches
   * touch listeners. `low` and `high` must be pitch strings like "C4" or "F#3".
   * Pass `null` for both to reset to the default QWERTY keyboard layout (E3–A4).
   * The keyboard is redrawn only when a piano target is configured and
   * percussion mode is off; otherwise the call just validates its arguments.
   *
   * @throws Error if only one of `low` / `high` is given, or either is not a
   *   valid pitch string.
   */
  setTouchKeyRange(low: string | null, high: string | null): void {
    if (low !== null || high !== null) {
      if (!low || !high) throw new Error('qwerty-abc-piano: setTouchKeyRange requires both low and high, or both null');
      if (!parsePitchString(low))  throw new Error(`qwerty-abc-piano: invalid note "${low}"`);
      if (!parsePitchString(high)) throw new Error(`qwerty-abc-piano: invalid note "${high}"`);
    }
    if (!this._pianoTarget || this._percussionMode) return;

    const range = (low && high) ? { low, high } : undefined;
    this._pianoTarget.innerHTML = '';
    renderPiano(this._pianoTarget, this, range);
    this._applyLabelVisibility();
    if (this._options.enableTouch !== false) {
      this._attachTouchListeners(this._pianoTarget);
    }
  }

  /** Selects a note, rest or chord by its index in the internal notes array
   * (`null` to deselect), and highlights it in the notation. Indices of other
   * entries (barlines, spaces, …) are ignored. Fires `onSelectionChange`. */
  selectNote(index: number | null): void {
    if (index !== null && (index < 0 || index >= this._notes.length ||
        (this._notes[index].type !== 'note' && this._notes[index].type !== 'rest' && this._notes[index].type !== 'simultaneous'))) return;
    this._selectedIndex = index;
    this._options.onSelectionChange?.(index);
    this._updateSelectionHighlight();
  }

  /** Adjusts the pitch of the selected note, or every note of the selected
   * chord, by `delta` half-steps (usually ±1), carrying across octaves. No-op
   * when nothing is selected or a rest is selected. */
  adjustSelectedPitch(delta: number): void {
    if (this._selectedIndex === null) return;
    const entry = this._notes[this._selectedIndex];

    if (entry.type === 'simultaneous') {
      const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      for (const n of entry.notes) {
        let idx = chromatic.indexOf(n.note);
        if (idx === -1) continue;
        idx += delta;
        if (idx >= 12) { idx -= 12; n.octave++; }
        if (idx < 0)   { idx += 12; n.octave--; }
        n.note = chromatic[idx];
      }
      this._fireEvent('change');
      return;
    }

    if (entry.type !== 'note') return;

    const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    let idx = chromatic.indexOf(entry.note);
    if (idx === -1) return;

    idx += delta;
    let octave = entry.octave;
    if (idx >= 12) { idx -= 12; octave++; }
    if (idx < 0)   { idx += 12; octave--; }

    entry.note   = chromatic[idx];
    entry.octave = octave;
    this._fireEvent('change');
  }

  /**
   * Plays the full tune through abcjs, as the Enter key does, and fires
   * `onPlayback`. Requires `abcjs` and `abcjsAudioContext`; without them a
   * warning is logged once and nothing plays.
   */
  playback(): void {
    this._fireEvent('playback');
    void this._synthesizeAndPlay(this.getFullABC());
  }

  /**
   * Begins a simultaneous (chord) group. Notes played while a group is open are
   * buffered and written as a single ABC chord token (e.g. `[CEG]`) when
   * {@link commitChord} is called. This is the programmatic equivalent of the
   * `(` key / two-finger touch — provided so a host (e.g. a "Start chord" button
   * in a mobile WebView) can drive chord entry without a physical keyboard.
   *
   * No-op when already inside a chord, in percussion mode, or in play mode
   * (chords are a transcribe-mode feature). Fires `onSimultaneousChange` and the
   * `qwerty-abc-piano:simultaneous-change` DOM event on state change.
   */
  openChord(): void {
    if (this._percussionMode || this._mode !== 'transcribe') return;
    this._openSimultaneous();
  }

  /**
   * Closes the current simultaneous (chord) group, writing the buffered notes as
   * one ABC chord token and firing `change`. An empty group (no notes played)
   * commits nothing. No-op when no chord is open.
   */
  commitChord(): void {
    if (!this._simultaneousActive) return;
    this._commitSimultaneous();
  }

  /**
   * Abandons the current simultaneous (chord) group without writing anything.
   * No-op when no chord is open.
   */
  cancelChord(): void {
    if (!this._simultaneousActive) return;
    this._cancelSimultaneous();
  }

  /** Returns true while a simultaneous (chord) group is open (between openChord/commitChord). */
  isChordOpen(): boolean {
    return this._simultaneousActive;
  }

  /** Records one note at the fixed percussion pitch (B4, written `B`). No-op when not in percussion mode. */
  tap(): void {
    if (!this._percussionMode) return;
    this._handleNoteFromPitch(QWERTYToABCPiano.PERCUSSION_NOTE, QWERTYToABCPiano.PERCUSSION_OCTAVE);
  }

  /**
   * Switches percussion mode on or off at runtime. Only updates the behavioral
   * flag — all DOM shell-swapping is handled by the mountFullUI layer.
   */
  setPercussionMode(on: boolean): void {
    this._percussionMode = on;
    if (on) {
      // Force transcribe mode — there is no "play" in percussion mode.
      if (this._mode === 'play') this.setMode('transcribe');
      // Cancel any in-progress simultaneous chord.
      if (this._simultaneousActive) this._cancelSimultaneous();
    }
    // Redraw so the staff switches between 5-line and single-line immediately.
    this._renderNotation();
  }

  /**
   * Tears the instance down: removes its document keyboard listeners and touch
   * listeners, empties the piano / duration / mode targets, stops playback,
   * detaches MIDI handlers and runs any registered teardowns. Call it before
   * re-mounting, or when removing the piano from the page.
   */
  destroy(): void {
    this._destroyed = true;
    this._cancelSimultaneous();

    for (const fn of this._teardowns) { try { fn(); } catch { /* non-fatal */ } }
    this._teardowns = [];
    this._displayListener = null;

    if (this._pianoTarget && this._boundTouchStart) {
      const svg = this._pianoTarget.querySelector('svg.qap-piano');
      svg?.removeEventListener('touchstart',  this._boundTouchStart  as EventListener);
      svg?.removeEventListener('touchend',    this._boundTouchEnd!   as EventListener);
      svg?.removeEventListener('touchcancel', this._boundTouchCancel! as EventListener);
    }

    document.removeEventListener('keydown', this._boundKeyDown);
    document.removeEventListener('keyup',   this._boundKeyUp);
    if (this._durationTarget) this._durationTarget.innerHTML = '';
    if (this._modeTarget)     this._modeTarget.innerHTML = '';
    if (this._pianoTarget)    this._pianoTarget.innerHTML = '';

    // Stop SynthController (halts audio and TimingCallbacks)
    if (this._synthController) { this._synthController.destroy?.(); this._synthController = null; }

    // Detach MIDI message handlers
    for (const [input, handler] of this._midiHandlers) {
      if (input.onmidimessage === handler) input.onmidimessage = null;
    }
    this._midiHandlers.clear();
    if (this._midiAccess) {
      this._midiAccess.onstatechange = null;
      this._midiAccess = null;
    }
  }

  // ── Public state getters (also used by the bundled UI components) ────────

  /** The current note duration. */
  getDuration(): Duration { return this._duration; }
  /** Whether the current duration is dotted. */
  getIsDotted(): boolean  { return this._isDotted; }
  /** Whether rest mode is on. */
  getRestMode(): boolean  { return this._restMode; }

  /** Toggles rest mode on or off. When on, piano key presses insert rests instead of notes. */
  setRestMode(on: boolean): void {
    this._restMode = on;
    if (this._durationTarget) {
      updateDurationButtons(this._durationTarget, this._duration, this._isDotted, this._restMode);
    }
  }

  // ── Duration and note input ──────────────────────────────────────────────

  /**
   * Sets the current duration and dot state for the notes that follow, and
   * applies them to a chord that is still being built. Fires the
   * `qwerty-abc-piano:duration-change` DOM event.
   *
   * @param duration - `'w'`, `'h'`, `'q'`, `'e'`, `'s'` or `'t'` (whole down
   *   to thirty-second).
   * @param isDotted - Whether the duration is dotted. Defaults to `false`, so
   *   choosing a new duration clears the dot.
   */
  setDuration(duration: Duration, isDotted = false): void {
    this._duration = duration;
    this._isDotted = isDotted;
    // While a chord is being built, retroactively apply the new duration to the
    // in-progress chord so every note in it shares the updated length, and refresh
    // the live preview to reflect it.
    if (this._simultaneousActive) {
      this._simultaneousBufferDuration = duration;
      this._simultaneousBufferDotted   = isDotted;
      this._renderNotation();
    }
    if (this._durationTarget) updateDurationButtons(this._durationTarget, duration, isDotted, this._restMode);
    this._fireEvent('duration-change', { duration, isDotted });
  }

  // Shared entry point for QWERTY and MIDI once the absolute pitch is known.
  private _handleNoteFromPitch(note: string, absoluteOctave: number): void {
    if (this._simultaneousActive) {
      this._simultaneousBuffer.push({ note, octave: absoluteOctave });
      this._fireSimultaneousChange(true, this._simultaneousBuffer.length);
      this._renderNotation(); // live preview of the chord as it's built
      this._playNoteAudio(note, absoluteOctave);
      return;
    }
    if (this._mode === 'transcribe') {
      if (this._restMode) {
        this._addRest();
      } else {
        this._addNote(note, absoluteOctave);
      }
    }
    if (!this._restMode) this._playNoteAudio(note, absoluteOctave);
  }

  private _handleNoteKey(key: string): void {
    if (this._percussionMode) {
      // In percussion mode all piano keys map to the fixed pitch; skip highlight (no SVG)
      if (key in WHITE_KEYS || (key in BLACK_KEYS && BLACK_KEYS[key] !== null)) {
        this._handleNoteFromPitch(QWERTYToABCPiano.PERCUSSION_NOTE, QWERTYToABCPiano.PERCUSSION_OCTAVE);
      }
      return;
    }
    const white = WHITE_KEYS[key];
    if (white) {
      this._handleNoteFromPitch(white.note, white.octave + this._octaveShift);
      if (this._pianoTarget) highlightKey(this._pianoTarget, key);
      return;
    }
    if (key in BLACK_KEYS) {
      const black = BLACK_KEYS[key];
      if (black !== null) { // null = gap key (q, t, i) — silently ignored
        this._handleNoteFromPitch(black.note, black.octave + this._octaveShift);
        if (this._pianoTarget) highlightKey(this._pianoTarget, key);
      }
    }
  }

  private _attachMidiInput(input: MIDIInput): void {
    if (this._midiHandlers.has(input)) return;
    const handler = (event: MIDIMessageEvent) => this._onMidiMessage(event);
    this._midiHandlers.set(input, handler);
    input.onmidimessage = handler;
  }

  private _onMidiMessage(event: MIDIMessageEvent): void {
    const [status, noteNumber, velocity] = event.data;
    const command  = status & 0xf0;
    const isNoteOn = command === 0x90 && velocity > 0;
    if (!isNoteOn) return;
    const { note, octave } = midiNoteToNoteInfo(noteNumber);
    this._handleNoteFromPitch(note, octave);
  }

  /**
   * Request Web MIDI access on demand and begin listening for connected MIDI
   * keyboards. This triggers the browser's one-time MIDI permission prompt, so
   * it must be called from a user gesture (e.g. an "Enable MIDI" button) — the
   * Web MIDI API provides no way to defer the prompt until a device is plugged
   * in, since detecting devices itself requires access. Safe to call more than
   * once; a call after access is already granted is a no-op.
   *
   * Returns a discriminated result rather than a boolean, because a failure
   * can mean different things and a host needs to tell the user which. In
   * Firefox, for example, `requestMIDIAccess` exists, so the browser is not
   * "unsupported", but it is gated behind a SITE PERMISSION that the user may
   * have neither granted nor refused; reporting that as a denial would tell
   * the user they declined something they were never asked.
   *
   * @returns `{ state: 'connected' }` on success; `{ state: 'unsupported' }`
   *   when the browser has no Web MIDI; otherwise `{ state: 'refused' }` (the
   *   user said no) or `{ state: 'notGranted' }` (the browser did not ask),
   *   each with the rejection's `errorName` and `message`.
   *
   * @example
   * ```ts
   * midiButton.onclick = async () => {
   *   const result = await piano.enableMidiInput();
   *   if (result.state !== 'connected') showMidiHelp(result.state);
   * };
   * ```
   */
  public async enableMidiInput(): Promise<MidiEnableResult> {
    if (this._midiAccess) return { state: 'connected' };
    return this._initMidi(false);
  }

  /** Whether Web MIDI exists in this browser at all. False in Safari/iOS and in
   *  a WebView — the distinction a host needs to say WHY MIDI is unavailable
   *  rather than showing nothing. */
  public static isMidiSupported(): boolean {
    return typeof navigator !== 'undefined' &&
      typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';
  }

  /** Whether a MIDI access grant is currently held. This does NOT mean a
   *  device is plugged in — see {@link getMidiInputCount}. */
  public isMidiConnected(): boolean {
    return this._midiAccess !== null;
  }

  /** The number of MIDI inputs currently plugged in (`state === 'connected'`);
   *  0 when access is not held or nothing is connected. */
  public getMidiInputCount(): number {
    if (!this._midiAccess) return 0;
    let n = 0;
    for (const input of this._midiAccess.inputs.values()) if (input.state === 'connected') n++;
    return n;
  }

  /**
   * `warnOnFailure` is true only for the constructor's `enableMidi: true`
   * path, whose caller gets no result back. `enableMidiInput()` RETURNS the
   * outcome, so the caller decides what to tell the user, and the library only
   * logs at debug level there.
   */
  private async _initMidi(warnOnFailure: boolean): Promise<MidiEnableResult> {
    const log = warnOnFailure ? console.warn : console.debug;
    const nav = navigator as Navigator & {
      requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MIDIAccess>;
    };
    if (typeof nav.requestMIDIAccess !== 'function') {
      log('qwerty-abc-piano: Web MIDI API unavailable (not supported in Safari/iOS).');
      return { state: 'unsupported' };
    }
    try {
      const access = await nav.requestMIDIAccess({ sysex: false });
      // destroy() may have run while the permission prompt was open: a
      // destroyed instance must never attach MIDI handlers.
      if (this._destroyed) {
        return { state: 'notGranted', errorName: 'AbortError', message: 'qwerty-abc-piano: instance destroyed before MIDI access resolved' };
      }
      this._midiAccess = access as unknown as MIDIAccess;
      for (const input of access.inputs.values()) this._attachMidiInput(input as unknown as MIDIInput);
      access.onstatechange = () => {
        for (const input of access.inputs.values()) this._attachMidiInput(input as unknown as MIDIInput);
        // Plug-in AND unplug both land here.
        this._options.onMidiStateChange?.(this.getMidiInputCount());
      };
      this._options.onMidiStateChange?.(this.getMidiInputCount());
      return { state: 'connected' };
    } catch (err) {
      // KEEP the rejection's own name — it is the only signal separating "you
      // said no" from "this browser never asked you"; without it, Firefox's
      // not-yet-granted permission would be reported as a denial.
      const name = (err as { name?: string } | null)?.name;
      const message = (err as { message?: string } | null)?.message;
      const state = QWERTYToABCPiano.classifyMidiFailure(name);
      log(`qwerty-abc-piano: MIDI access ${state} (${name ?? 'unknown'}).`, err);
      return { state, errorName: name, message };
    }
  }

  /**
   * Map a `requestMIDIAccess` rejection onto the two failure states a host has
   * to tell apart. Exposed (static, pure) so the mapping is testable on its own
   * and stated in exactly one place.
   *
   * - `NotAllowedError` — the user was asked and said no. That is a REFUSAL.
   * - `SecurityError` / `AbortError` / anything else — the browser refused to
   *   even put the question, typically because the origin has not been granted
   *   the MIDI site permission yet. Firefox's Web MIDI gate is this shape. The
   *   user has granted nothing and refused nothing: NOT YET GRANTED.
   * @internal Exposed for tests; not part of the supported public API.
   */
  public static classifyMidiFailure(errorName?: string): 'refused' | 'notGranted' {
    return errorName === 'NotAllowedError' ? 'refused' : 'notGranted';
  }

  /**
   * Feed a note-on from a NATIVE MIDI source (a platform-channel bridge on
   * mobile, where Web MIDI does not exist) through the same path a touched or
   * typed note takes — so undo, chord capture, beat position and audio all
   * behave identically.
   *
   * @param noteNumber - A MIDI note number, 0–127 (60 = middle C, written `C`).
   *   Out-of-range or non-finite values are ignored.
   * @param velocity - Note-on velocity; defaults to 127. A velocity of 0 is a
   *   note-off by convention and is ignored, as on the Web MIDI path.
   */
  public noteOnFromMidi(noteNumber: number, velocity = 127): void {
    if (velocity <= 0) return;
    if (!Number.isFinite(noteNumber) || noteNumber < 0 || noteNumber > 127) return;
    const { note, octave } = midiNoteToNoteInfo(Math.round(noteNumber));
    this._handleNoteFromPitch(note, octave);
  }

  /** Handle a keystroke while a raw-ABC token is being typed. Returns true when
   * the key was consumed here; false when the buffer was flushed and the key
   * should fall through to normal note/control handling. */
  private _handleRawKey(event: KeyboardEvent): boolean {
    const k = event.key;

    // Edit the in-progress token.
    if (k === 'Backspace') {
      event.preventDefault();
      this._rawBuffer = this._rawBuffer.slice(0, -1);
      if (this._rawBuffer === '') this._endRawCapture();
      else { this._rawValid = this._rawTokenValid(this._rawBuffer); this._fireRawChange(); }
      return true;
    }
    if (k === 'Escape') {
      event.preventDefault();
      this._cancelRawCapture();
      return true;
    }

    // Self-closing token (!decoration!, "chord", {grace}): swallow every
    // printable key until the matching close delimiter completes it.
    if (this._rawClose !== null) {
      if (k.length !== 1) return true; // ignore Shift, arrows, etc.
      event.preventDefault();
      // Already closed but sitting invalid — ignore further input; edit via Backspace.
      if (this._rawBuffer.length > 1 && this._rawBuffer.endsWith(this._rawClose)) return true;
      this._rawBuffer += k;
      if (k === this._rawClose) this._tryCommitRaw();      // complete → commit or flag
      else { this._rawValid = this._rawTokenValid(this._rawBuffer); this._fireRawChange(); }
      return true;
    }

    // Barline / repeat / volta family: extend while the key belongs to the
    // barline alphabet; otherwise this key is the flush boundary.
    if (k.length === 1 && RAW_BAR_CHARS.has(k)) {
      event.preventDefault();
      this._rawBuffer += k;
      this._rawValid = this._rawTokenValid(this._rawBuffer);
      this._fireRawChange();
      return true;
    }
    // Boundary: try to commit. If it commits, let the boundary key be handled
    // normally (return false). If invalid, block the boundary key and keep editing.
    if (this._tryCommitRaw()) return false;
    event.preventDefault();
    return true;
  }

  private _onKeyDown(event: KeyboardEvent): void {
    // Mid-composition keystrokes belong to the IME, not the piano.
    if (event.isComposing) return;

    // The real origin of the key, even from inside a shadow root (where
    // `event.target` is retargeted to the shadow host).
    const target = (typeof event.composedPath === 'function' ? event.composedPath()[0] : null)
      ?? event.target;

    // Never intercept keys while the user is typing in an editable element
    if (
      target instanceof HTMLInputElement   ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement   ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) return;

    // Space / Enter on a focused button or link must activate it as usual,
    // not insert a space or start playback.
    if ((event.key === ' ' || event.key === 'Enter') &&
        target instanceof Element &&
        target.closest('button, a, [role="button"]')) return;

    // Single letters are matched case-insensitively, so Caps Lock doesn't
    // silence the keyboard. (Raw-ABC capture below still sees `event.key`
    // verbatim — a chord symbol like "Gm" is case-sensitive.)
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    // Ctrl+Z / Cmd+Z → undo (handled before the generic modifier bail-out below)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === 'z') {
      event.preventDefault();
      this.undo();
      return;
    }

    // Ignore other modifier-key combos (browser shortcuts, IME, etc.)
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // A raw-ABC token is being typed: keys build it up (and, at a boundary, may
    // flush it) rather than playing notes. `_handleRawKey` returns true when it
    // fully consumed the key; false means it flushed and the key should now be
    // processed normally by the switch below.
    if (this._rawBuffer !== '' && this._handleRawKey(event)) return;

    // Open a raw-ABC capture on a structural/decoration character (transcribe only).
    if (this._rawBuffer === '' && this._mode === 'transcribe' &&
        Object.prototype.hasOwnProperty.call(RAW_OPENERS, event.key)) {
      event.preventDefault();
      this._startRawCapture(event.key);
      return;
    }

    // Holding a note, rest or chord-bracket key must not auto-repeat it
    // (holding H would otherwise write `ccc…`).
    if (event.repeat && (NOTE_KEYS.has(key) || key === 'z' || key === '(' || key === ')')) {
      event.preventDefault();
      return;
    }

    switch (key) {
      // Duration selectors
      case '1': this.setDuration('w'); break;
      case '2': this.setDuration('h'); break;
      case '3': this.setDuration('q'); break;
      case '4': this.setDuration('e'); break;
      case '5': this.setDuration('s'); break;
      case '6': this.setDuration('t'); break;
      case '.': this.setDuration(this._duration, !this._isDotted); break;

      // Octave
      case '+': this.setOctave(this._octaveShift + 1); break;
      case '-': this.setOctave(this._octaveShift - 1); break;
      case '0': this.setOctave(0); break;

      // Mode toggle
      case 'x':
        event.preventDefault();
        this.setMode(this._mode === 'transcribe' ? 'play' : 'transcribe');
        break;

      // Insert explicit space separator (controls beaming; transcribe mode only)
      case ' ':
        event.preventDefault();
        if (this._mode === 'transcribe') {
          this._notes.push({ type: 'space' });
          this._fireEvent('change');
        }
        break;

      // Undo
      case 'Backspace':
        event.preventDefault();
        this.undo();
        break;

      // Manual barline (disabled in 'none' mode)
      case '\\':
        event.preventDefault();
        if (this._barlineMode !== 'none') this._insertManualBarline();
        break;

      // Note selection (transcribe mode only)
      case 'ArrowLeft':
        event.preventDefault();
        if (this._mode === 'transcribe') this._moveSelection(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (this._mode === 'transcribe') this._moveSelection(1);
        break;

      // Pitch adjustment for selected note (transcribe mode only)
      case 'ArrowUp':
        event.preventDefault();
        if (this._mode === 'transcribe') this.adjustSelectedPitch(1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (this._mode === 'transcribe') this.adjustSelectedPitch(-1);
        break;

      // Playback
      case 'Enter':
        this.playback();
        break;

      // Clear (with optional host confirmation)
      case 'Escape':
        if (this._options.onClearRequested) {
          this._fireEvent('clear-requested');
        } else {
          this.clear();
        }
        break;

      // Rest (current duration)
      case 'z':
        if (this._mode === 'transcribe') this._addRest();
        break;

      // Start a triplet bracket (3 notes) — Q is a gap in the black-key row,
      // so it is free for a control
      case 'q':
        if (this._mode === 'transcribe' && this._tupletRemaining === 0) {
          event.preventDefault();
          this._tupletCount     = 3;
          this._tupletRemaining = 3;
          this._notes.push({ type: 'tuplet-start', count: 3 });
          this._fireTupletChange(true, 3);
          this._fireEvent('change');
        }
        break;

      // Simultaneous (chord) mode — '(' / ')'. The ABC-style '[' / ']' are not
      // used because '[' is the G#4 black key in the spatial black-key row.
      case '(':
        event.preventDefault();
        if (this._mode === 'transcribe') this._openSimultaneous();
        break;
      case ')':
        event.preventDefault();
        if (this._mode === 'transcribe') this._commitSimultaneous();
        break;

      // Note keys (and anything else — gaps and unknown keys are silently ignored)
      default:
        // Prevent browser default actions for piano keys (e.g. Firefox's Quick
        // Find for Links bar triggered by the apostrophe key).
        if (NOTE_KEYS.has(key)) event.preventDefault();
        this._handleNoteKey(key);
    }
  }

  private _onKeyUp(event: KeyboardEvent): void {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (this._pianoTarget) unhighlightKey(this._pianoTarget, key);
  }
}

/** Shorter alias for {@link QWERTYToABCPiano}. */
export { QWERTYToABCPiano as QWERTYToABC };
