# Changelog

All notable changes to this package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
uses [semantic versioning](https://semver.org/).

## [0.4.0]

Teaching features. Everything is additive: with none of the new options set,
a piano behaves exactly as in 0.3.0.

### Added

- `highlightPitches(pitches)` / `clearHighlight()`: colour keys in a playback
  colour, separate from the pressed-key colour. Replaces the previous
  highlight and returns the pitches the drawn keyboard does not show. Class
  `qap-key-highlight`, CSS custom property `--qwerty-abc-piano-highlight-color`.
- `markKeys({ pitch: 'correct' | 'wrong' | 'missed' })` / `clearMarks()`:
  feedback colours on keys. Classes `qap-mark-correct`, `qap-mark-wrong`,
  `qap-mark-missed`; CSS custom properties `--qwerty-abc-piano-mark-correct`,
  `-wrong` and `-missed`.
- Highlights and marks are kept by pitch, so they survive every redraw (range
  changes, octave steppers, resizing, label changes) and follow the octave
  shift on the QWERTY layout.
- `allowedPitches` option and `setAllowedPitches()` / `getAllowedPitches()`:
  a list or a `{ low, high }` range. Keys outside it are greyed out
  (`qap-key-disabled`, `--qwerty-abc-piano-disabled-fill`) and ignored on
  every input path (touch, computer keyboard, MIDI). The range keyboard's
  octave steppers stop at the allowed span.
- `qwertyAnchor: 'C4'`: a computer-keyboard layout whose home row starts on
  middle C (A S D F G H J K L ; ' = C4 to F5; W E T Y U O P = the black keys).
  The octave shift, the on-screen keyboard, the octave mini-map and the help
  table follow it.
- `noteLabels` option and `setNoteLabels()`: `'auto'` (as before), `'letters'`,
  or `'scientific'` for a pitch name on every white and black key.
- `mountFullUI` option `keyboard: 'range'`: the range keyboard on every
  device, for display pianos on desktop pages.
- `keyboardScope: 'focus'`: with several pianos on one page, only the active
  one (focus inside it, or the one last clicked or touched) hears the computer
  keyboard and Web MIDI. `mountFullUI` makes the container focusable and draws
  a focus ring (`--qwerty-abc-piano-focus-ring`).
- `onNotePlayed({ pitch, midi, source })`: fires for every note that sounds,
  in both modes, from `'qwerty'`, `'touch'` or `'midi'`.
- `mountFullUI` option `showEditRow: false`, honoured only on a play-only
  mount (`lockMode: true`, `defaultMode: 'play'`): hides the undo / clear row
  and the mode button where nothing can be entered.
- `getTouchKeyRange()`, `getNoteLabels()`, `getQwertyAnchor()`.
- Exported helpers `keyForPitch()` and `pitchForKey()`, and the types
  `QwertyAnchor`, `NoteLabels`, `KeyMark`, `AllowedPitches`, `NoteSource`,
  `NotePlayedEvent`.

### Changed

- On a range keyboard, a computer-keyboard key now lights the on-screen key
  for the pitch it plays.

### Fixed

- With a pinned `touchRange`, the range row's labels and steppers start from
  the pinned window instead of the default C4–B5.
- The Low and High range steppers no longer snap back on a mount without a
  fixed height (common in mobile WebViews): the auto-range resize handler
  re-picks the board only when the width crosses the phone/wide threshold,
  not when a stepper press changes the mount's height. A re-pick keeps the
  window's bottom note.
- The range steppers allow a window as small as one C-to-B octave, so High −
  and Low + work from the phone's default C4–B4 window once it has been
  widened. Low −, Low +, High − and High + are now disabled, like the octave
  buttons, when a press would not change the window.

## [0.3.0]

First public release.

- Accidentals carry through the bar, both when writing ABC and when reading
  it back with `setABC()`.
- The help panel's shortcut table names the pitches the home row plays at the
  starting `octaveShift`.
