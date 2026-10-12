// Clock-mode time mapping (packages/pepperscore/src/lib/playback/clock-time.ts), a pure module run in Node.
// Timelines here are hand-built in timeline units (opening-tempo beats); at 120 bpm one unit is 0.5 s.
import assert from 'node:assert/strict';
import { measureSeekSeconds, noteOnsetSeconds, noteSeekSeconds, scoreSecondsScale } from '../packages/pepperscore/src/lib/playback/clock-time.ts';

const event = (noteId, measureIndex, occurrence, start, end, midi = 60) => ({
  id: `${noteId}:0:${occurrence}`, noteId, pitchId: `${noteId}:0`, pitchIndex: 0, partId: 'P1', voice: '1', measureIndex, occurrence,
  scoreBeat: 0, endScoreBeat: 0, startSeconds: start, endSeconds: end, soundEndSeconds: end, midi, velocity: 82,
  visualNoteIds: [noteId], visualSegments: [{ noteId, startSeconds: start, endSeconds: end }],
});
const position = (seconds, measureIndex, occurrence, measureBeat = 0) => ({ seconds, scoreBeat: 0, measureIndex, occurrence, measureBeat, noteId: null, activeNoteIds: [] });
// Bar 0 (notes a, b) is played twice (a repeat), then bar 1: c is tied into d (d is c's second visual segment).
const tied = event('c', 1, 0, 8, 12, 64);
tied.visualNoteIds.push('d');
tied.visualSegments.push({ noteId: 'd', startSeconds: 10, endSeconds: 12 });
const timeline = {
  initialBpm: 120,
  events: [event('a', 0, 0, 0, 2), event('b', 0, 0, 2, 4), event('a', 0, 1, 4, 6), event('b', 0, 1, 6, 8), tied],
  positions: [position(0, 0, 0), position(2, 0, 0, 2), position(4, 0, 1), position(8, 1, 0), position(10, 1, 0, 2), position(12, 1, 0, 4)],
};

// Scale: seconds per unit at a BPM; an invalid BPM falls back to the score's opening tempo.
assert.equal(scoreSecondsScale(timeline, 120), .5);
assert.equal(scoreSecondsScale(timeline, 60), 1);
assert.equal(scoreSecondsScale(timeline, 0), .5, 'zero BPM uses the opening tempo');
assert.equal(scoreSecondsScale(timeline, Number.NaN), .5, 'NaN BPM uses the opening tempo');

// Onsets are at the score's own tempo, one per performed pitch, in performed order.
assert.deepEqual(noteOnsetSeconds(timeline).map(onset => [onset.noteId, onset.occurrence, onset.midi, onset.seconds]),
  [['a', 0, 60, 0], ['b', 0, 60, 1], ['a', 1, 60, 2], ['b', 1, 60, 3], ['c', 0, 64, 4]]);
assert.deepEqual(Object.keys(noteOnsetSeconds(timeline)[0]).sort(), ['measureIndex', 'midi', 'noteId', 'occurrence', 'seconds']);

// A note seeks to its occurrence nearest the current time (Review Focus 4); a tie continuation seeks to its own segment.
assert.equal(noteSeekSeconds(timeline, 'a', 0, 120), 0);
assert.equal(noteSeekSeconds(timeline, 'a', 2.9, 120), 2, 'the repeat\'s occurrence is nearer');
assert.equal(noteSeekSeconds(timeline, 'a', 1, 120), 0, 'equidistant occurrences pick the earlier one');
assert.equal(noteSeekSeconds(timeline, 'd', 0, 120), 5, 'tie continuation d starts at unit 10');
assert.equal(noteSeekSeconds(timeline, 'b', 0, 60), 2, 'the BPM scales the result');
assert.equal(noteSeekSeconds(timeline, 'missing', 0, 120), null, 'a rest or unknown note has no time');

// A measure seeks to the start of its occurrence nearest the current time.
assert.equal(measureSeekSeconds(timeline, 0, 0, 120), 0);
assert.equal(measureSeekSeconds(timeline, 0, 3, 120), 2, 'second pass of bar 0');
assert.equal(measureSeekSeconds(timeline, 1, 0, 120), 4);
assert.equal(measureSeekSeconds(timeline, 9, 0, 120), null, 'a measure never performed has no time');
console.log('Clock time: scale, onsets at score tempo, note and measure seek targets passed');
