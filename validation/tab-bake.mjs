// Tests of scripts/tab-bake.mjs (docs/specs/guitar-tab.md, "Preprocessing"), all in Node. The reader's own pipeline
// (MusicXML parser, playback timeline, Verovio conversion and TAB injection: validation/tab-harness.ts) is loaded
// through Vite's SSR module loader, so baked fingerings are compared with what the reader would generate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createServer } from 'vite';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { bakeMusicXml, parseXml, TUNINGS } from '../scripts/tab-bake.mjs';

const root = new URL('..', import.meta.url).pathname;
const script = join(root, 'scripts/tab-bake.mjs');
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOTATION = fixture('guitar-notation.musicxml');
const STAVES = fixture('guitar-tab-staves.musicxml');
const STANDARD = TUNINGS.standard;
let checks = 0;
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { checks++; assert.ok(value, message); };

// --- Small MusicXML readers for the checks -----------------------------------------------------------------------------
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const tagText = (body, name) => new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`).exec(body)?.[1];
/** Every `<note>` of a document: id, staff, flags, written MIDI and string/fret. */
function notesOf(xml) {
  return [...xml.matchAll(/<note\b([^>]*)>([\s\S]*?)<\/note>/g)].map(([, attrs, body]) => {
    const step = tagText(body, 'step'), octave = tagText(body, 'octave');
    return {
      id: /\sid="([^"]*)"/.exec(attrs)?.[1], body,
      staff: tagText(body, 'staff') ?? '1', grace: /<grace\b/.test(body), cue: /<cue\b/.test(body), chord: /<chord\b/.test(body), rest: /<rest\b/.test(body),
      midi: step ? 12 * (Number(octave) + 1) + STEP[step] + Number(tagText(body, 'alter') ?? 0) : null,
      string: tagText(body, 'string') === undefined ? null : Number(tagText(body, 'string')), fret: tagText(body, 'fret') === undefined ? null : Number(tagText(body, 'fret')),
      tieStop: /<tie type="stop"/.test(body),
    };
  });
}
/** Verovio tabGrps that hold notes (a TAB rest is a tabGrp too) and all of them. */
const tabGroups = mei => { const all = mei.match(/<tabGrp\b[\s\S]*?<\/tabGrp>/g) || []; return { notes: all.filter(g => /<note\b/.test(g)).length, all: all.length }; };
const pitchOf = (string, fret, tuning = STANDARD, capo = 0) => tuning[tuning.length - string] + capo + fret;
/** MusicXML `<note>` child order (the xs:sequence; grace/cue/chord first). */
const NOTE_ORDER = ['grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen'];
const ATTRIBUTES_ORDER = ['footnote', 'level', 'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part', 'directive', 'measure-style'];
function checkOrder(xml, label) {
  const walk = el => {
    const order = el.name === 'note' ? NOTE_ORDER : el.name === 'attributes' ? ATTRIBUTES_ORDER : null;
    if (order) {
      const ranks = el.children.map(c => order.indexOf(c.name));
      ok(ranks.every((rank, i) => rank >= 0 && (i === 0 || rank >= ranks[i - 1])), `${label}: <${el.name}> children in MusicXML order (${el.children.map(c => c.name)})`);
    }
    el.children.forEach(walk);
  };
  walk(parseXml(xml));
}

// --- The reader, in Node ---------------------------------------------------------------------------------------------------
const vite = await createServer({ configFile: false, root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, ssr: { external: ['verovio'] } });
const tmp = mkdtempSync(join(tmpdir(), 'tab-bake-'));
const quietWarn = console.warn;
try {
  const harness = await vite.ssrLoadModule('/validation/tab-harness.ts');
  const toolkit = new VerovioToolkit(await createVerovioModule());
  // Verovio's warnings (no MEI header) are noise here.
  const verovio = xml => {
    toolkit.resetOptions(); toolkit.setOptions({ breaks: 'none', pageWidth: 60000, adjustPageHeight: true, xmlIdChecksum: true });
    ok(toolkit.loadData(xml), 'Verovio loads the baked score');
    return { mei: toolkit.getMEI(), svg: toolkit.renderToSVG(1) };
  };
  console.warn = () => {};

  /** Reader-generated fingerings by notation note ID (TAB view, standard tuning unless given). */
  const readerFrets = async (xml, view = {}) => {
    const out = await harness.engraveTab(xml, { view: 'tab', ...view });
    return new Map(out.tabNotes.map(note => [note.id.replace(/-tabn?$/, ''), { string: note.course, fret: note.fret }]));
  };
  /** Baked notes match the reader's generated TAB: every sounding note fingered, continuations like their start. */
  const matchesReader = async (source, baked, label, { tuning = STANDARD, capo = 0, transpose = 0 } = {}) => {
    const reader = await readerFrets(source, { tuning, capo });
    const notes = notesOf(baked).filter(n => n.staff === '1' && n.midi !== null && !n.grace && !n.cue);
    ok(notes.length > 0, `${label}: has notes`);
    let lastByPitch = new Map();
    for (const note of notes) {
      ok(note.string !== null && note.fret !== null, `${label}: ${note.id} has string and fret`);
      eq(pitchOf(note.string, note.fret, tuning, capo), note.midi + transpose, `${label}: ${note.id} string ${note.string} fret ${note.fret} sounds its pitch`);
      const expected = reader.get(note.id) ?? (note.tieStop ? lastByPitch.get(note.midi) : undefined);
      ok(expected, `${label}: the reader fingered ${note.id}`);
      eq({ string: note.string, fret: note.fret }, expected, `${label}: ${note.id} matches the reader's solver`);
      lastByPitch.set(note.midi, { string: note.string, fret: note.fret });
    }
    return notes.length;
  };

  // 1. Fingerings match the reader's solver, and only <notations><technical> was added.
  const baked = bakeMusicXml(NOTATION);
  const count = await matchesReader(NOTATION, baked.xml, 'guitar-notation');
  eq(baked.parts.map(p => [p.id, p.assigned, p.kept, p.folded, p.unplayable.length, p.tabStaff]), [['P1', count, 0, 0, 0, false]], 'summary counts');
  eq(baked.xml.replace(/<notations><technical><string>\d+<\/string><fret>\d+<\/fret><\/technical><\/notations>/g, '').replace(/<technical><string>\d+<\/string><fret>\d+<\/fret><\/technical>/g, ''), NOTATION, 'everything else is byte for byte (XML declaration and DOCTYPE kept)');
  ok(baked.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise'), 'declaration and DOCTYPE first');
  ok(/<tied type="start"\/><technical><string>1<\/string><fret>3<\/fret><\/technical><\/notations>/.test(baked.xml), 'technical merged into existing notations');
  checkOrder(baked.xml, 'guitar-notation');
  // The reader takes baked fingerings as fixed and draws the same TAB.
  eq([...(await readerFrets(baked.xml)).entries()], [...(await readerFrets(NOTATION)).entries()], 'reader TAB of the baked score is unchanged');
  console.log(`tab-bake: ${count} notes of guitar-notation get the reader's string/fret; the rest of the file is unchanged passed`);

  // 2. Idempotent.
  const again = bakeMusicXml(baked.xml);
  ok(!again.changed && again.xml === baked.xml, 'baking twice changes nothing');
  eq(again.parts[0].kept, count, 'second bake keeps every fingering');
  const withTab = bakeMusicXml(NOTATION, { addTabStaff: true });
  const withTabAgain = bakeMusicXml(withTab.xml, { addTabStaff: true });
  ok(withTabAgain.xml === withTab.xml && withTabAgain.parts[0].skipped, 'baking a TAB-staff score again changes nothing (part skipped)');
  console.log('tab-bake: idempotent passed');

  // 3. --add-tab-staff: Verovio draws one tabGrp per note or chord; the reader flags the staff and plays it once.
  {
    const xml = withTab.xml;
    checkOrder(xml, 'with TAB staff');
    const events = notesOf(NOTATION).filter(n => n.midi !== null && !n.chord && !n.grace).length;
    const { mei, svg } = verovio(xml);
    const rests = notesOf(NOTATION).filter(n => n.rest).length;
    eq(tabGroups(mei), { notes: events, all: events + rests }, `Verovio: one tabGrp per note or chord (${events}), and one per rest`);
    eq((svg.match(/class="tabGrp"/g) || []).length, events + rests, 'Verovio draws every tabGrp');
    ok(/<staffDef\b[^>]*notationtype="tab.guitar"/.test(mei), 'Verovio reads a guitar TAB staff');
    const tabNotes = [...mei.matchAll(/<note\b[^>]*tab\.fret="(\d+)"[^>]*>/g)].length;
    eq(tabNotes, 2 * count, 'every note has its fret on both staves');
    const before = await harness.parts(NOTATION), after = await harness.parts(xml);
    eq(after.parts.map(p => [p.id, p.tab, p.tabOf]), [['P1-1', false, null], ['P1-2', true, 'P1-1']], 'the reader flags the TAB staff as a view of the notation staff');
    eq(after.timelineParts, ['P1-1'], 'only the notation staff is performed');
    eq(after.timelineNotes, before.timelineNotes, `the timeline does not double (${after.timelineNotes})`);
    const view = await harness.engraveTab(xml, { view: 'tab' });
    eq([view.staves, view.generate], [['2'], []], 'TAB view shows the imported staff and generates nothing');
    // The same layout as the Guitar Pro / MuseScore style fixture the reader already handles.
    eq((await harness.parts(STAVES)).parts.map(p => [p.id, p.tab, p.tabOf]), after.parts.map(p => [p.id, p.tab, p.tabOf]), 'same flags as the imported-TAB fixture');
    // Custom tuning and capo land in <staff-details>.
    const dropDBake = bakeMusicXml(NOTATION, { addTabStaff: true, tuning: TUNINGS.drop_d, capo: 2 }), dropD = dropDBake.xml;
    ok(/<staff-details number="2"><staff-lines>6<\/staff-lines><staff-tuning line="1"><tuning-step>D<\/tuning-step><tuning-octave>2<\/tuning-octave><\/staff-tuning>[\s\S]*?<capo>2<\/capo><\/staff-details>/.test(dropD), 'drop D tuning and capo in staff-details');
    const fingered = notesOf(dropD).filter(n => n.midi !== null && n.staff === '1');
    eq(fingered.filter(n => n.string === null).length, dropDBake.parts[0].unplayable.length, 'drop D capo 2: only the reported unplayable notes lack a fingering');
    for (const note of fingered.filter(n => n.string !== null)) eq(pitchOf(note.string, note.fret, TUNINGS.drop_d, 2), note.midi, `drop D capo 2: ${note.id} sounds its pitch`);
    console.log(`tab-bake: --add-tab-staff renders ${events} tabGrps in Verovio, is flagged as TAB (tabOf) and played once passed`);
  }

  // 4. A transposing guitar part (written an octave up, <transpose> octave-change -1): frets follow sounding pitch.
  {
    const transposing = NOTATION
      .replace('<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>', '<clef><sign>G</sign><line>2</line></clef><transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>')
      .replace(/<octave>(\d)<\/octave>/g, (_, o) => `<octave>${Number(o) + 1}</octave>`);
    const out = bakeMusicXml(transposing);
    await matchesReader(transposing, out.xml, 'transposing guitar', { transpose: -12 });
    eq(notesOf(out.xml).map(n => [n.string, n.fret]), notesOf(baked.xml).map(n => [n.string, n.fret]), 'same fingerings as the untransposed score');
    const tabbed = bakeMusicXml(transposing, { addTabStaff: true }).xml;
    const { mei } = verovio(tabbed);
    eq(tabGroups(mei).notes, notesOf(NOTATION).filter(n => n.midi !== null && !n.chord).length, 'transposing guitar with a TAB staff renders');
    console.log('tab-bake: transposing guitar fingered by sounding pitch passed');
  }

  // 5. Voices, backup/forward, grace and cue notes, lyrics, existing notations and fixed fingerings, range.
  {
    const head = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- keep me -->\n<score-partwise version="4.0">\n  <part-list>\n    <score-part id="P1">\n      <part-name>Classical Guitar</part-name>\n    </score-part>\n    <score-part id="P2">\n      <part-name>Flute</part-name>\n    </score-part>\n  </part-list>\n';
    const note = (inner) => `      <note>\n${inner.map(line => `        ${line}`).join('\n')}\n      </note>\n`;
    const part1 = '  <part id="P1">\n    <measure number="1">\n      <attributes>\n        <divisions>4</divisions>\n        <clef>\n          <sign>G</sign>\n          <line>2</line>\n          <clef-octave-change>-1</clef-octave-change>\n        </clef>\n        <staff-details>\n          <staff-size>90</staff-size>\n        </staff-details>\n      </attributes>\n'
      + note(['<grace/>', '<pitch><step>D</step><octave>4</octave></pitch>', '<voice>1</voice>', '<type>eighth</type>'])
      + note(['<pitch><step>E</step><octave>4</octave></pitch>', '<duration>8</duration>', '<voice>1</voice>', '<type>half</type>', '<stem>up</stem>', '<notations>', '  <slur type="start" number="1"/>', '</notations>', '<lyric><text>la</text></lyric>'])
      + note(['<pitch><step>C</step><octave>4</octave></pitch>', '<duration>8</duration>', '<voice>1</voice>', '<type>half</type>', '<stem>up</stem>', '<notations>', '  <slur type="stop" number="1"/>', '  <technical><string>3</string><fret>5</fret></technical>', '</notations>'])
      + '      <backup><duration>16</duration></backup>\n'
      + note(['<pitch><step>C</step><octave>2</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>', '<stem>down</stem>'])
      + '      <forward><duration>4</duration><voice>2</voice></forward>\n'
      + note(['<cue/>', '<pitch><step>A</step><octave>3</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<pitch><step>E</step><octave>2</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<chord/>', '<pitch><step>B</step><octave>2</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<chord/>', '<pitch><step>E</step><octave>3</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<chord/>', '<pitch><step>G</step><octave>3</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<chord/>', '<pitch><step>B</step><octave>3</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<chord/>', '<pitch><step>E</step><octave>4</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + note(['<chord/>', '<pitch><step>G</step><octave>4</octave></pitch>', '<duration>4</duration>', '<voice>2</voice>', '<type>quarter</type>'])
      + '      <barline location="right"><bar-style>light-heavy</bar-style></barline>\n    </measure>\n  </part>\n';
    const part2 = '  <part id="P2">\n    <measure number="1">\n      <attributes><divisions>1</divisions></attributes>\n      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>\n    </measure>\n  </part>\n';
    const source = `${head}${part1}${part2}</score-partwise>\n`;
    const out = bakeMusicXml(source, { addTabStaff: true });
    const [guitar] = out.parts;
    eq(out.parts.map(p => p.id), ['P1'], 'only the guitar part is a default target');
    const guitarXml = out.xml.slice(0, out.xml.indexOf('<part id="P2"'));
    const notes = notesOf(guitarXml).filter(n => n.staff === '1');
    const grace = notes.find(n => n.grace), cue = notes.find(n => n.cue);
    ok(grace.string === null && cue.string === null, 'grace and cue notes get no fingering');
    eq([notes[1].string, notes[1].fret], [1, 0], 'E4 in voice 1 gets string/fret');
    ok(/<slur type="start" number="1"\/>\s*<technical><string>1<\/string><fret>0<\/fret><\/technical>\s*<\/notations>\s*<lyric>/.test(out.xml), 'technical merged into notations, before the lyric');
    eq([notes[2].string, notes[2].fret], [3, 5], 'an existing fingering is kept');
    eq(notes[3].fret !== null && notes[3].midi, 36, 'C2 is fingered (folded an octave)');
    eq(guitar.folded, 1, 'one note folded');
    eq(guitar.unplayable.length, 1, 'a seven-note chord leaves one note unplayable');
    eq(notes.filter(n => !n.grace && !n.cue && n.string === null).map(n => n.midi), [64], 'the unplayable note (an inner E4 of the seven-note chord) is left untouched');
    eq(guitar.kept, 1, 'one fingering kept');
    // The E4 (voice 1, beat 1) and the C2 (voice 2, beat 1) start together: they are one event on different strings.
    ok(notes[1].string !== notes[3].string, 'notes starting together in two voices use different strings');
    ok(out.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- keep me -->\n'), 'comments kept');
    ok(/<staff-details number="1">\s*<staff-size>90/.test(out.xml), 'unnumbered staff-details pinned to staff 1');
    // TAB staff copy: grace dropped, cue → forward, slurs and lyrics not copied, voices 5-6, staff 2.
    const tab = notesOf(guitarXml).filter(n => n.staff === '2');
    ok(tab.every(n => !n.grace && !n.cue && !/<slur|<lyric|<stem/.test(n.body)), 'no grace, cue, slur, lyric or stem on the TAB staff');
    eq(tab.length, notes.filter(n => !n.grace && !n.cue).length, 'every other note copied');
    ok(/<forward><duration>4<\/duration><voice>6<\/voice><staff>2<\/staff><\/forward>/.test(out.xml), 'cue note becomes a forward');
    eq((out.xml.match(/<forward><duration>4<\/duration><voice>6<\/voice><staff>2<\/staff><\/forward>/g) || []).length, 2, 'the forward and the cue note are copied as forwards')
    checkOrder(out.xml, 'voices score');
    const { mei } = verovio(out.xml);
    eq(tabGroups(mei).notes, 4, 'Verovio: four tabGrps with notes (E4, C4, C2, chord)');
    const before = await harness.parts(source), after = await harness.parts(out.xml);
    eq(after.timelineNotes, before.timelineNotes, 'voices score: the timeline does not double');
    ok(after.parts.find(p => p.id === 'P1-2')?.tabOf === 'P1-1', 'voices score: TAB staff flagged');
    eq(bakeMusicXml(out.xml, { addTabStaff: true }).xml, out.xml, 'voices score: idempotent');
    // --parts all takes the flute too; explicit IDs.
    eq(bakeMusicXml(source, { parts: 'all' }).parts.map(p => p.id), ['P1', 'P2'], '--parts all');
    eq(bakeMusicXml(source, { parts: ['P2'] }).parts.map(p => p.id), ['P2'], '--parts P2');
    // --overwrite-existing re-solves the fixed note.
    const over = bakeMusicXml(source, { overwrite: true });
    eq(over.parts[0].kept, 0, '--overwrite-existing keeps nothing fixed');
    console.log('tab-bake: voices, backup/forward, grace/cue, merged notations, fixed fingerings, folding and unplayable notes passed');
  }

  // 6. CLI: .mxl in and out, plain output from .mxl, directory batch, dry run, summary.
  {
    const container = '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
    const mxl = zipSync({ mimetype: [strToU8('application/vnd.recordare.musicxml'), { level: 0 }], 'META-INF/container.xml': strToU8(container), 'score.musicxml': strToU8(NOTATION) });
    const dir = join(tmp, 'in'); mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'song.mxl'), mxl);
    writeFileSync(join(dir, 'sub', 'notation.musicxml'), NOTATION);
    writeFileSync(join(dir, 'sub', 'notes.xml'), '<?xml version="1.0"?><notes/>');
    const run = (...args) => execFileSync(process.execPath, [script, ...args], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const summary = run(join(dir, 'song.mxl'), '-o', join(tmp, 'song.mxl'), '--add-tab-staff');
    ok(/P1 "Guitar" \[E2 A2 D3 G3 B3 E4\]: 27 assigned, 0 kept, 0 folded, 0 unplayable, TAB staff added/.test(summary), `CLI summary (${summary.trim()})`);
    const files = unzipSync(readFileSync(join(tmp, 'song.mxl')));
    eq(Object.keys(files)[0], 'mimetype', 'mimetype stays the first entry');
    eq(strFromU8(files['score.musicxml']), withTab.xml, '.mxl round trip bakes the root file');
    eq(strFromU8(files['META-INF/container.xml']), container, 'container kept');
    run(join(dir, 'song.mxl'), '-o', join(tmp, 'song.musicxml'));
    eq(readFileSync(join(tmp, 'song.musicxml'), 'utf8'), baked.xml, '.mxl in, .musicxml out');
    const batch = run(dir, '--out-dir', join(tmp, 'out'), '--tuning', 'standard');
    eq(readdirSync(join(tmp, 'out'), { recursive: true }).sort(), ['song.mxl', 'sub', 'sub/notation.musicxml'], 'batch keeps relative paths (non-MusicXML skipped)');
    eq(readFileSync(join(tmp, 'out', 'sub', 'notation.musicxml'), 'utf8'), baked.xml, 'batch output');
    ok(/Total: 2 files, 2 parts, 54 notes assigned/.test(batch), `batch total (${batch.trim().split('\n').at(-1)})`);
    run(dir, '--out-dir', join(tmp, 'dry'), '--dry-run');
    ok(!readdirSync(tmp).includes('dry'), '--dry-run writes nothing');
    ok(/drop_d/.test((() => { try { run(join(dir, 'song.mxl'), '--tuning', 'banjo', '--dry-run'); return ''; } catch (error) { return String(error.stderr); } })()), 'unknown tuning is an error listing the names');
    console.log('tab-bake: CLI with .mxl, batch directory and dry run passed');
  }
  console.log(`tab-bake: all ${checks} checks passed`);
} finally {
  console.warn = quietWarn;
  rmSync(tmp, { recursive: true, force: true });
  await vite.close();
}
