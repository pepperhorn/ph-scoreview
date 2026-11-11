const SHARED = new Set(['defs', 'style', 'desc', 'title', 'metadata']);

/** About this many elements per svg2pdf call: a few tens of milliseconds, measured on a 30-part page. */
export const SLICE_ELEMENTS = 100;

/**
 * Split a page into runs of sibling subtrees of at most `limit` elements each, in document order.
 * A subtree that is already small is kept whole; a larger one is descended into, so a dense system
 * (thirty staves in one measure) is cut at staves rather than rendered in one call.
 */
export function planSlices(svg: SVGSVGElement, limit = SLICE_ELEMENTS): Element[][] {
  const slices: Element[][] = [];
  let current: Element[] = [], size = 0;
  const add = (element: Element, weight: number) => {
    if (current.length && size + weight > limit) { slices.push(current); current = []; size = 0; }
    current.push(element); size += weight;
  };
  const walk = (element: Element) => {
    const weight = element.getElementsByTagName('*').length + 1;
    if (weight <= limit || !element.children.length) add(element, weight);
    else for (const child of Array.from(element.children)) walk(child);
  };
  for (const child of Array.from(svg.children)) if (!SHARED.has(child.localName)) walk(child);
  if (current.length) slices.push(current);
  return slices;
}

/**
 * A copy of the page that holds only `chunks`, each under its original ancestors (so transforms, clips and
 * CSS selectors resolve as they did on the full page), plus the page's shared defs and styles.
 * The chunks are moved out of `svg`, which must therefore not be used for drawing afterwards.
 */
export function sliceShell(svg: SVGSVGElement, chunks: Element[]): SVGSVGElement {
  const shell = svg.cloneNode(false) as SVGSVGElement;
  for (const child of Array.from(svg.children)) if (SHARED.has(child.localName)) shell.append(child.cloneNode(true));
  const clones = new Map<Element, Element>([[svg, shell]]);
  const cloneOf = (element: Element): Element => {
    let clone = clones.get(element);
    if (!clone) {
      clone = element.cloneNode(false) as Element;
      cloneOf(element.parentElement!).append(clone);
      clones.set(element, clone);
    }
    return clone;
  };
  for (const chunk of chunks) cloneOf(chunk.parentElement!).append(chunk);
  return shell;
}
