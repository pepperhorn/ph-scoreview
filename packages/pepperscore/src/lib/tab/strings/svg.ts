import { attributeOf, scan } from '../../notation/mei-view';

/** Verovio preserves note @type as an SVG class, including after getMEI/loadData.
 * Change only that note's numeric text; never rely on chord ordering or a font's pixel size. */
export function substituteFingerLabels(svg: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  let noteDepth = -1, directionDepth = -1, depth = 0, label = '';
  let textStart = -1, textTag = '', fontSize = '';
  scan(svg, ({ name, closing, selfClosing, attributes, index, length }) => {
    if (closing) depth--;
    else if (!selfClosing) depth++;
    if (!closing && name === 'g') {
      const match = /(?:^|\s)finger-tab-([LH]?[0-4])-p[\d-]+(?:\s|$)/.exec(attributeOf(attributes, 'class') ?? '');
      if (match) { noteDepth = depth; label = match[1]; }
    }
    if (!closing && name === 'g' && /(?:^|\s)finger-position(?:\s|$)/.test(attributeOf(attributes, 'class') ?? '')) directionDepth = depth;
    if (directionDepth >= 0 && !closing && name === 'text') {
      // Verovio left-aligns directions. Centre these compact labels on their notes,
      // so a long position name cannot run into the following semiquaver's label.
      const tag = svg.slice(index, index + length).replace(/\stext-anchor="[^"]*"/, '');
      edits.push({ start: index, end: index + length, text: `${tag.slice(0, -1)} text-anchor="middle">` });
    }
    if (closing && name === 'g' && depth === directionDepth - 1) directionDepth = -1;
    if (noteDepth < 0) return;
    if (!closing && name === 'text' && attributeOf(attributes, 'class') !== 'finger-label') { textStart = index; textTag = svg.slice(index, index + length); fontSize = attributeOf(attributes, 'font-size') ?? ''; }
    if (!closing && name === 'tspan') fontSize = attributeOf(attributes, 'font-size') ?? fontSize;
    if (closing && name === 'text' && textStart >= 0) {
      const tag = textTag.replace(/\sfont-size="[^"]*"/, '');
      edits.push({ start: textStart, end: index + length, text: `${tag.slice(0, -1)} class="finger-label" font-size="${fontSize}" font-family="Arial" fill="currentColor" stroke="white" stroke-width="45" stroke-linejoin="round" paint-order="stroke fill">${label}</text>` });
      textStart = -1;
    }
    if (closing && name === 'g' && depth === noteDepth - 1) noteDepth = -1;
  });
  for (const edit of edits.reverse()) svg = svg.slice(0, edit.start) + edit.text + svg.slice(edit.end);
  return svg;
}
