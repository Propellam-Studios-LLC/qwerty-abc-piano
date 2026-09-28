export { QWERTYToABCPiano, QWERTYToABC } from './QWERTYToABCPiano.js';
export type {
  Duration, Mode, NoteEntry, QWERTYToABCOptions, MidiEnableResult,
  AbcjsInstance, AbcjsSynthController,
} from './types.js';
export { mountFullUI } from './ui/mountFullUI.js';
export type { MountFullUIOptions, MountFullUIHandle, MountedFullUI } from './ui/mountFullUI.js';

/** The package version, matching the `version` field in package.json. */
export const VERSION = '0.3.0';
