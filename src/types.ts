/**
 * A note length: `'w'` whole, `'h'` half, `'q'` quarter, `'e'` eighth,
 * `'s'` sixteenth, `'t'` thirty-second. The ABC output uses `L:1/4`, so a
 * quarter note has no length suffix.
 */
export type Duration = 'w' | 'h' | 'q' | 'e' | 's' | 't';
/**
 * The input mode. In `'transcribe'` mode every note played is appended to the
 * ABC output; in `'play'` mode the keys only sound and highlight, and nothing
 * is recorded.
 */
export type Mode = 'play' | 'transcribe';

/**
 * The outcome of asking for Web MIDI access. Besides success there are three
 * distinct failure states, so a host can tell the user accurately what to do.
 *
 * - `connected`  — access is held and inputs are attached.
 * - `unsupported`— the browser has no Web MIDI API at all (Safari, WebViews).
 * - `notGranted` — the API exists but the origin has not been granted the MIDI
 *                  site permission; the user has neither allowed nor refused.
 *                  Firefox reports this when MIDI needs a site permission that
 *                  has not been given yet. It is not a refusal.
 * - `refused`    — the user was asked and declined (`NotAllowedError`).
 *
 * `errorName` and `message` carry the underlying `DOMException`'s name and
 * message when there was one.
 */
export type MidiEnableResult =
  | { state: 'connected' }
  | { state: 'unsupported' }
  | { state: 'notGranted'; errorName?: string; message?: string }
  | { state: 'refused'; errorName?: string; message?: string };

/**
 * One entry in the transcription, in order. `note` is an internal note name
 * (`'C'`, `'F#'`; black keys are stored as sharps and respelled for the key
 * signature on output) and `octave` is the scientific-pitch octave, so C4 is
 * middle C (MIDI 60). In the ABC output, uppercase `C` is middle C and
 * lowercase `c` is C5.
 */
export type NoteEntry =
  | { type: 'note'; note: string; octave: number; duration: Duration; isDotted: boolean }
  | { type: 'rest'; duration: Duration; isDotted: boolean }
  | { type: 'barline' }
  | { type: 'space' }
  | { type: 'tuplet-start'; count: number }
  | { type: 'simultaneous'; notes: Array<{ note: string; octave: number }>; duration: Duration; isDotted: boolean }
  // Raw ABC passthrough: a literal structural/decoration token typed by an
  // ABC-fluent user (e.g. '|:', ':|2', '!trill!', '"Gm"', '{gc}'). Emitted
  // verbatim by the serializer; never produced by the piano keys themselves.
  | { type: 'raw'; text: string };

// The abcjs shapes below are STRUCTURAL and deliberately loose: parameters the
// library only passes through to abcjs are typed `any`, so that abcjs's own
// declarations (`import abcjs from 'abcjs'`) are assignable to them and
// `new QWERTYToABCPiano({ abcjs })` type-checks without a cast. Tighter
// parameter types would make abcjs's real types incompatible.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AbcjsOpaque = any;

/** The subset of abcjs's `synth.CreateSynth` instance this library uses. */
export interface AbcjsSynth {
  init(opts: AbcjsOpaque): Promise<unknown>;
  prime(): Promise<unknown>;
  start(): void;
  stop(): void;
}

/** Cursor callbacks handed to abcjs's `SynthController.load`. */
export interface AbcjsTimingCallbacksCursorControl {
  onEvent?: (event: { elements?: HTMLElement[][] }) => void;
  onFinished?: () => void;
}

/** The subset of abcjs's `SynthController` this library uses. */
export interface AbcjsSynthController {
  load(
    selector: string | Element | AbcjsOpaque,
    cursorControl?: AbcjsTimingCallbacksCursorControl | null,
    visualOptions?: {
      displayLoop?: boolean;
      displayRestart?: boolean;
      displayPlay?: boolean;
      displayProgress?: boolean;
      displayWarp?: boolean;
    } | AbcjsOpaque,
  ): void;
  // The third argument is abcjs's synth OPTIONS bag (it becomes
  // `synthControl.options`, which is handed to `midiBuffer.init`) — so it is
  // where `soundFontUrl` / `soundFontVolumeMultiplier` belong, NOT an audio
  // context. This matches abcjs 6's `setTune`.
  setTune(visualObj: AbcjsOpaque, userAction: boolean, synthOptions?: AbcjsOpaque): Promise<unknown>;
  play(): unknown;
  pause(): void;
  restart(): void;
  /** Present at runtime in abcjs 6 (stops audio and timing callbacks), though
   *  abcjs's own type declarations omit it — hence optional. */
  destroy?(): void;
}

/**
 * The subset of the abcjs module this library uses — pass the abcjs default
 * export (`import abcjs from 'abcjs'`) or the `ABCJS` global.
 */
