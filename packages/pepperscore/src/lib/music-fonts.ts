export type MusicFont = 'Bravura' | 'Petaluma';

/**
 * Petaluma 1.065 `engravingDefaults` (steinbergmedia/petaluma redist/petaluma_metadata.json), in staff spaces.
 * Verovio 6.3.0 does not read a font's engravingDefaults on its own, so stems, staff/ledger/bar lines, ties and
 * slurs keep Verovio's thinner built-in widths unless we pass them. Keys Verovio 6.3.0 rejects
 * (arrowShaftThickness, beamSpacing, beamThickness, dashedBarlineThickness) are left out to keep the console clean.
 */
const PETALUMA_ENGRAVING_DEFAULTS = {
  barlineSeparation: 0.4, bracketThickness: 0.5, dashedBarlineDashLength: 0.5, dashedBarlineGapLength: 0.25,
  hairpinThickness: 0.16, legerLineExtension: 0.4, legerLineThickness: 0.16, lyricLineThickness: 0.16,
  octaveLineThickness: 0.16, pedalLineThickness: 0.16, repeatBarlineDotSeparation: 0.16, repeatEndingLineThickness: 0.16,
  slurEndpointThickness: 0.1, slurMidpointThickness: 0.22, staffLineThickness: 0.13, stemThickness: 0.12,
  subBracketThickness: 0.16, textEnclosureThickness: 0.16, thickBarlineThickness: 0.5, thinBarlineThickness: 0.16,
  tieEndpointThickness: 0.1, tieMidpointThickness: 0.22, tupletBracketThickness: 0.16,
};
const PETALUMA_OPTIONS = {
  // Without this, Verovio centres Petaluma's time-signature digits on the middle line and they overprint.
  handwrittenFont: ['Petaluma'],
  engravingDefaults: JSON.stringify(PETALUMA_ENGRAVING_DEFAULTS),
};

/** Extra Verovio options a music font needs beyond `font`. Bravura keeps Verovio's defaults. */
export const musicFontOptions = (font: MusicFont | undefined): Record<string, unknown> => font === 'Petaluma' ? PETALUMA_OPTIONS : {};
