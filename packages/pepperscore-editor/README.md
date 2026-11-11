# @pepperhorn/pepperscore-editor

A keyboard-first score editor for React, built on the [pepperscore](../pepperscore) viewer. It edits a typed
document model, compiles it to MusicXML for engraving and playback, imports MusicXML, and saves its own
`.pepperscore` file format.

## Usage

```tsx
import { useRef } from 'react';
import { PepperScoreEditor, type PepperScoreEditorHandle } from '@pepperhorn/pepperscore-editor';
import 'pepperscore/style.css';
import '@pepperhorn/pepperscore-editor/style.css';

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
| `forcePhone` | `boolean` | `true` for the phone shell (tabbed bottom toolbar, auto-collapsing header), `false` for the desktop shell; default: the phone shell when the editor is 760px wide or less. The phone shell always shows the score in Page view; give a phone host a `dvh` height (e.g. `height="100dvh"`) so the pinned toolbar sits above the browser's own bars. |
| `className` | `string` | Added to the root `.ps-editor` element. |
| `assetBaseUrl` | `string` | Where the viewer loads its fonts and sounds from. |
| `soundPack` | `'core' \| 'complete'` | The playback sound pack. |

The `ref` handle (`PepperScoreEditorHandle`) has `getDocument()`, `getMusicXml()`, `undo()`, `redo()`, `isDirty()` (changed since it was opened
or last saved; undoing back to the save is clean) and `confirmDiscard()` (true when clean, else `window.confirm('Discard
unsaved changes?')`). Open asks the same before replacing a dirty score, and a `beforeunload` guard warns before leaving
the page with unsaved changes. Hosts that replace the score themselves (a New button) should call `confirmDiscard()` first.

## Score details

Details in the desktop top bar, or Score details in the phone header menu, opens fields for description,
project (a label) and comma-separated tags. Leaving a field commits one undoable edit. Blank values clear it;
tags are trimmed, empty entries dropped and exact duplicates removed in order (case is preserved).
These controls require an editing licence and use Poppins in both shells.

`document.meta` supports optional `title`, `composer`, `description`, `project`, `tags: string[]` and `goal`.
`setMeta` accepts any subset, preserves omitted fields and trims string values. `goal` is stored for hosts and
has no editor UI. All fields persist in both the document and wrapper metadata of `.pepperscore` files;
older version 1 files with only title and composer still open. Description, project, tags and goal do not
export to MusicXML.

## Layouts

A layout is a view of the score; edits to pitches, rhythms and barlines are global and show in every layout. The
canvas header's selector (and the phone header's layout chip) switches the active layout, and the Layout tab of the
inspector edits it.

- **Full score** (`layouts[0]`) is the conductor score and what Export writes. Its stave checkboxes never edit it:
  hiding a stave in the Full score spawns a **custom** layout (named "Custom", "Custom 2", and so on) and switches to
  it, as one undoable step. The tab says so ("Hiding a stave makes a custom layout.").
- **Parts**: "+ Parts" creates one layout per part (`createPartLayouts`).
- **Custom**: tick the staves to show (the last shown stave cannot be hidden), type a name and "Save as custom
  layout". Hiding every stave of a swapped part keeps its swap, so showing a stave again brings the swapped view back.
- **Transposing / Concert** is a property of the layout: transposing parts show written pitch for their instrument,
  concert layouts show sounding pitch.