export interface AbcjsInstance {
  renderAbc(target: string | Element | AbcjsOpaque, abcString: string, options?: AbcjsOpaque): AbcjsOpaque[];
  synth?: {
    CreateSynth: new () => AbcjsSynth;
    SynthController: new () => AbcjsSynthController;
    [key: string]: unknown;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Minimal Web MIDI API type declarations (not in TypeScript's standard DOM lib).
// Declared here to avoid a runtime dependency on @types/webmidi.
export interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array;
}

export interface MIDIInput extends EventTarget {
  readonly id: string;
  readonly name: string | null;
  /** 'connected' while the device is plugged in; 'disconnected' after it is unplugged. */
  readonly state?: 'connected' | 'disconnected';
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
  close(): Promise<void>;
}

export interface MIDIAccess extends EventTarget {
  readonly inputs: Map<string, MIDIInput>;
  onstatechange: ((event: Event) => void) | null;
}

/**
 * Options for `new QWERTYToABCPiano(options)` (and the core options accepted by
 * `mountFullUI`). Every option is optional. Callback options receive the
 * current ABC body (the notes, without the header) where they take an
 * `abcString`.
 *
 * @example
 * const piano = new QWERTYToABCPiano({
 *   keySignature: 'G',
 *   timeSignature: '3/4',
 *   pianoTarget: '#piano',
 *   notationTarget: '#notation',
 *   abcjs,
 *   onChange: (abc) => console.log(abc),
 * });
 */
export interface QWERTYToABCOptions {
  // Core settings
  /** The note duration selected at start. Default `'q'` (quarter note). */
  defaultDuration?: Duration;
  /** The mode at start. Default `'transcribe'`. */
  defaultMode?: Mode;
  /**
   * When `true`, the mode cannot be changed (by the space bar, the mode button
   * or `setMode()`). Default `false`.
   */
  lockMode?: boolean;
  /**
   * The meter, as `'N/M'` (e.g. `'3/4'`, `'6/8'`). Used for the `M:` header
   * and for automatic barlines. Default `'4/4'`. The constructor throws on a
   * string that is not a valid meter.
   */
  timeSignature?: string;
  /**
   * The key, as an ABC key name such as `'G'`, `'Bb'` or `'Em'`. Used for the
   * `K:` header and to spell black keys as sharps or flats and omit
   * accidentals the key already implies. Default `'C'`.
   */
  keySignature?: string;
  /**
   * The clef for the ABC output and the rendered notation: `'treble'`,
   * `'bass'`, `'alto'` or `'tenor'`. Default `'treble'`.
   */
  clef?: string;
  /**
   * Deprecated alias for {@link QWERTYToABCOptions.barlineMode}: `false` means
   * `'manual'`. Ignored when `barlineMode` is given. Default `true`.
   */
  autoBarline?: boolean;
  /**
   * Length of a pickup (anacrusis) measure in quarter-note beats; the first
   * automatic barline falls after this many beats instead of a full measure.
   * Default `0` (no pickup).
   */
  pickupBeats?: number;
  /**
   * Request Web MIDI access on init (at construction) so a connected MIDI
   * keyboard is picked up immediately. Defaults to `false` because this fires
   * the browser's MIDI permission prompt on load. Prefer leaving it off and
   * calling `enableMidiInput()` from a user gesture (mountFullUI renders a
   * MIDI icon whose click does exactly this).
   */
  enableMidi?: boolean;
  /**
   * `'black'` renders the notation fully black on a white background, so it
   * is legible on any page colour; `'default'` leaves abcjs's own colours.
   * Default `'black'`.
   */
  notationTheme?: 'default' | 'black';
  /**
   * How barlines are inserted: `'auto'` adds one whenever a measure fills;
   * `'manual'` only when the user presses `\` or `insertBarline()` is called
   * (overfull measures are reported via `onMeasureOverflow`); `'none'` never
   * adds them. Default `'auto'`.
   */
  barlineMode?: 'auto' | 'manual' | 'none';
  /**
   * Start a new line in the ABC output after every N barlines. Default `4`;
   * `0` disables automatic line breaks.
   */
  measuresPerLine?: number;
  /**
   * Element (or CSS selector) that shows a "CHORD (n notes)" indicator while
   * a simultaneous-note group is open. Default `null` (no indicator).
   */
  simultaneousTarget?: string | Element | null;
  /**
   * Fires when a simultaneous-note (chord) group opens, gains a note, or
   * closes. `noteCount` is the number of notes collected so far.
   */
  onSimultaneousChange?: ((active: boolean, noteCount: number) => void) | null;
  /** Attach touch listeners to the on-screen piano. Default `true`. */
  enableTouch?: boolean;
  /**
   * Reserved, not yet implemented — accepted (so existing callers keep
   * type-checking) but currently has no effect.
   */
  touchGlide?: boolean;
  /** Show the QWERTY letters on the on-screen piano keys. Default `true`. */
  showKeyLabels?:  boolean;
  /** Show note names below the on-screen piano's white keys. Default `true`. */
  showNoteNames?:  boolean;
  /**
   * Rhythm-only input: the piano is replaced by a TAP button, the mode button
   * is hidden, and every note key and tap records the same fixed pitch, B4
   * (written `B`, the middle line of the treble staff). Default `false`.
   */
  percussionMode?:  boolean;

  // UI targets. Each is an Element or a CSS selector; the default `null`
  // renders nothing for that part.
  /** Where to render the on-screen piano keyboard (or the TAP button in percussion mode). */
  pianoTarget?: string | Element | null;
  /** Where to render the duration, dot and rest buttons. */
  durationTarget?: string | Element | null;
  /** Where to render the play/transcribe mode button (hidden in percussion mode). */
  modeTarget?: string | Element | null;
  /** Where to render the notation with abcjs. Requires `abcjs`. */
  notationTarget?: string | Element | null;
  /**
   * Where to mount abcjs's `SynthController` playback controls. Requires
   * `abcjs` and `abcjsAudioContext`; include abcjs's `abcjs-audio.css` for
   * styling.
   */
  playbackTarget?: string | Element | null;
  /** Where to render the triplet button. */
  tupletTarget?: string | Element | null;

  // abcjs integration
  /**
   * The abcjs module (`import abcjs from 'abcjs'`) or the `ABCJS` global.
   * Needed for notation rendering and playback. Default `null`.
   */
  abcjs?: AbcjsInstance | null;
  /** Options forwarded to `abcjs.renderAbc()`. Default `{}`. */
  abcjsRenderOptions?: Record<string, unknown>;
  /**
   * The `AudioContext` abcjs's synth plays through, for per-note audio
   * feedback and playback. Without it the piano is silent. Default `null`.
   */
  abcjsAudioContext?: AudioContext | null;
  /**
   * Options forwarded to abcjs's synth when a tune is handed to the playback
   * transport (`SynthController.setTune`) or played directly. This is how a
   * host points the synth at its OWN soundfont (`soundFontUrl`) and volume
   * multiplier instead of abcjs's default CDN font. Optional; omit for the
   * abcjs defaults.
   */
  synthOptions?: Record<string, unknown>;
  /**
   * Playback tempo in BPM, counted in quarter notes (the header emits
   * `Q:1/4=<bpm>` alongside `L:1/4`). `null`/omitted leaves the header without
   * a `Q:` line, so abcjs plays at its own default. Hosts that let the user
   * set a tempo elsewhere push it in here (or call `setTempo()`), so a
   * transcription plays back at the tempo it was heard at.
   */
  tempoBpm?: number | null;
  /**
   * The starting octave shift for the QWERTY keys and on-screen piano, from −2
   * to +2 (default 0: the home row spans E3–A4, with H = middle C). Use `1` when
   * the material sits around C5, e.g. fiddle tunes. The user can still change it
   * with the octave keys; `setOctave()` changes it programmatically.
   */
  octaveShift?: number;

  // Callbacks
  /** Fires when a single note is recorded; `lastNote` is its ABC token (e.g. `'^F/2'`). */
  onNoteAdded?: ((abcString: string, lastNote: string) => void) | null;
  /** Fires when undo (Backspace or `undo()`) removes a note or rest. */
  onNoteDeleted?: ((abcString: string) => void) | null;
  /** Fires when the mode changes. */
  onModeChange?: ((mode: Mode) => void) | null;
  /** Fires when a barline is inserted, automatically or manually. */
  onBarlineInserted?: ((abcString: string) => void) | null;
  /** Fires on any change to the notation. */
  onChange?: ((abcString: string) => void) | null;
  /** Fires when playback is requested (Enter or `playback()`). */
  onPlayback?: (() => void) | null;
  /**
   * Fires when Escape is pressed. When set, Escape no longer clears the
   * transcription by itself, so the host can confirm first and then call
   * `clear()`.
   */
  onClearRequested?: (() => void) | null;
  /** Fires when the selected note changes; `null` when nothing is selected. */
  onSelectionChange?: ((index: number | null) => void) | null;
  /**
   * Fires in `'manual'` or `'none'` barline mode when the current measure holds
   * more beats than the time signature allows. Both values are in quarter-note
   * beats.
   */
  onMeasureOverflow?: ((beats: number, maxBeats: number) => void) | null;
  /**
   * Fires when triplet mode starts, after each note inside it, and when it
   * closes. `remaining` is the number of notes still to enter.
   */
  onTupletChange?: ((active: boolean, remaining: number) => void) | null;
  /**
   * Fires while the user is typing a raw ABC token (barline/repeat/volta or a
   * `!decoration!`, `"chord"` or `{grace}`). `buffer` is the in-progress text
   * (`''` when no capture is active); `valid` is whether it currently parses.
   * Hosts can surface a live "…✓ / ✗ invalid" indicator from this.
   */
  onRawChange?: ((buffer: string, valid: boolean) => void) | null;
  /**
   * Fires with the number of MIDI inputs that are actually plugged in
   * (`state === 'connected'`) when Web MIDI access is granted and whenever a
   * device is connected or disconnected afterwards. Access being granted with
   * nothing plugged in reports `0`. See also `getMidiInputCount()`.
   */
  onMidiStateChange?: ((connectedInputs: number) => void) | null;
}
