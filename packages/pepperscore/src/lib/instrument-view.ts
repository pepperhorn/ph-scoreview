// The instrument switch's view of a score. The switch transform lands here (Task 4); for now only the part identity.
import type { Part } from './score';

/** The part all staves of one source part share: the MusicXML <score-part id>, or the part's own id for ABC/MIDI. */
export const sourcePartOf = (part: Part): string => part.sourcePartId ?? part.id;
