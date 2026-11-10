/** Replace nested viewports by their browser-resolved parent-space matrices.
 * svg2pdf otherwise applies Verovio's definition-scale viewBox twice.
 * Capture all matrices before changing the tree; outer page units remain intact.
 */
export function flattenViewports(svg: SVGSVGElement): void {
  const nested = Array.from(svg.querySelectorAll('svg')).map(element => {
    const parent = element.parentElement as unknown as SVGGraphicsElement;
    const own = element.getScreenCTM(), outer = parent.getScreenCTM();
    if (!own || !outer) throw new Error('Could not resolve the PDF SVG viewport.');
    return { element, matrix: outer.inverse().multiply(own) };
  });
  for (const { element, matrix } of nested.reverse()) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const attribute of Array.from(element.attributes)) {
      if (!['x','y','width','height','viewBox','preserveAspectRatio','transform','xmlns'].includes(attribute.name)) group.setAttribute(attribute.name, attribute.value);
    }
    group.setAttribute('transform', `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    group.append(...Array.from(element.childNodes)); element.replaceWith(group);
  }
}

/** Ordinary text and music glyphs have different fonts, even within one chord label. */
export function normalizeText(svg: SVGSVGElement): void {
  for (const text of Array.from(svg.querySelectorAll('text, tspan'))) {
    for (const node of Array.from(text.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !/[♯♭♮𝄪𝄫]/u.test(node.textContent || '')) continue;
      const fragment = document.createDocumentFragment();
      for (const run of (node.textContent || '').split(/([♯♭♮𝄪𝄫])/u).filter(Boolean)) {
        const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        // jsPDF's text encoder is UTF-16: use equivalent BMP SMuFL double accidentals.
        span.textContent = run === '𝄪' ? '\ue263' : run === '𝄫' ? '\ue264' : run;
        if (/^[♯♭♮𝄪𝄫]$/u.test(run)) span.style.fontFamily = 'Bravura';
        fragment.appendChild(span);
      }
      node.replaceWith(fragment);
    }
  }
  for (const text of Array.from(svg.querySelectorAll<SVGElement>('text, tspan'))) {
    const requested = getComputedStyle(text).fontFamily;
    const ownText = Array.from(text.childNodes).filter(node=>node.nodeType === Node.TEXT_NODE).map(node=>node.textContent).join('');
    const family = /[\ue000-\uf8ff♯♭♮]/.test(ownText) ? requested.includes('Petaluma') ? 'Petaluma' : 'Bravura' : requested.includes('Petaluma Script') ? 'Petaluma Script' : 'Poppins';
    const weight = Number(getComputedStyle(text).fontWeight) >= 600 ? 'bold' : 'normal';
    // Inline CSS wins over presentation attributes, so normalize both consistently.
    for (const [name, value] of [['font-family',family],['font-weight',weight],['font-style','normal']]) {
      text.setAttribute(name,value); text.style.setProperty(name,value);
    }
  }
}