- **A swap on the full score** is a view only: Export still writes the source part. The swap card says so ("Export
  writes Tenor Sax; Make a copy to export Alto Sax."); "Make a copy" bakes the swap into a part that exports.
- **Switching layouts** (or hiding the cursor's stave) moves the cursor to the first drawn stave at the same bar and
  beat, and clears the selection, so typing never edits a stave the layout does not draw.

Layouts, swaps and overrides are saved in the `.pepperscore` file. Files written before layouts existed open
unchanged (a layout without `kind` or `transposing` becomes a transposing score layout).

## Instrument swap

The Layout tab's swap card shows a part for another instrument. The swap is a view-time transform of the same music,
**linked** to the source part, so an edit to either shows in both ("Linked to Tenor Sax · changes affect both").

- **Instrument and level** (beginner, intermediate, advanced) choose the playable range. All instruments except the
  drum kit are targets; the part's own instrument is not offered.
- **Fit to range automatically**: a phrase (broken by a rest, a slur end or the bar line; a tie keeps its notes
  together) that falls outside the range moves 8va or 8vb as a unit. Changing the target instrument clears manual
  octave choices; "Undo moves" turns fitting off.
- **Extra transposition**: an interval from a minor second to an octave, up or down, on top of the instrument's own.
- **Make a copy (own stave)** unlinks the swap into a new part of its own (`makeCopy`). In the full score the copy is
  placed right after the source, and the source keeps its stave without the swap (both export). In any other layout
  the copy replaces the source in that layout and is appended to the full score, so it exports too. Either way the
  swap card then selects the copy as its part.
- **Remove swap** returns the part to its own instrument.
- **Highlights and status count**: notes moved to fit the range are orange (`ps-transposed`, `--ps-transposed`); the
  plain instrument transposition is not highlighted. The status line reads "N notes moved 8vb for Alto Sax ·
  beginner" ("moved to fit range" when both directions occur), and the swap card's legend shows the same count.
  "Review" selects the moved notes and scrolls to the first.

Known limitation: the exported MusicXML (and the engraved view) still carry the concert key signature for swapped and
transposing parts; a per-part written key is not compiled yet.

## Desktop shell

Above 760px wide (measured on the editor, not the window) the editor has the desktop shell:

- **Top bar**: brand, title and composer (double-click to edit; Enter or blur commits, Escape cancels), Key, Time and
  Tempo chips that open popovers, Details and Parts buttons, undo and redo, Play, Save, Export, Open and a licence badge.
- **Rail**: keycaps (56 x 52) for the value (whole to 32nd, dot), modify (rest, tie, slur), pitch (sharp, flat,
  natural, chord toggle) and group (tuplet, beam) tools, with legends taken from `KEYMAP`.
- **Canvas header**: Entry / Edit pill, "Part · bar N of M", the layout selector and Page / Endless.
- **Inspector tabs**: Score (key, time, clef, barlines, repeats, endings, jumps, marks, tempo, insert/delete bar),
  Stave (articulations, dynamics, text, beam group) and Layout (staves, layouts, instrument swap).
- **Popovers** are placed beside the cursor bar and never cover it: left, right, above, then below, clamped to the
  viewport; with no cursor bar they fall back to the button that opened them.
- **Add-bar buttons**: "+" appends a bar and "-" deletes the last bar, at the right edge of the last drawn bar.
- **Inspector drawer**: from 761 to 960px the inspector is a drawer sliding over the canvas, opened from the
  canvas header's "Inspector" button and closed by Escape or a tap outside it.

## Phone shell

At 760px wide or less (or with `forcePhone`) the editor switches to the phone shell:

- **Two-row header** (78px) for occasional controls: the brand, title, composer, Undo, Redo, Play and an overflow menu
  (Save, Export, Open, New score, Score details, Parts) on row 1, and "bar N of M", the layout chip and the Key / Time / Tempo chips on row 2.
  After 4 seconds without input it collapses to a 28px strip (position, key chip); a touch, wheel or pointer down on
  the canvas, a header tap or a document change brings it back; scrolling caused by playback or by the collapse itself
  does not. The body padding follows the header height, so nothing jumps.
- **Tabbed toolbar** pinned to the bottom, for the constant controls: the **Entry / Edit** switch (on every tab), then
  tabs Notes, Marks, Bar, Score and Layout over rows of 44px buttons. Notes has three rows: durations, dot and rest;
  sharp, natural, flat, 8vb, 8va and Add to chord; and a one-octave piano (black keys spelled for the key) or the C–B
  letter buttons, switched by the button at the end of the row and remembered. The others have two. The canvas is
  padded by the toolbar's measured height, so a taller tab never covers the score.
- **Entry and Edit**: a new or opened score starts in Entry, so the piano keys enter notes straight away. Tapping a
  note in the score (any part of it: notehead, stem, flag, accidental or dots; or the staff space nearest it, so the
  cursor lands on it) switches to Edit, tapping a rest or empty staff space to Entry. In Edit the letter and piano keys repitch the highlighted note (or pitch a
  highlighted rest in place), the durations resize it within its bar and Rest makes it a rest.
- **Inline strips**: Key, Time, Clef, Tempo, Dynamic and the swap card open as a strip in place of the button rows,
  not as a floating popover. Escape, the close button or Apply closes them.
- **Page view is forced**: the phone shell always shows the score in Page view (Endless shows a single bar at 390px).
- **Heights**: give a phone host a `dvh` height (`height="100dvh"`), not `100vh`, so the toolbar is not pushed under
  the browser's address bar. The shell is chosen before the first paint, so the viewer mounts once.

Not on the phone yet: text on a stave (use the desktop shell).

## Keyboard

Letter keys are case-insensitive; Cmd counts as Ctrl. Digit and symbol keys match the typed character,
whatever Shift state produced it. Some keys only act in note entry mode (`N` toggles it) or in Edit mode (where clicks select;
the editor calls it `select` internally). A new or opened score starts in Edit on the desktop, in Entry on a phone.

Edits act on the target: the single selected event or note; else, right after entering a note, that note; else the
event the cursor sits on (the highlighted one, after a click or an arrow); else the event just before the cursor.

- `.` in entry mode, right after entering a note, dots that note and moves the cursor to its new end, so `4 C . D`
  enters a dotted C and then a quarter D. Anywhere else it toggles the dot of the entry duration (`4 . C` enters a
  dotted C). In Edit mode it toggles the selected event's dot. Double dots are set from the toolbar only.
- `+`, `_` and `=` sharpen, flatten and naturalise the target note (up to double sharps and flats);
  `Alt+ArrowUp/Down` move it a semitone, spelled as in the key, else natural, else with sharps going up and flats
  going down.
- `Shift+A`–`Shift+G` add that letter to the target event's chord, in the octave nearest its top note and with the key
  signature's accidental, without moving the cursor. The toolbar's "Add to chord" toggle makes plain letters do the same.
- Arrows and `Ctrl`+arrows select the event at the new cursor in Edit mode (entry mode clears the selection);
  `Shift`+arrows extend the selection from its first event (or the event before the cursor), and moving back shrinks it.
- `A`–`G` enter the letter in the octave nearest the last pitch entered on the cursor's staff; with none (a new
  score, or the first note on another staff) nearest the clef's middle line, so a treble G is G4 and a bass G is G3.
- `Escape` right after entering a note leaves entry mode with that note selected, so `C D E Esc Delete` deletes the E;
  otherwise it clears the selection.

| Keys | Action | Mode |
| --- | --- | --- |
| N | Toggle note entry | Any |
| Escape | Edit mode | Any |
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
| B | Beam grouping 2/3/4/auto | Edit |
| / | Break beam | Any |
| D | Dynamic | Edit |
| K | Key signature | Any |
| Q | Time signature | Any |
| C | Clef | Edit |
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

### Parts

Open **Parts** in the desktop header or phone menu to add a pitched instrument or
voice, change an empty part's instrument, or remove an empty part. Piano is one
part with two staves (treble and bass); all other choices use one. Drums and
reordering are outside this flow. A part containing notes cannot change instrument
or be removed, and the last part cannot be removed. Disabled controls explain why.
The form enforces the current licence's `maxStaves` for additions and changes.

The package exports undoable `addPart({ instrument })`,
`setPartInstrument({ partId, instrument })` and `removePart({ partId })` commands
for `store.dispatch`, plus `canEditPart(document, partId)` and
`canAddPart(document, maxStaves, instrument?)`. Instrument ids use
`SwitchInstrumentId` from `pepperscore/instruments` (excludes `drum-kit`). The
optional third argument counts piano as two staves; the default checks a single
stave. Hosts dispatching directly must check the verified licence cap before
adding a part or expanding an empty part to piano (count the other parts plus the
target's staves); commands do not hold licence state. Added parts receive an empty
measure for every bar and join Full score; custom layouts are unchanged. Removal
clears the part from every layout. All operations support undo/redo.

### Editor plugins (API v1)

Pass `plugins?: EditorPlugin[]` to mount optional overlays inside the measured editor shell. Without it no plugin
wrappers are rendered. Each plugin has a unique `id`, `apiVersion: 1` and `Overlay: ComponentType<{ host: EditorHost }>`.
`EditorHost`, `EditorPlugin` and `EditorTarget` are exported from the package root.

The host exposes `apiVersion: 1`, `getDocument()`, document-only `subscribe(listener)` (returns an unsubscribe function),
and undoable `dispatch(command, args)`. Dispatch is disabled when `editable` is false. `shell` is `desktop` or `phone`.
`origin` is `opened` on an ordinary page load or file open; set `startedNew` for an explicitly new initial score.
The editor's New action also starts a `new` session.

Targets are `title`, `composer`, `details`, `key`, `time`, `tempo`, `clef` and `parts`. Call `revealTarget(target)` to
expand the phone header/menu or select the Score tab/inspector drawer, then wait for React to render and call
`findTarget(target)`. It returns an on-screen `data-ps-target` element whose centre is reachable in this editor, or null; remeasure it on scroll
and resize. `openPopover(name)` opens the existing editor control (including `details` and `parts`). Title/composer
use double-click editing on desktop. On phone they remain read-only displays; an empty composer has no target.

Overlays are wrapped in `[data-ps-plugin="<id>"]`. Their keys bypass editor shortcuts and note entry. Plugins own their
listeners and subscriptions: release them in effect cleanup. Opening another file or starting a new score unmounts
the old session and its overlays. API versions other than 1 are not mounted. The `/editor?stubPlugin=1` demo includes
a validation stub; it is outside the editor package. Coaching logic and scripts belong in separate packages.

## Install from GitHub Packages

Requires React 19+, React DOM 19+ and `pepperscore >=0.5.0`. Put the following in your
consumer's `.npmrc`; keep the token in the environment, never in git:

```ini
@pepperhorn:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Set `NODE_AUTH_TOKEN` to a GitHub token with `read:packages` and access to the private
package, then run:

```sh
npm install @pepperhorn/pepperscore-editor pepperscore@^0.5.0 react@^19 react-dom@^19
```

The package exports ESM JavaScript, TypeScript declarations and `./style.css`.
Import both stylesheets as shown above. The registry and restricted publish access
are configured in package metadata; the publisher must confirm private visibility
and repository access in GitHub Packages. Publishing is a separate human action.

## Licence signing (repository tools)

Run these tools from a checkout of this repository, not from the installed package.
Only the key holder runs key generation. Use a private directory outside the repo:

```sh
node packages/pepperscore-editor/scripts/licence-keygen.mjs /secure/private/editor-signing.jwk
node packages/pepperscore-editor/scripts/licence-sign.mjs /secure/private/editor-signing.jwk becreative 2028-01-01 4
```

Key generation writes the private Ed25519 JWK once (mode `0600`, refuses overwrite)
and prints only the public JWK. Signing prints a licence string for the subject,
expiry date (exclusive, midnight UTC) and positive integer stave cap. Keep the private
JWK outside git, logs and transcripts. A signed licence contains no private key.
The payload JSON bytes `{ sub, exp, maxStaves }` are signed with Ed25519 and encoded
as `base64url(payload).base64url(signature)` for `verifyLicence`.

**TODO (owner rotation):** replace `DEFAULT_LICENCE_PUBLIC_KEY_JWK` and re-sign the
reader demo licence after the owner supplies the new public JWK and demo key.
The current key remains unchanged by this packaging task. `licenceKey="dev"` is
accepted only when running source in a development build; the distributed build
requires a signed licence.
