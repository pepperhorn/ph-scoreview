// Synthetic orchestral MusicXML shared by the large-score and parser-diff validations.
/** An orchestral-shaped score like Finale/Sibelius exports: 30 parts, varied rhythms, chords, rests, dynamics, slurs. */
export function orchestral(partCount, measureCount) {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const names = ['Piccolo', 'Flute 1', 'Flute 2', 'Oboe 1', 'Oboe 2', 'English Horn', 'Clarinet in Bb 1', 'Clarinet in Bb 2', 'Bass Clarinet', 'Bassoon 1', 'Bassoon 2', 'Contrabassoon', 'Horn in F 1', 'Horn in F 2', 'Horn in F 3', 'Horn in F 4', 'Trumpet in Bb 1', 'Trumpet in Bb 2', 'Trombone 1', 'Trombone 2', 'Bass Trombone', 'Tuba', 'Timpani', 'Harp', 'Violin I', 'Violin II', 'Viola', 'Violoncello', 'Contrabass', 'Percussion'];
  const bass = new Set(['Bassoon 1', 'Bassoon 2', 'Contrabassoon', 'Trombone 1', 'Trombone 2', 'Bass Trombone', 'Tuba', 'Timpani', 'Violoncello', 'Contrabass']);
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const L = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">', '<score-partwise version="4.0">', '  <work>', '    <work-title>Synthetic Symphony</work-title>', '    </work>', '  <part-list>'];
  for (let p = 0; p < partCount; p++) {
    const name = names[p % names.length];
    L.push(`    <score-part id="P${p + 1}">`, `      <part-name>${name}</part-name>`, `      <score-instrument id="P${p + 1}-I1">`, `        <instrument-name>${name}</instrument-name>`, '        </score-instrument>', `      <midi-instrument id="P${p + 1}-I1">`, `        <midi-channel>${(p % 15) + 1}</midi-channel>`, `        <midi-program>${(p * 3) % 128 + 1}</midi-program>`, '        </midi-instrument>', '      </score-part>');
  }
  L.push('    </part-list>');
  const durations = [[24, 'quarter'], [12, 'eighth'], [6, '16th'], [48, 'half']];
  for (let p = 0; p < partCount; p++) {
    const name = names[p % names.length];
    const low = bass.has(name);
    L.push(`  <part id="P${p + 1}">`);
    for (let m = 0; m < measureCount; m++) {
      L.push(`    <measure number="${m + 1}" width="${(180 + rnd() * 120).toFixed(2)}">`);
      if (m === 0) L.push('      <attributes>', '        <divisions>24</divisions>', '        <key><fifths>-1</fifths></key>', '        <time><beats>4</beats><beat-type>4</beat-type></time>', `        <clef><sign>${low ? 'F' : 'G'}</sign><line>${low ? 4 : 2}</line></clef>`, '        </attributes>');
      if (m === 0 && p === 0) L.push('      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>');
      if (m % 16 === 0) L.push(`      <direction placement="below"><direction-type><dynamics><${['p', 'mf', 'f', 'pp', 'ff'][Math.floor(rnd() * 5)]}/></dynamics></direction-type></direction>`);
      let beat = 0;
      if (rnd() < 0.18) L.push('      <note>', '        <rest measure="yes"/>', '        <duration>96</duration>', '        <voice>1</voice>', '        </note>');
      else while (beat < 96) {
        let [duration, type] = durations[Math.floor(rnd() * (p >= 24 ? 3 : 4))];
        if (beat + duration > 96) { duration = 96 - beat; type = duration === 48 ? 'half' : duration === 24 ? 'quarter' : duration === 12 ? 'eighth' : '16th'; }
        const rest = rnd() < 0.08;
        const chord = !rest && rnd() < (name === 'Harp' || p >= 24 ? 0.25 : 0.05) ? 2 : 1;
        for (let c = 0; c < chord; c++) {
          const s = Math.floor(rnd() * 7); const octave = (low ? 3 : 4 + (p < 3 ? 1 : 0)) + (rnd() < 0.2 ? 1 : 0); const alter = rnd() < 0.1 ? (rnd() < .5 ? 1 : -1) : 0;
          L.push('      <note>');
          if (c) L.push('        <chord/>');
          if (rest) L.push('        <rest/>');
          else L.push(`        <pitch><step>${steps[s]}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`);
          L.push(`        <duration>${duration}</duration>`, '        <voice>1</voice>', `        <type>${type}</type>`);
          if (alter && !rest) L.push(`        <accidental>${alter > 0 ? 'sharp' : 'flat'}</accidental>`);
          if (!rest) L.push(`        <stem>${s > 3 ? 'down' : 'up'}</stem>`);
          if (!rest && c === 0 && rnd() < 0.15) L.push(`        <notations><articulations><${rnd() < .5 ? 'staccato' : 'accent'}/></articulations></notations>`);
          L.push('        </note>');
        }
        beat += duration;
      }
      if (m === measureCount - 1) L.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      L.push('      </measure>');
    }
    L.push('    </part>');
  }
  L.push('  </score-partwise>');
  return L.join('\n');
}
