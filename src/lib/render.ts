import { Accidental, Beam, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/core';
import type { Score, ScoreNote } from './score';
import { inferChordSymbol } from './chords';

export type NotePoint = { id: string; measure: number; part: number; start: number; duration: number; rest?: boolean; x: number; y: number; element?: Element };
export type RenderResult = { points: NotePoint[]; measureStarts: number[]; systemSize: number; staffCenters: number[]; scale: number; barWidth: number; systemHeight: number };

function vexDuration(beats: number): string {
  const values: [number, string][] = [[4, 'w'], [3, 'h'], [2, 'h'], [1.5, 'q'], [1, 'q'], [.75, '8'], [.5, '8'], [.375, '16'], [.25, '16'], [.125, '32']];
  return values.find(([n]) => Math.abs(n - beats) < .03)?.[1] || 'q';
}
function vexKey(p: { step: string; octave: number; alter: number }) { return `${p.step.toLowerCase()}${p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)}/${p.octave}`; }
function beatLabel(start: number, subdiv: boolean) {
  const beat = Math.floor(start) + 1;
  if (!subdiv) return String(beat);
  const fraction = ((start % 1) + 1) % 1;
  return fraction < .01 ? String(beat) : fraction < .3 ? `${beat}e` : fraction < .55 ? `${beat}&` : `${beat}a`;
}
function appendAnnotation(svg: SVGSVGElement, className: string, x: number, y: number, label: string) {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', `annotation ${className}`);
  text.textContent = label;
  svg.appendChild(text);
}
const dynamicCharacters: Record<string, string> = { p: '\uE520', m: '\uE521', f: '\uE522', r: '\uE523', s: '\uE524', z: '\uE525' };
function dynamicGlyphs(symbol: string) { return [...symbol].map(letter => dynamicCharacters[letter] || '').join(''); }

export function portraitMinimumBarWidth(score: Score): number {
  let busiestMeasure = 4;
  for (const part of score.parts) for (const measure of part.measures) busiestMeasure = Math.max(busiestMeasure, measure.notes.length);
  return Math.max(190, 50 + busiestMeasure * 34, 190 + Math.max(0, busiestMeasure - 4) * 44);
}
export function portraitBarLimit(width: number, score: Score): number {
  return Math.max(1, Math.min(4, score.parts[0]?.measures.length || 1, Math.floor((Math.max(240, width) - 56) / portraitMinimumBarWidth(score))));
}

export function renderScore(container: HTMLElement, score: Score, mode: 'portrait' | 'landscape', showNames: boolean, showCounts: boolean, subdivisions: boolean, barsPerLine: 'auto' | number, showChordSymbols: boolean, inferChordSymbols: boolean, availableHeight = 0, zoom = 1, firstSystemGutter = 0, requiredWidths: number[] = [], layoutPass = 0): RenderResult {
  container.replaceChildren();
  const viewportWidth = Math.max(240, container.clientWidth);
  const firstWidth = mode === 'portrait' ? Math.max(180, viewportWidth - firstSystemGutter) : viewportWidth;
  const unit = mode === 'landscape' ? Math.max(230, portraitMinimumBarWidth(score)) : Math.max(180, Math.min(280, (firstWidth - 100) / 3));
  const autoBars = Math.max(1, Math.floor((firstWidth - 72) / unit));
  const systemSize = mode === 'landscape' ? Math.min(12, score.parts[0].measures.length) : barsPerLine === 'auto' ? Math.min(portraitBarLimit(firstWidth, score), autoBars) : Math.min(score.parts[0].measures.length, Math.max(1, Math.min(4, barsPerLine)));
  const measureStarts: number[] = [];
  const staffCenters: number[] = [];
  const points: NotePoint[] = [];
  const steps: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  let largestChord = 1;
  const partSpacing = score.parts.map(part => {
    let hasLyrics = false;
    const hasDynamics = part.measures.some(measure => measure.dynamics?.length);
    let belowStaff = 0;
    for (const measure of part.measures) for (const note of measure.notes) {
      largestChord = Math.max(largestChord, note.pitches.length);
      hasLyrics ||= Boolean(note.lyric);
      const bottomLine = part.clef === 'bass' ? 18 : part.clef === 'alto' ? 24 : 30;
      for (const pitch of note.pitches) belowStaff = Math.max(belowStaff, Math.max(0, bottomLine - (pitch.octave * 7 + steps[pitch.step])) * 5);
    }
    return { hasLyrics, hasDynamics, lowSpace: Math.min(80, belowStaff) };
  });
  const lineHeights = partSpacing.map(({ hasLyrics, hasDynamics, lowSpace }) =>
    (showNames ? Math.max(125, 98 + largestChord * 14 + lowSpace + (showCounts ? 5 : 0) + (showChordSymbols ? 45 : 0)) : showCounts ? 125 + lowSpace + (showChordSymbols ? 30 : 0) : 78 + lowSpace + (showChordSymbols ? 12 : 0)) + (hasLyrics ? 20 : 0) + (hasDynamics ? 26 : 0));
  let partHeight = 0;
  const partOffsets = lineHeights.map(height => { const offset = partHeight; partHeight += height; return offset; });
  const chordSpace = showChordSymbols ? 22 : 0;
  const measureCount = score.parts[0].measures.length;
  const nextWidths = [...requiredWidths];
  let needsMoreSpace = false;
  let firstScale = 1;
  let firstSystemHeight = 0;
  for (let first = 0; first < measureCount; first += systemSize) {
    const count = Math.min(systemSize, measureCount - first);
    const usableWidth = mode === 'portrait' && first === 0 ? firstWidth : viewportWidth;
    const leading = mode === 'landscape' ? (first > 0 ? 0 : firstSystemGutter + 12) : 40;
    const h = (mode === 'landscape' ? 38 : 54) + partHeight + chordSpace * 2;
    const heightFit = score.parts.length > 4 && availableHeight > 0 ? Math.min(1, availableHeight / h) : 1;
    const barWidths = Array.from({ length: count }, (_, j) => Math.max(mode === 'landscape' ? unit : portraitMinimumBarWidth(score), requiredWidths[first + j] || 0));
    const naturalWidth = leading + 12 + barWidths.reduce((sum, width) => sum + width, 0);
    const extra = mode === 'portrait' ? Math.max(0, (usableWidth - 24) / heightFit - naturalWidth) / count : 0;
    for (let j = 0; j < count; j++) barWidths[j] += extra;
    const w = leading + 12 + barWidths.reduce((sum, width) => sum + width, 0);
    const widthFit = mode === 'portrait' ? Math.min(1, (usableWidth - 24) / w) : 1;
    const scale = Math.min(widthFit, heightFit) * zoom;
    if (first === 0) { firstScale = scale; firstSystemHeight = h * scale; }
    const block = document.createElement('div');
    block.className = 'score-system';
    block.style.width = `${w * scale}px`;
    block.style.height = `${h * scale}px`;
    if (first === 0) block.style.marginLeft = `${firstSystemGutter}px`;
    block.dataset.firstMeasure = String(first + 1);
    container.appendChild(block);
    const blockTop = block.offsetTop;
    const renderer = new Renderer(block, Renderer.Backends.SVG);
    renderer.resize(w, h);
    const ctx = renderer.getContext();
    const svgRoot = block.querySelector('svg') as SVGSVGElement;
    const barStarts = barWidths.map((_, index) => leading + barWidths.slice(0, index).reduce((sum, width) => sum + width, 0));
    for (let pIndex = 0; pIndex < score.parts.length; pIndex++) {
      const part = score.parts[pIndex];
      const y = (mode === 'landscape' ? 10 : 26) + chordSpace + partOffsets[pIndex];
      const annotations: { event: ScoreNote; x: number; measure: number }[] = [];
      let musicBottom = y + 80;
      let musicTop = y + 40;
      for (let j = 0; j < count; j++) {
        const mi = first + j;
        const x = barStarts[j];
        const barWidth = barWidths[j];
        if (pIndex === 0) measureStarts[mi] = mode === 'landscape' ? x : blockTop + x;
        const stave = new Stave(x, y, barWidth);
        if (j === 0 && (mode === 'portrait' || first === 0)) {
          stave.addClef(part.clef === 'percussion' ? 'percussion' : part.clef);
          if (first === 0) {
            const keys = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
            const partKey = part.key ?? score.key;
            if (partKey !== 0 && partKey >= -7 && partKey <= 7 && part.clef !== 'percussion') stave.addKeySignature(keys[partKey + 7]);
            stave.addTimeSignature(`${score.beats}/${score.beatType}`);
          }
        }
        stave.setContext(ctx).draw();
        if (first === 0 && j === 0) staffCenters[pIndex] = stave.getYForLine(2) * scale;
        if (pIndex === 0) {
          const number = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          number.setAttribute('x', String(x + 5));
          number.setAttribute('y', String(stave.getYForLine(0) - 9));
          number.setAttribute('class', 'bar-number');
          number.textContent = String(mi + 1);
          block.querySelector('svg')?.appendChild(number);
        }
        const source = part.measures[mi]?.notes || [];
        // Keep concurrent MusicXML voices on the same stave. A single VexFlow
        // Voice cannot contain overlapping events, so partition by onset.
        const lanes: { events: ScoreNote[]; end: number }[] = [];
        for (const event of source) {
          let lane = lanes.find(item => item.end <= event.start + .001);
          if (!lane) { lane = { events: [], end: 0 }; lanes.push(lane); }
          lane.events.push(event);
          lane.end = event.start + event.duration;
        }
        const kept: { source: ScoreNote; note: StaveNote }[] = [];
        const laneNotes = lanes.map(lane => {
          const notes: StaveNote[] = [];
          let time = 0;
          for (const event of lane.events) {
            if (event.start > time + .001) {
              const gap = event.start - time;
              notes.push(new StaveNote({ clef: part.clef, keys: [part.clef === 'bass' ? 'd/3' : 'b/4'], duration: `${vexDuration(gap)}r` }));
            }
            const duration = vexDuration(event.duration);
            const isRest = event.rest || !event.pitches.length;
            const keys = isRest ? [part.clef === 'bass' ? 'd/3' : 'b/4'] : event.pitches.map(vexKey);
            const note = new StaveNote({ clef: part.clef, keys, duration: `${duration}${isRest ? 'r' : ''}` });
            if (event.dotted || [3, 1.5, .75, .375].some(n => Math.abs(n - event.duration) < .03)) Dot.buildAndAttach([note]);
            if (!isRest) event.pitches.forEach((p, k) => { if (p.alter) note.addModifier(new Accidental(p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)), k); });
            notes.push(note);
            kept.push({ source: event, note });
            time = event.start + event.duration;
          }
          return notes;
        });
        if (!laneNotes.length) continue;
        try {
          const voices = laneNotes.map(notes => new Voice({ numBeats: Math.max(1, part.measures[mi]?.beats || score.beats), beatValue: 4 }).setMode(Voice.Mode.SOFT).addTickables(notes));
          const beams: Beam[] = [];
          for (const lane of lanes) {
            let beamNotes: StaveNote[] = [];
            for (const event of lane.events) {
              const note = kept.find(item => item.source === event)?.note;
              if (!note) continue;
              if (event.rest || !event.pitches.length || event.duration > .5 + .001) { beamNotes = []; continue; }
              if (event.beamStart) beamNotes = [note];
              else if (beamNotes.length) beamNotes.push(note);
              if (event.beamEnd) {
                if (beamNotes.length > 1) beams.push(new Beam(beamNotes));
                beamNotes = [];
              }
            }
          }
          const formatter = new Formatter().joinVoices(voices);
          const minimum = formatter.preCalculateMinTotalWidth(voices);
          const available = stave.getNoteEndX() - stave.getNoteStartX();
          if (minimum + 12 > available + .5) {
            nextWidths[mi] = Math.max(nextWidths[mi] || 0, Math.ceil(barWidth + minimum + 12 - available));
            needsMoreSpace = true;
          }
          formatter.formatToStave(voices, stave);
          voices.forEach(voice => voice.draw(ctx, stave));
          beams.forEach(beam => beam.setContext(ctx).draw());
          for (const { source: event, note } of kept) {
            const noteElement = note.getSVGElement?.();
            if (noteElement) {
              const bounds = (noteElement as SVGGraphicsElement).getBBox();
              const overflow = bounds.x + bounds.width + 8 - (x + barWidth);
              if (overflow > .5) { nextWidths[mi] = Math.max(nextWidths[mi] || 0, Math.ceil(barWidth + overflow + 8)); needsMoreSpace = true; }
            }
            const noteX = (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2;
            const noteYs = note.getYs() || [];
            const noteY = noteYs[0] ?? y + 40;
            if (noteElement) { noteElement.setAttribute('data-note-id', event.id); noteElement.classList.add('reader-note'); }
            for (const noteheadY of noteYs) { musicBottom = Math.max(musicBottom, noteheadY + 7); musicTop = Math.min(musicTop, noteheadY - 7); }
            if (event.pitches.length) {
              const stem = note.getStemExtents();
              musicBottom = Math.max(musicBottom, stem.topY + 2, stem.baseY + 2);
              musicTop = Math.min(musicTop, stem.topY - 2, stem.baseY - 2);
            }
            points.push({ id: event.id, measure: mi, part: pIndex, start: event.start, duration: event.duration, rest: event.rest, x: noteX * scale, y: noteY * scale + blockTop, element: noteElement });
            annotations.push({ event, x: noteX, measure: mi });
          }
        } catch (error) {
          console.warn('Could not engrave measure', mi + 1, error);
        }
      }
      const dynamicsBaseline = Math.max(y + 80 + 22, musicBottom + 18);
      const nameBaseline = Math.max(y + 80 + 22, musicBottom + 14) + (partSpacing[pIndex].hasDynamics ? 28 : 0);
      const symbolBaseline = Math.max(18, Math.min(y + 40 - 16, musicTop - 16));
      const lyricBaseline = nameBaseline + (showNames ? largestChord * 14 + 5 : 0) + (showCounts ? 18 : 0);
      for (let j = 0; j < count; j++) {
        const measure = part.measures[first + j];
        const inBar = annotations.filter(item => item.measure === first + j).sort((a, b) => a.event.start - b.event.start);
        for (const dynamic of measure?.dynamics || []) {
          const glyphs = dynamicGlyphs(dynamic.symbol);
          if (!glyphs) continue;
          const anchor = inBar.find(item => item.event.start >= dynamic.start - .001) || inBar.at(-1);
          appendAnnotation(svgRoot, 'dynamics-mark', anchor?.x ?? barStarts[j] + Math.min(30, barWidths[j] / 3), dynamicsBaseline, glyphs);
        }
      }
      const lyricGroups = new Map<number, typeof annotations>();
      for (const annotation of annotations) if (annotation.event.lyric) lyricGroups.set(annotation.measure, [...(lyricGroups.get(annotation.measure) || []), annotation]);
      const phraseMeasures = new Set<number>();
      for (const [measure, group] of lyricGroups) {
        const crowded = group.length >= 7 || group.some((item, index) => {
          const next = group[index + 1];
          return next && next.x - item.x < ((item.event.lyric?.length || 0) + (next.event.lyric?.length || 0)) * 3 + 10;
        });
        if (!crowded) continue;
        phraseMeasures.add(measure);
        const phrase = group.reduce((text, item) => {
          const word = item.event.lyric || '';
          return text ? `${text}${text.endsWith('-') ? '' : ' '}${word}` : word;
        }, '');
        appendAnnotation(svgRoot, 'lyric-label lyric-phrase', (group[0].x + group[group.length - 1].x) / 2, lyricBaseline, phrase);
      }
      for (const { event, x, measure } of annotations) {
        if (showNames) [...event.pitches].sort((a, b) => b.midi - a.midi).forEach((pitch, index) => appendAnnotation(svgRoot, 'note-label', x, nameBaseline + index * 14, pitch.step));
        if (showCounts) appendAnnotation(svgRoot, 'count-label', x, nameBaseline + (showNames ? largestChord * 14 + 5 : 0), beatLabel(event.start, subdivisions));
        if (event.lyric && !phraseMeasures.has(measure)) appendAnnotation(svgRoot, 'lyric-label', x, lyricBaseline, event.lyric);
        if (showChordSymbols && part.clef !== 'percussion') {
          const symbol = event.chordSymbol || (inferChordSymbols ? inferChordSymbol(event.pitches) : undefined);
          if (symbol) appendAnnotation(svgRoot, 'chord-symbol', x, symbolBaseline, symbol);
        }
      }
    }
    if (scale !== 1) {
      svgRoot.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svgRoot.style.width = `${w * scale}px`;
      svgRoot.style.height = `${h * scale}px`;
    }
    if (mode === 'portrait') svgRoot.style.overflow = 'hidden';
  }
  if (needsMoreSpace && layoutPass < 2) return renderScore(container, score, mode, showNames, showCounts, subdivisions, barsPerLine, showChordSymbols, inferChordSymbols, availableHeight, zoom, firstSystemGutter, nextWidths, layoutPass + 1);
  return { points, measureStarts, systemSize, staffCenters, scale: firstScale, barWidth: unit * firstScale, systemHeight: firstSystemHeight };
}
