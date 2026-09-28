# qwerty-abc-piano

A lightweight TypeScript/JavaScript library that turns your QWERTY keyboard into a piano and outputs [ABC notation](https://abcnotation.com/) in real time. Works standalone (ABC text only) or with [abcjs](https://paulrosen.github.io/abcjs/) for notation rendering and playback.

## Install

```bash
npm install qwerty-abc-piano
# optional peer dependency, for notation rendering and audio:
npm install abcjs
```

The package ships an ES module (`import`), a CommonJS build (`require`) and TypeScript declarations. It needs a DOM to construct (it listens on `document`); importing it in Node is side-effect free.

## Usage

There are two ways to use this library:

| Approach | When to use |
|---|---|
| **Drop-in UI** (`mountFullUI`) | You want a fully working instrument embedded in one call — no DOM wiring required |
| **Manual wiring** (`new QWERTYToABCPiano`) | You want a custom layout, your own styling, or fine-grained control over which components appear |

Both give you a `QWERTYToABCPiano` instance, so all public methods (`getABC()`, `setKeySignature()`, etc.) work identically either way. **Call `destroy()` when you are done** — before re-mounting, or when removing the UI — to remove its document keyboard listeners.

### Drop-in UI (`mountFullUI`)

`mountFullUI` creates the full instrument inside a single container element. It contains two switchable **instrument shells**:

- **Piano shell** — the SVG piano keyboard with a TRANSCRIBE/PLAY mode toggle
- **Percussion shell** — a large TAP button for rhythm-only input at a fixed pitch (B4, written `B` on a one-line percussion staff)

A **Piano / Percussion** pill toggle at the top switches between shells; each shell keeps its own notes across switches.

Shared across both shells: duration buttons (with note-symbol icons), dot toggle, rest toggle, triplet button, undo / clear buttons, notation area, playback controls, a small **MIDI icon**, a **`?` help** fold-out and a collapsible **⚙ Advanced** panel (Key, Clef, Time, Barlines, display toggles).

```html
<!-- abcjs is a peer dependency, not bundled -->
<script src="https://cdn.jsdelivr.net/npm/abcjs@6.6.3/dist/abcjs-basic.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/abcjs@6.6.3/abcjs-audio.css" />

<div id="piano-app"></div>
```

```js
import { mountFullUI } from 'qwerty-abc-piano';

const audioCtx = new AudioContext();
document.addEventListener('keydown',
  () => audioCtx.state === 'suspended' && audioCtx.resume(),
  { capture: true, passive: true }
);

const piano = mountFullUI('#piano-app', {
  abcjs:             ABCJS,
  abcjsAudioContext: audioCtx,
  abcjsRenderOptions: { responsive: 'resize', add_classes: true },
  onChange: (abc) => console.log(abc),
});

// The returned instance has the full public API…
piano.getABC();
piano.setKeySignature('G');
// …plus a handle that keeps the mounted chrome in step (see below)
piano.fullUI.setTimeSignature('3/4');

// Before re-mounting or removing the UI:
piano.destroy();
```

#### `mountFullUI` signature

```ts
mountFullUI(
  container: string | Element,     // CSS selector or DOM element
  options?: MountFullUIOptions,    // every QWERTYToABCOptions except the *Target options, plus the table below
): MountedFullUI                   // QWERTYToABCPiano & { fullUI: MountFullUIHandle }
```

`destroy()` on the returned instance also empties the container. Mounting again into the same container destroys the previous instance automatically, but call `destroy()` yourself first.

The `fullUI` handle:

| Member | Description |
|---|---|
| `setTimeSignature(ts)` | Sets the meter **and** moves the Advanced panel's Time highlight |
| `setKeySignature(ks)` | Sets the key **and** moves the Advanced panel's Key highlight |
| `connectMidi(): Promise<boolean>` | Requests Web MIDI access and reflects the outcome in the MIDI icon and help panel; resolves `true` when access is held |

#### `mountFullUI` options

`mountFullUI` accepts all [constructor options](#constructor-options) except the `*Target` ones (it creates those itself), plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `percussionMode` | `boolean` | `false` | Start in the Percussion shell instead of the Piano shell |
| `shellToggle` | `boolean` | `true` | Show the Piano / Percussion toggle bar. `false` locks the UI to whichever shell `percussionMode` specifies |
| `midiButton` | `boolean` | `true` | Show the MIDI icon (see [Enabling MIDI](#enabling-midi)). Shown when `showAdvanced` is on or `enableMidi: true`. `false` hides it entirely |
| `showHelp` | `boolean` | `true` | Show the `?` button that folds out the help panel (MIDI status and icon legend, keyboard shortcuts, link to the full reference). Independent of `showAdvanced`. With `false` the MIDI icon can still open a panel holding just its MIDI section |
| `helpUrl` | `string` | `'https://propellamstudios.com'` | Target of the help panel's "Full reference" link (opens in a new tab) |
| `escapeClears` | `boolean` | `false` | Let `Escape` clear the whole transcription. By default `Escape` does nothing in a mounted UI; if `onClearRequested` is set, `Escape` calls it instead (the host decides, e.g. after confirming). The on-screen Clear button always works |
| `showDurations` | `boolean` | `true` | Render the duration palette (whole … 32nd, dot, rest) |
| `showTuplet` | `boolean` | `true` | Render the TRIPLET button |
| `showTransport` | `boolean` | `true` | Render the playback transport (play / progress) |
| `showAdvanced` | `boolean` | `true` | Render the ⚙ Advanced toggle and panel (and, unless `enableMidi: true`, the MIDI icon) |
| `showNotation` | `boolean` | `true` | `false` omits the abcjs notation panel entirely |
| `notationPosition` | `'top' \| 'bottom'` | `'bottom'` | `'top'` moves the notation panel (and the transport with it) above the keyboard and controls |
| `letterReadout` | `boolean` | `false` | Show the entered notes as letters **in play order** (repeats included, most recent highlighted) |
| `compactChrome` | `boolean` | `false` | Tighten the non-keyboard chrome so the keyboard gets the room |
| `touchRange` | `'auto' \| false \| { low, high }` | `'auto'` | Touch keyboard range: `'auto'` picks the board from the mount width; `{ low, high }` pins it; `false` keeps the QWERTY layout |

The undo / clear edit row is always rendered. Initial values for the Advanced panel come from the core options (`keySignature`, `clef`, `timeSignature`, `barlineMode`, `measuresPerLine`, `showNoteNames`, `showKeyLabels`).

Examples:

```js
// Start in percussion mode, allow switching back to piano
mountFullUI('#app', { percussionMode: true });

// Lock to percussion only — no toggle bar shown
mountFullUI('#app', { percussionMode: true, shellToggle: false });

// Lock to piano only, bass clef
mountFullUI('#app', { shellToggle: false, clef: 'bass' });

// Minimal exercise mount: no staff, a letter readout instead, no power tools
mountFullUI('#app', {
  showNotation: false, letterReadout: true, compactChrome: true,
  showDurations: false, showTuplet: false, showTransport: false, showAdvanced: false,
});
```

**Touch devices:** on a phone or tablet, `mountFullUI` detects touch automatically and switches the keyboard to a **pitch-labelled range keyboard** instead of the QWERTY-mapped E3–A4 layout. The board is **width-aware**: it measures the mount element and renders **one octave (C4–B4)** below 680 px — where a two-octave board's keys would fall under the 44 px touch target — and the **two-octave board (C4–B5)** above it, re-picking on resize. A container of unknown width (0, e.g. a platform view that is not laid out yet) gets the two-octave default.

Below the keyboard sit an **◀ 8ve / 8ve ▶** pair, which moves the whole window by an octave without changing its span, and the **Low / High** steppers, which change the span (limits: C2–B6, minimum one octave). Both are disabled — never hidden — at their limits. Range keys are **absolute** pitches: the key labelled C4 always sounds C4, so the ±2 octave *shift* (and its dot row) applies only to the QWERTY layout.

Tap keys to enter notes; hold two fingers down simultaneously to enter a chord. All buttons meet the 44×44 px minimum touch target size.

```js
// Pin the window (skips the width-aware pick)
mountFullUI('#app', { touchRange: { low: 'C3', high: 'B3' } });

// Keep the QWERTY layout even on a touch device
mountFullUI('#app', { touchRange: false });

// Minimal mount for an exercise that asks for notes, not notation:
// no staff, a play-ordered letter readout in its place, tighter chrome
mountFullUI('#app', { showNotation: false, letterReadout: true, compactChrome: true });
```

| Option | Default | Effect |
|---|---|---|
| `touchRange` | `'auto'` | `'auto'` picks the board from the mount width; `{low, high}` pins it; `false` keeps the QWERTY layout |
| `showNotation` | `true` | `false` omits the abcjs notation/transcription panel entirely |
| `letterReadout` | `false` | `true` shows the entered notes as letters **in play order** (repeats included, most recent highlighted) |
| `compactChrome` | `false` | `true` tightens the non-keyboard chrome so the keyboard gets the room |

```js
// Pin the window (skips the width-aware pick)
mountFullUI('#app', { touchRange: { low: 'C3', high: 'B3' } });

// Keep the QWERTY layout even on a touch device
mountFullUI('#app', { touchRange: false });
```

The TAP button in Percussion mode works on touch with no extra configuration. See [`demo_dropin_ui.html`](demo_dropin_ui.html) for a working example.

### Manual wiring (`new QWERTYToABCPiano`)

If you want a custom layout or only need specific components, wire targets yourself:

#### ABC output only (no abcjs required)

```js
import { QWERTYToABCPiano } from 'qwerty-abc-piano';

const piano = new QWERTYToABCPiano({
  onChange: (abc) => console.log(abc),
});

// User types H J K L → notes appear in the ABC string (4/4, auto barlines)
// piano.getABC()      → 'CDEF|'
// piano.getFullABC()  → 'X:1\nT:Transcription\nM:4/4\nL:1/4\nK:C\nCDEF|\n'

// Clean up when done
piano.destroy();
```

#### With abcjs (notation rendering + audio)

```html
<script src="https://cdn.jsdelivr.net/npm/abcjs@6.6.3/dist/abcjs-basic.js"></script>

<div id="notation"></div>
<div id="piano"></div>
<div id="mode"></div>
<div id="duration"></div>
```

```js
import { QWERTYToABCPiano } from 'qwerty-abc-piano';

// Create AudioContext at startup — it begins in 'suspended' state.
// Browser autoplay policy requires the context to be resumed inside a user gesture.
const audioCtx = new AudioContext();
document.addEventListener('keydown', () => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
}, { capture: true, passive: true });

const piano = new QWERTYToABCPiano({
  // Notation re-renders automatically on every keystroke
  abcjs:              ABCJS,
  notationTarget:     document.getElementById('notation'),
  abcjsRenderOptions: { responsive: 'resize' },

  // AudioContext enables per-note audio feedback and Enter playback
  abcjsAudioContext: audioCtx,

  // Optional UI components rendered by the library
  pianoTarget:    document.getElementById('piano'),
  modeTarget:     document.getElementById('mode'),
  durationTarget: document.getElementById('duration'),

  onChange: (abc) => console.log(abc),
});
```

> **AudioContext note:** `AudioContext` starts in a `suspended` state when created at page load. Calling `audioCtx.resume()` inside any user-gesture handler (keydown, click, etc.) unlocks it. Using `{ capture: true }` ensures the resume fires before the library's key handler, which is important for the very first keypress.

---

## Key mapping

### Note keys

```
Top row (black keys + Q):   Q    W  E  R  T  Y    U  I  O  P  [
                            (3)  —  F♯ G♯ A♯ —    C♯ D♯ —  F♯ G♯
                                    3  3  3        4  4     4  4

Home row (white keys):  A  S  D  F  G  H  J  K  L  ;  '
                        E  F  G  A  B  C  D  E  F  G  A
                        3  3  3  3  3  4  4  4  4  4  4
```

`H` is always middle C (C4), written `C` in the ABC. Output follows standard
ABC 2.1, the convention abcjs plays: `C` is middle C, `c` is the octave above,
and each `'` or `,` moves an octave (so the home row E3–A4 is written `E,`…`A`).
Versions before 0.3.0 wrote everything one octave higher (`c` for middle C).
Each black key sits one QWERTY position to the
**right** of the white key it follows, matching the physical stagger of a real
keyboard so it visually lands between its two white neighbours. `W`, `Y`, and
`O` are gap keys — there is no black key at those piano positions — and `Q`
starts a triplet (see below). Use `+` / `−` to shift all keys up or down by one
octave (clamped to ±2). Accidentals are handled automatically based on the
current key signature.

Letter keys are case-insensitive (Caps Lock does not matter), holding a note, rest or chord key does not auto-repeat, and keys typed into an `<input>`, `<textarea>`, `<select>` or contenteditable element are ignored. `Space` / `Enter` on a focused button or link activate it as usual.

> **Touch mode:** the fixed QWERTY range and the ±2 octave shift do not apply on touch devices. `mountFullUI` renders a range keyboard instead (one or two octaves from C4, picked from the mount width), where the keys are pitch-labelled rather than QWERTY-labelled and sound exactly the pitch on the label. Use the ◀ 8ve / 8ve ▶ pair, the Low / High steppers, or `setTouchKeyRange()` to change the range.

### Duration keys

| Key | Duration | ABC output (base unit `L:1/4`) |
|---|---|---|
| `1` | Whole | `C4` |
| `2` | Half | `C2` |
| `3` | Quarter *(default)* | `C` |
| `4` | Eighth | `C/2` |
| `5` | Sixteenth | `C/4` |
| `6` | Thirty-second | `C/8` |
| `.` | Toggle dot | multiplies length by 3/2 (e.g. dotted quarter → `C3/2`) |

### Control keys

| Key | Action |
|---|---|
| `X` | Toggle transcribe / play mode |
| `Space` | Insert explicit space separator (breaks beaming; transcribe mode only) |
| `Q` | Start a triplet bracket — the next 3 notes are grouped as `(3` in ABC (transcribe mode only) |
| `(` | Open simultaneous-note group (chord entry; transcribe mode only) |
| `)` | Close and commit the simultaneous-note group, e.g. `[ceg]` |
| `+` / `−` | Octave shift up / down (±1, clamped to ±2) |
| `0` | Reset octave to default |
| `Z` | Insert one rest immediately at current duration |
| `\` | Insert barline manually (disabled in `barlineMode: 'none'`) |
| `Backspace` | Undo last note, rest, barline, space, triplet start, or simultaneous group |
| `Ctrl+Z` / `⌘+Z` | Undo last note, rest, barline, space, triplet start, or simultaneous group |
| `Enter` | Start/restart playback (needs `abcjs` + `abcjsAudioContext`) |
| `Escape` | `new QWERTYToABCPiano`: clear all notes (or call `onClearRequested` instead, if set). `mountFullUI`: does nothing unless `escapeClears: true` or `onClearRequested` is set |
| `←` / `→` | Move note selection cursor (transcribe mode) |
| `↑` / `↓` | Raise / lower selected note by one half-step (transcribe mode) |

### Raw ABC passthrough (structure & decorations)

ABC-fluent users can type structural tokens and decorations directly — they
don't collide with the note keys. Typing an **opener** character silently starts
a *raw capture*; subsequent keys build the token up instead of playing notes,
and it's re-validated against abcjs on every keystroke (an invalid token is
never committed — it stays editable until fixed). `mountFullUI` surfaces the
in-progress token and its validity in a top-bar indicator; wire your own via the
[`onRawChange`](#constructor-options) callback.

| Opener | Produces | Notes |
|---|---|---|
| `\|` | barline · `\|:` · `\|\|` · `\|]` · `\|1` (volta) | flushes when you play the next note; extends with `: \| ] ` and digits |
| `:` | `:\|` · `:\|2` · `::` | repeat end / double repeat |
| `!` | `!trill!`, `!turn!`, `!fermata!`, … | self-closing — captures the inner letters literally until the closing `!` |
| `"` | `"Gm"` chord symbol | self-closing on `"` |
| `{` | `{gc}` grace notes | self-closing on `}` |

`Backspace` edits the in-progress token; `Escape` cancels it. Committed tokens
round-trip through `getABC()` / `setABC()` verbatim.

---

## Constructor options

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultDuration` | `'w'\|'h'\|'q'\|'e'\|'s'\|'t'` | `'q'` | Initial note duration |
| `defaultMode` | `'transcribe'\|'play'` | `'transcribe'` | Initial mode |
| `lockMode` | `boolean` | `false` | Prevent mode changes |
| `keySignature` | `string` | `'C'` | Key signature (e.g. `'G'`, `'Bb'`, `'Em'`) |
| `timeSignature` | `string` | `'4/4'` | Time signature |
| `clef` | `string` | `'treble'` | Clef for ABC output and notation display: `'treble'`, `'bass'`, `'alto'`, `'tenor'` |
| `barlineMode` | `'auto'\|'manual'\|'none'` | `'auto'` | Barline behaviour: auto-insert, manual-only (`\` key), or none at all |
| `autoBarline` | `boolean` | `true` | Deprecated alias for `barlineMode`; `false` maps to `'manual'` |
| `pickupBeats` | `number` | `0` | Pickup measure length in quarter-note beats |
| `tempoBpm` | `number\|null` | `null` | Playback tempo in quarter-note BPM, written as `Q:1/4=<bpm>`; `null` omits `Q:` (abcjs default speed). See `setTempo()` |
| `octaveShift` | `number` | `0` | Starting octave shift for the QWERTY keys, −2 to +2. Use `1` when the material sits around C5 (fiddle tunes): H then plays C5. Users can still change it with `+` / `−`; see `setOctave()` |
| `percussionMode` | `boolean` | `false` | Record all input at a fixed pitch (B4, written `B`) — note keys and the TAP button route to the same note; mode toggle is hidden |
| `notationTheme` | `'black'\|'default'` | `'black'` | `'black'` forces fully black SVG notation on a white background; `'default'` leaves abcjs colours unchanged |
| `enableMidi` | `boolean` | `false` | Request Web MIDI access **at construction** (fires the permission prompt on load). Prefer `enableMidiInput()` from a user gesture — see [Enabling MIDI](#enabling-midi) |
| `pianoTarget` | `string\|Element\|null` | `null` | Mount point for SVG piano keyboard |
| `durationTarget` | `string\|Element\|null` | `null` | Mount point for duration buttons |
| `modeTarget` | `string\|Element\|null` | `null` | Mount point for mode toggle button |
| `notationTarget` | `string\|Element\|null` | `null` | Mount point for abcjs notation rendering |
| `playbackTarget` | `string\|Element\|null` | `null` | Mount point for the abcjs `SynthController` playback UI. Requires `abcjs` and `abcjsAudioContext`. Include `abcjs-audio.css` for styling |
| `tupletTarget` | `string\|Element\|null` | `null` | Mount point for the triplet button |
| `simultaneousTarget` | `string\|Element\|null` | `null` | Mount point for the simultaneous-note (chord) indicator |
| `abcjs` | `AbcjsInstance\|null` | `null` | The abcjs module (`import abcjs from 'abcjs'`) or the `ABCJS` global |
| `abcjsRenderOptions` | `object` | `{}` | Options forwarded to `abcjs.renderAbc()` |
| `abcjsAudioContext` | `AudioContext\|null` | `null` | AudioContext for per-note audio feedback and Enter playback |
| `synthOptions` | `object` | `{}` | Options forwarded to abcjs's synth (`SynthController.setTune` / `CreateSynth.init`) — e.g. your own `soundFontUrl` |
| `measuresPerLine` | `number` | `4` | Insert a line break in the ABC output after every N barlines. `0` disables auto line breaks |
| `enableTouch` | `boolean` | `true` | Attach touch listeners to the piano SVG |
| `touchGlide` | `boolean` | `false` | **Reserved, not yet implemented** — accepted but currently has no effect |
| `showKeyLabels` | `boolean` | `true` | Show QWERTY letter labels on piano keys |
| `showNoteNames` | `boolean` | `true` | Show note name labels (C, D, E…) below white keys |
| `onNoteAdded` | `(abc, lastNote) => void` | — | Fired when a note is added |
| `onNoteDeleted` | `(abc) => void` | — | Fired when a note is undone |
| `onChange` | `(abc) => void` | — | Fired on any notation change |
| `onModeChange` | `(mode) => void` | — | Fired when mode changes |
| `onBarlineInserted` | `(abc) => void` | — | Fired when a barline is inserted (auto or manual) |
| `onPlayback` | `() => void` | — | Fired when playback is requested (Enter or `playback()`) |
| `onClearRequested` | `() => void` | — | Fired when Escape is pressed; when set, Escape does not clear by itself |
| `onSelectionChange` | `(index: number\|null) => void` | — | Fired when the note selection cursor moves |
| `onMeasureOverflow` | `(beats, maxBeats) => void` | — | Fired when a measure exceeds the time signature in `manual`/`none` mode |
| `onTupletChange` | `(active: boolean, remaining: number) => void` | — | Fired when triplet mode starts, counts down, and closes |
| `onSimultaneousChange` | `(active: boolean, noteCount: number) => void` | — | Fired when a simultaneous-note group opens, changes, or closes |
| `onRawChange` | `(buffer: string, valid: boolean) => void` | — | Fired while a raw ABC token is being typed (`buffer` is `''` when none is active); `valid` reflects whether it currently parses |
| `onMidiStateChange` | `(connectedInputs: number) => void` | — | Fired with the number of MIDI inputs actually plugged in, when access is granted and whenever a device is connected or disconnected |

---

## Public methods

```ts
// Notation
getABC(): string                               // 'CDEF|'
getFullABC(opts?: { title?: string }): string  // full ABC tune with X:/T:/M:/[Q:]/L:/K: header
setABC(abc: string): void                      // parse and replace notation (unknown tokens kept verbatim)
clear(): void                                  // empty the notation
undo(): void                                   // remove last note/rest/barline/space/chord
getNoteLetters(): string[]                     // note letters in play order, e.g. ['C', 'E', 'G#']

// Mode
getMode(): 'transcribe' | 'play'
setMode(mode: 'transcribe' | 'play'): void

// Key / clef / time / tempo
setKeySignature(ks: string): void   // e.g. 'G', 'Bb', 'Em' — re-renders notation
setClef(clef: string): void         // 'treble' | 'bass' | 'alto' | 'tenor' — re-renders notation
setTimeSignature(ts: string): void  // e.g. '3/4', '6/8'; throws on an invalid meter (the current one is kept)
setTempo(bpm: number | null): void  // quarter-note BPM (Q:1/4=bpm); null removes Q:. Applies from the next play
getTempo(): number | null

// Duration & input modes
getDuration(): Duration
getIsDotted(): boolean
setDuration(duration: Duration, isDotted?: boolean): void  // while a chord is open, also re-times that chord
getRestMode(): boolean
setRestMode(on: boolean): void      // when on, piano key presses insert rests instead of notes
insertRest(): void                  // insert one rest immediately (same as pressing Z)

// Percussion
setPercussionMode(on: boolean): void  // switch percussion mode at runtime (no DOM work — the mount manages display)
tap(): void                           // record one note at the fixed percussion pitch (B4, 'B'); no-op when not in percussion mode

// Chord (simultaneous) entry — keyboard-free, for touch / WebView hosts
openChord(): void      // begin a chord group (like the '(' key); no-op in percussion or play mode, or if already open
commitChord(): void    // close the group, writing one [ceg] token (like the ')' key); no-op if no chord is open
cancelChord(): void    // abandon the open group without writing; no-op if no chord is open
isChordOpen(): boolean // true while a chord group is open

// Octave
getOctave(): number                   // current shift, −2…+2
setOctave(shift: number): void        // clamped to −2…+2

// Note selection & pitch editing
selectNote(index: number | null): void
adjustSelectedPitch(delta: number): void  // raise/lower selected note by half-steps

// Triplets
startTriplet(): void    // same as pressing Q
cancelTriplet(): void   // cancel if no notes entered yet

// Barlines & layout
setBarlineMode(mode: 'auto' | 'manual' | 'none'): void
setMeasuresPerLine(n: number): void  // 0 = disabled
insertBarline(): void                // same as pressing \ (respects barlineMode)

// Touch keyboard range
setTouchKeyRange(low: string | null, high: string | null): void
// Re-renders the piano keyboard to cover a custom pitch range ("C3", "F#4", "B5").
// Pass null for both to reset to the default QWERTY layout (E3–A4).
// No-op in percussion mode or when no piano target is configured.

// Display (piano SVG) — remembered across re-renders
setShowKeyLabels(show: boolean): void
setShowNoteNames(show: boolean): void

// MIDI
static isMidiSupported(): boolean              // does this browser have Web MIDI at all?
enableMidiInput(): Promise<MidiEnableResult>   // { state: 'connected' | 'unsupported' | 'notGranted' | 'refused', … }
isMidiConnected(): boolean                     // access grant held (NOT the same as a device being plugged in)
getMidiInputCount(): number                    // MIDI inputs currently plugged in
noteOnFromMidi(noteNumber: number, velocity?: number): void  // feed a note-on from a native bridge (60 = middle C)

// Playback
playback(): void   // fires onPlayback, then plays via abcjs if configured

// Cleanup
destroy(): void    // remove listeners and rendered UI (and, for mountFullUI, empty the container)
```

`MidiEnableResult` is `{ state: 'connected' } | { state: 'unsupported' } | { state: 'notGranted' | 'refused'; errorName?: string; message?: string }`. `notGranted` means the browser never asked (e.g. Firefox before the site permission is granted); `refused` means the user said no.

Exported types: `QWERTYToABCOptions`, `Duration`, `Mode`, `NoteEntry`, `MidiEnableResult`, `MountFullUIOptions`, `MountFullUIHandle`, `MountedFullUI`, `AbcjsInstance`, `AbcjsSynthController`. `VERSION` holds the package version.

---

## Custom DOM events

The library dispatches these events on `document`:

| Event | Detail |
|---|---|
| `qwerty-abc-piano:change` | `{ abc }` |
| `qwerty-abc-piano:note-added` | `{ abc, lastNote }` |
| `qwerty-abc-piano:note-deleted` | `{ abc }` |
| `qwerty-abc-piano:mode-change` | `{ abc, mode }` |
| `qwerty-abc-piano:barline` | `{ abc }` — fired when a barline is inserted (auto or manual) |
| `qwerty-abc-piano:playback` | `{ abc }` — fired when playback is requested (Enter or `playback()`) |
| `qwerty-abc-piano:clear-requested` | `{ abc }` — fired when Escape is pressed but does not clear by itself (`onClearRequested` is set, or a `mountFullUI` mount without `escapeClears`) |
| `qwerty-abc-piano:duration-change` | `{ abc, duration, isDotted }` |
| `qwerty-abc-piano:measure-overflow` | `{ abc, beats, maxBeats }` — fired in `manual`/`none` mode when a measure exceeds the time signature |
| `qwerty-abc-piano:tuplet-change` | `{ active, remaining }` — fired when a triplet bracket opens, counts down, or closes |
| `qwerty-abc-piano:simultaneous-change` | `{ active, noteCount }` — fired when a chord group opens, buffers a note, or commits/cancels |

---

## Enabling MIDI

Web MIDI requires a browser permission prompt, and that prompt can only be triggered by calling
`requestMIDIAccess()` — there is **no way to defer it until a device is plugged in**, since detecting
devices itself requires access. So MIDI is **opt-in via a user gesture** rather than requested on load:

- **`mountFullUI`** shows a small **MIDI icon** (`.qap-midi-indicator`, 🎹 with a state dot) in the top bar. Its `data-state` is:

  | State | Looks | Meaning |
  |---|---|---|
  | `idle` | grey outline | Access not requested yet. **Click to connect** (fires the prompt) |
  | `pending` | pulsing dot | Waiting for the browser's permission prompt |
  | `no-device` | amber | Access granted, but no MIDI keyboard is plugged in |
  | `connected` | green | At least one MIDI keyboard is plugged in |
  | `notGranted` / `refused` | red | A request the user made failed (site permission not granted / declined). Click to ask again |
  | `unsupported` | greyed, struck through | This browser has no Web MIDI |

  In any state other than `idle` / `notGranted` / `refused`, clicking the icon opens the help panel at its **MIDI keyboard** section, which holds the live status sentence (`.qap-midi-status`, `aria-live="polite"`), a legend of the icon states and how to enable MIDI. A failed request the user made opens that section automatically. Pass `midiButton: false` to hide the icon.
- **`enableMidi: true`** on `mountFullUI` requests access at mount. If that attempt fails, nothing is announced — the user never asked — and the icon simply stays `idle`, ready to be clicked.
- **Programmatic** (`QWERTYToABCPiano` directly): call `await piano.enableMidiInput()` from your own gesture handler; it returns a `MidiEnableResult` (`result.state`). Use `getMidiInputCount()` / `onMidiStateChange` to know whether a device is actually plugged in.

---

## Embedding in a native WebView (mobile)

The library runs unchanged inside a mobile app's WebView (e.g. Flutter `webview_flutter` → WKWebView on
iOS, Android WebView). A native host can't pass a JS function reference across the bridge or read a
return value synchronously, so use these two patterns. A complete working example is in
[`demo_webview.html`](./demo_webview.html).

**1. Expose the instance on a global handle** so the host can call methods by evaluating JS:

```js
window.__qap = mountFullUI('#full-ui', { abcjs: ABCJS, keySignature: 'C' });
```

The host drives it with fire-and-forget calls and reads the answer asynchronously:

```dart
// Flutter (webview_flutter)
await controller.runJavaScript('window.__qap.openChord()');   // Dart → JS
await controller.runJavaScript('window.__qap.commitChord()');
final abc = await controller.runJavaScriptReturningResult(    // read back (async, not sync)
  'window.__qap.getFullABC()',
);
```

The `openChord()` / `commitChord()` / `cancelChord()` methods let a **native button** drive chord entry
without a physical keyboard — the keyboard-free equivalent of the `(` / `)` keys. A native MIDI bridge
can feed notes with `noteOnFromMidi(noteNumber, velocity)`.

**2. Forward the document events to a JS channel** for JS → host notifications:

```js
document.addEventListener('qwerty-abc-piano:change', (e) =>
  QapChannel.postMessage(e.detail.abc));        // QapChannel = addJavaScriptChannel('QapChannel')
document.addEventListener('qwerty-abc-piano:simultaneous-change', (e) =>
  QapChannel.postMessage(JSON.stringify(e.detail)));
```

These events fire no matter how a note was entered (key, touch, MIDI, or a host button), so the host
always sees the current state.

---

## Browser support

| Feature | Chrome / Edge | Firefox | Safari (macOS / iOS) | Android WebView | iOS WKWebView |
|---|---|---|---|---|---|
| QWERTY input, notation, playback | ✅ | ✅ | ✅ | with an attached keyboard | with an attached keyboard (iPad) |
| On-screen **touch** piano | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Web MIDI** keyboard | ✅ (asks once) | ✅ behind a MIDI **site permission** | ❌ no Web MIDI | ⚠️ spotty | ❌ |

The build targets ES2020, i.e. current evergreen browsers. The touch piano is the universal input path
and the one to rely on for phones; where Web MIDI is missing the MIDI icon says so (struck through) and
nothing breaks. Node (>= 18) can import the package (for SSR bundles, tests, etc.) but constructing an
instance needs a DOM.

## CSS theming

The SVG piano keyboard uses CSS custom properties for key-highlight colors. Set them on the `pianoTarget` container (or any ancestor):

```css
#piano-target {
  --qwerty-abc-piano-transcribe-color: #5b9bd5; /* blue — active in transcribe mode */
  --qwerty-abc-piano-play-color:       #d97c3a; /* orange — active in play mode */
  --qwerty-abc-piano-sim-color:        #4caf50; /* green — simultaneous (chord) mode active */
  --qwerty-abc-piano-sim-color-dark:   #388e3c; /* dark green — black keys in chord mode */
}
```

The notation area rendered by `mountFullUI` (or when `notationTheme: 'black'`) always has a white background so it is legible on any page background colour.

---

## Limitations

- **Chords share one duration** — all notes in a chord (`(` … `)` or multi-touch) get the same length. It is retroactive: pressing a duration key while the chord is open re-times the whole chord.
- **US QWERTY layout assumed** — the key-to-note mapping is hard-coded for a standard US QWERTY keyboard. AZERTY, QWERTZ, and other layouts are not supported yet.
- **Tied notes not generated** — if a note's duration exceeds the remaining beats in a measure, the library inserts a barline before the note rather than splitting it with a tie.
- **Triplets only for tuplets** — the `Q` key inserts a triplet bracket (`(3`). Quintuplets and other irregular groupings are not directly supported; edit the ABC string if you need them.
- **Percussion mode uses a fixed pitch** — all note keys and taps in percussion mode record B4 (`B`, the middle line of the one-line percussion staff). The clef and key signature settings are ignored in percussion mode.

---

## Running the demos locally

The repo includes three demo pages. From a clone:

```bash
npm install
npm run build        # generates dist/index.esm.js, which the demos load as ES modules
python3 -m http.server 8080   # or: npx serve .
```

ES modules cannot be loaded from `file://` URLs, hence the local server. Then open:

| File | What it shows |
|---|---|
| [`demo_dropin_ui.html`](demo_dropin_ui.html) | A single `mountFullUI` call — everything wired automatically, including the Piano/Percussion shell toggle |
| [`demo_percussion.html`](demo_percussion.html) | Percussion mode (rhythm-only TAP input) |
| [`demo_webview.html`](demo_webview.html) | Native-WebView host pattern — global handle, `runJavaScript`-style calls, and a simulated JS channel (the shape a Flutter mobile host loads) |

e.g. **http://localhost:8080/demo_dropin_ui.html**.

---

## License

MIT © 2026 Propellam Studios LLC — see [LICENSE](LICENSE).
