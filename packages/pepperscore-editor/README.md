# pepperscore-editor

A keyboard-first score editor for React, built on the [pepperscore](../pepperscore) viewer. It edits a typed
document model, compiles it to MusicXML for engraving and playback, imports MusicXML, and saves its own
`.pepperscore` file format.

## Usage

```tsx
import { useRef } from 'react';
import { PepperScoreEditor, type PepperScoreEditorHandle } from 'pepperscore-editor';
import 'pepperscore/style.css';
import 'pepperscore-editor/style.css';

export function App() {
  const ref = useRef<PepperScoreEditorHandle>(null);
  return (
    <PepperScoreEditor
      ref={ref}
      licenceKey={MY_LICENCE_KEY}
      view="endless"
      height="70vh"
      autoFocus
      onChange={(document) => save(document)}
    />
  );
}
```

`react`, `react-dom` (19+) and `pepperscore` are peer dependencies.

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `document` | `Document` | The score to edit. |
| `musicXml` | `string` | MusicXML to import instead (used when `document` is absent). With neither, a new 8-bar treble score opens. |
| `licenceKey` | `string` | A signed licence key (see [Licence](#licence)). Absent, invalid or expired: read-only, with a banner, a disabled toolbar and no keyboard editing. The editor is read-only while the key is being checked. |
| `onChange` | `(document: Document) => void` | After every change to the document (commands, undo, redo, opening a file). |
| `onRender` | `(ms: number) => void` | Milliseconds from a document change to the viewer finishing the redraw. |
| `autoFocus` | `boolean` | Focus the editor on mount so typing works at once. |
| `view` | `'vertical' \| 'endless'` | The viewer's layout. |
| `height` | `string` | CSS height of the viewer. |
| `className` | `string` | Added to the root `.ps-editor` element. |
| `assetBaseUrl` | `string` | Where the viewer loads its fonts and sounds from. |
| `soundPack` | `'core' \| 'complete'` | The playback sound pack. |

The `ref` handle has `getDocument()`, `getMusicXml()`, `undo()`, `redo()`, `isDirty()` (changed since it was opened
or last saved; undoing back to the save is clean) and `confirmDiscard()` (true when clean, else `window.confirm('Discard
unsaved changes?')`). Open asks the same before replacing a dirty score, and a `beforeunload` guard warns before leaving
the page with unsaved changes. Hosts that replace the score themselves (a New button) should call `confirmDiscard()` first.

## Keyboard

Letter keys are case-insensitive; Cmd counts as Ctrl. Digit and symbol keys match the typed character,
whatever Shift state produced it. Some keys only act in note entry mode (`N` toggles it) or in select mode.

Edits act on the target: the single selected event or note, else (in entry mode) the event just before the cursor.

- `.` in entry mode, right after entering a note, dots that note and moves the cursor to its new end, so `4 C . D`
  enters a dotted C and then a quarter D. Anywhere else it toggles the dot of the entry duration (`4 . C` enters a
  dotted C). In select mode it toggles the selected event's dot. Double dots are set from the toolbar only.
- `+`, `_` and `=` sharpen, flatten and naturalise the target note (up to double sharps and flats);
  `Alt+ArrowUp/Down` move it a semitone, spelled as in the key, else natural, else with sharps going up and flats
  going down.
- `Shift+A`–`Shift+G` add that letter to the target event's chord, in the octave nearest its top note and with the key
  signature's accidental, without moving the cursor. The toolbar's "Add to chord" toggle makes plain letters do the same.
- Arrows and `Ctrl`+arrows select the event at the new cursor in select mode (entry mode clears the selection);
  `Shift`+arrows extend the selection from its first event (or the event before the cursor), and moving back shrinks it.
- `Escape` right after entering a note leaves entry mode with that note selected, so `C D E Esc Delete` deletes the E;
  otherwise it clears the selection.

| Keys | Action | Mode |
| --- | --- | --- |
| N | Toggle note entry | Any |
| Escape | Select mode | Any |
| 1 | 32nd note | Note entry |
| 2 | 16th note | Note entry |
| 3 | Eighth note | Note entry |
| 4 | Quarter note | Note entry |
| 5 | Half note | Note entry |
| 6 | Whole note | Note entry |
| A | Note A | Note entry |
| B | Note B | Note entry |
| C | Note C | Note entry |
| D | Note D | Note entry |
| E | Note E | Note entry |
| F | Note F | Note entry |
| G | Note G | Note entry |
| 0 | Rest | Note entry |
| . | Toggle dot | Any |
| ArrowUp | Pitch up | Any |
| ArrowDown | Pitch down | Any |
| Ctrl+ArrowUp | Octave up | Any |
| Ctrl+ArrowDown | Octave down | Any |
| Alt+ArrowUp | Semitone up | Any |
| Alt+ArrowDown | Semitone down | Any |
| + | Sharp | Any |
| _ | Flat | Any |
| = | Natural | Any |
| Shift+A | Add A to chord | Any |
| Shift+B | Add B to chord | Any |
| Shift+C | Add C to chord | Any |
| Shift+D | Add D to chord | Any |
| Shift+E | Add E to chord | Any |
| Shift+F | Add F to chord | Any |
| Shift+G | Add G to chord | Any |
| ArrowLeft | Previous event | Any |
| ArrowRight | Next event | Any |
| Ctrl+ArrowLeft | Previous bar | Any |
| Ctrl+ArrowRight | Next bar | Any |
| Shift+ArrowLeft | Extend selection left | Any |
| Shift+ArrowRight | Extend selection right | Any |
| T | Tie | Any |
| S | Slur | Any |
| Shift+S | Staccato | Any |
| - | Tenuto | Any |
| > | Accent | Any |
| ^ | Marcato | Any |
| Ctrl+3 | Tuplet (3) | Any |
| Ctrl+5 | Tuplet (5) | Any |
| Ctrl+6 | Tuplet (6) | Any |
| Ctrl+7 | Tuplet (7) | Any |
| B | Beam grouping 2/3/4/auto | Select |
| / | Break beam | Any |
| D | Dynamic | Select |
| K | Key signature | Any |
| Q | Time signature | Any |
| C | Clef | Select |
| V | Ending | Any |
| J | Jump | Any |
| R | Cycle barline | Any |
| Delete / Backspace | Delete | Any |
| Ctrl+Z | Undo | Any |
| Ctrl+Shift+Z / Ctrl+Y | Redo | Any |
| Space | Play | Any |

This table mirrors `KEYMAP` (labels and `describeKey` output); `src/readme.test.ts` fails when a binding is missing.

## The `.pepperscore` file format

Save writes `<title or score>.pepperscore`, MIME type `application/vnd.pepperscore+json`: 2-space JSON with a
version header around the editor document.

```jsonc
{
  "pepperscore": { "version": 1 },
  "meta": { "title": "…", "composer": "…", "created": "2026-10-13T09:00:00.000Z", "modified": "2026-10-13T10:30:00.000Z" },
  "document": { /* the editor Document: global, parts, layouts, style, meta */ },
  // When the score was imported from MusicXML: its SHA-256 (hex), file name, and what the import left out.
  "source": { "format": "musicxml", "sha256": "…", "filename": "song.musicxml", "dropped": [{ "feature": "lyric", "count": 3, "location": "P1/m4" }] },
  // Where the editor was: restored when the file is opened.
  "editor": { "cursor": { /* Cursor */ }, "activeLayoutId": "L1" }
}
```

`writePepperScoreFile({ document, source?, editor?, created? })` and `readPepperScoreFile(text)` are exported.
Reading validates the wrapper and the document (Zod) and throws `Not a .pepperscore file` for anything that is
not JSON with a `pepperscore` header holding a numeric `version`, or `Unsupported .pepperscore version N` for other versions. Open accepts
`.pepperscore`, `.musicxml` and `.xml`; Export downloads MusicXML.

## Licence

A licence key is `base64url(payload) + '.' + base64url(signature)`: the payload is the UTF-8 JSON
`{ "sub": string, "exp": number, "maxStaves": number }` (`exp` in Unix seconds), signed with Ed25519.
`verifyLicence(key, publicKeyJwk?)` checks the signature against `DEFAULT_LICENCE_PUBLIC_KEY_JWK` (or the key
given) and the expiry, and returns the licence or `null`. `maxStaves` caps the scores the editor opens
(default 4); larger scores are refused with `Editing is limited to N staves.`

The key `'dev'` is accepted in development builds only (`import.meta.env.DEV`), as a 4-staff licence.

Verification uses Web Crypto, which browsers only provide in secure contexts (HTTPS or `localhost`); elsewhere a
signed key cannot be checked, the editor stays read-only and its banner says `Licence could not be verified on this
connection (needs HTTPS or localhost).` instead of `Editing requires a licence.`

Signing a key needs the private key, which is kept outside this repository:

```js
const key = await crypto.subtle.importKey('jwk', PRIVATE_JWK, { name: 'Ed25519' }, false, ['sign']);
const payload = new TextEncoder().encode(JSON.stringify({ sub: 'customer', exp: 1830297600, maxStaves: 8 }));
const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, payload));
const licenceKey = `${Buffer.from(payload).toString('base64url')}.${Buffer.from(signature).toString('base64url')}`;
```

## Development

```bash
npm test -w pepperscore-editor    # unit tests (vitest)
npm run check -w pepperscore-editor
npm run build && node validation/editor.mjs   # the /editor demo in a browser
```
