/**
 * A small, strict, streaming (SAX-style) XML 1.0 tokenizer with no DOM dependency, so MusicXML can be read in a
 * worker (workers have no DOMParser). It reports start tags (with source offsets, so callers can splice the original
 * text), end tags and character data, and rejects what a browser's DOMParser rejects for the documents we read:
 * mismatched or unclosed tags, malformed or duplicate attributes, undefined entities, bad character references,
 * misplaced declarations, `--` in comments, `]]>` in text, illegal control characters and content outside the root.
 *
 * Not supported (rejected as invalid, like most non-validating browser parsers would mis-handle anyway): parameter
 * entities and entity values containing markup. Internal-subset general entities with plain text values are expanded.
 *
 * Character data follows the XML spec: line ends are normalized to LF, attribute values have literal tab/LF
 * normalized to a space (CDATA attribute type, since no external DTD is loaded) and references are decoded.
 */

export class XmlError extends Error {
  constructor(readonly detail: string, readonly offset: number) { super('This file is not valid XML.'); }
}

export type XmlAttribute = {
  /** Qualified name, as written. */
  name: string;
  /** Normalized, decoded value. */
  value: string;
  /** Offset of the attribute name and one past its closing quote, for splicing. */
  start: number; end: number;
};

export type XmlHandler = {
  /**
   * A start tag. `start` is the offset of `<`, `end` one past `>`. `attributes` is reused by the tokenizer only if
   * the handler does not keep it; the tokenizer always passes a fresh array.
   */
  startElement(name: string, attributes: XmlAttribute[], start: number, end: number, selfClosing: boolean): void;
  /** An end tag (also sent right after a self-closing start tag, with the same offsets). */
  endElement(name: string, start: number, end: number): void;
  /** Character data inside the root element (text and CDATA), decoded. Optional: skipped when absent. */
  text?(value: string): void;
};

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };
/** Characters XML 1.0 forbids anywhere in a document (C0 controls other than tab/LF/CR, and U+FFFE/U+FFFF). */
const ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

const isWhite = (c: number) => c === 0x20 || c === 0x0A || c === 0x09 || c === 0x0D;
const isNameStart = (c: number) => (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) || c === 0x5F || c === 0x3A || (c >= 0xC0 && c !== 0xD7 && c !== 0xF7);
const isNameChar = (c: number) => isNameStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2D || c === 0x2E || c === 0xB7;

/** Local name of a qualified name (`mx:note` → `note`). */
export const localNameOf = (name: string) => { const colon = name.indexOf(':'); return colon < 0 ? name : name.slice(colon + 1); };

function validCodePoint(code: number): boolean {
  return code === 0x9 || code === 0xA || code === 0xD || (code >= 0x20 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF);
}

/**
 * Tokenize `text`, calling `handler` for each start tag, end tag and run of character data. Throws XmlError when
 * the document is not well-formed. Returns the qualified name of the root element.
 */
export function scanXml(text: string, handler: XmlHandler): string {
  if (ILLEGAL_CHARS.test(text)) throw new XmlError('illegal character', text.search(ILLEGAL_CHARS));
  const n = text.length;
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const bodyStart = i;
  const entities: Record<string, string> = Object.create(null);
  const stack: string[] = [];
  let root: string | undefined;
  let rootClosed = false;
  let sawDoctype = false;
  const fail = (detail: string, at = i): never => { throw new XmlError(detail, at); };

  /** Decode references in `raw` (offset `at` for errors). */
  const decode = (raw: string, at: number): string => {
    let out = '';
    let from = 0;
    for (let amp = raw.indexOf('&'); amp >= 0; amp = raw.indexOf('&', from)) {
      const semi = raw.indexOf(';', amp + 1);
      if (semi < 0) fail('unterminated reference', at + amp);
      const ref = raw.slice(amp + 1, semi);
      let value: string | undefined;
      if (ref.charCodeAt(0) === 0x23) {
        const hex = ref.charCodeAt(1) === 0x78;
        const digits = ref.slice(hex ? 2 : 1);
        if (!digits || !(hex ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(digits)) fail('bad character reference', at + amp);
        const code = parseInt(digits, hex ? 16 : 10);
        if (!validCodePoint(code)) fail('character reference to an illegal character', at + amp);
        value = String.fromCodePoint(code);
      } else {
        if (!ref || !isNameStart(ref.charCodeAt(0)) || ![...ref].every(ch => isNameChar(ch.charCodeAt(0)))) fail('bad entity reference', at + amp);
        value = PREDEFINED[ref] ?? entities[ref];
        if (value === undefined) fail(`undefined entity &${ref};`, at + amp);
      }
      out += raw.slice(from, amp) + value;
      from = semi + 1;
    }
    return from ? out + raw.slice(from) : raw;
  };
  const normalizeLines = (raw: string) => raw.indexOf('\r') < 0 ? raw : raw.replace(/\r\n?/g, '\n');
  const attributeValue = (raw: string, at: number) => {
    if (raw.indexOf('<') >= 0) fail('"<" in an attribute value', at);
    const literal = /[\t\n\r]/.test(raw) ? normalizeLines(raw).replace(/[\t\n]/g, ' ') : raw;
    return literal.indexOf('&') < 0 ? literal : decode(literal, at);
  };
  const readName = (): string => {
    const start = i;
    if (i >= n || !isNameStart(text.charCodeAt(i))) fail('expected a name');
    i++;
    while (i < n && isNameChar(text.charCodeAt(i))) i++;
    return text.slice(start, i);
  };
  const skipWhite = () => { while (i < n && isWhite(text.charCodeAt(i))) i++; };
  const expect = (literal: string) => { if (!text.startsWith(literal, i)) fail(`expected "${literal}"`); i += literal.length; };
  const quoted = (): string => {
    const quote = text.charCodeAt(i);
    if (quote !== 0x22 && quote !== 0x27) fail('expected a quoted value');
    const close = text.indexOf(quote === 0x22 ? '"' : "'", i + 1);
    if (close < 0) fail('unterminated quoted value');
    const value = text.slice(i + 1, close);
    i = close + 1;
    return value;
  };

  const characterData = (start: number, end: number) => {
    const raw = text.slice(start, end);
    if (!stack.length) {
      if (!/^[ \t\r\n]*$/.test(raw)) fail('text outside the root element', start);
      return;
    }
    if (raw.indexOf(']]>') >= 0) fail('"]]>" in text', start + raw.indexOf(']]>'));
    const lines = normalizeLines(raw);
    const value = lines.indexOf('&') < 0 ? lines : decode(lines, start);
    handler.text?.(value);
  };

  const doctype = () => {
    if (sawDoctype || root) fail('misplaced DOCTYPE');
    sawDoctype = true;
    i += 9;
    if (!isWhite(text.charCodeAt(i))) fail('expected whitespace after DOCTYPE');
    skipWhite(); readName(); skipWhite();
    if (text.startsWith('SYSTEM', i)) { i += 6; skipWhite(); quoted(); skipWhite(); }
    else if (text.startsWith('PUBLIC', i)) { i += 6; skipWhite(); quoted(); skipWhite(); quoted(); skipWhite(); }
    if (text.charCodeAt(i) === 0x5B) {
      i++;
      // Internal subset: markup declarations, comments, PIs and parameter-entity references.
      for (;;) {
        skipWhite();
        if (i >= n) fail('unterminated DOCTYPE');
        if (text.charCodeAt(i) === 0x5D) { i++; break; }
        if (text.startsWith('<!--', i)) { comment(); continue; }
        if (text.startsWith('<?', i)) { processingInstruction(); continue; }
        if (text.charCodeAt(i) === 0x25) fail('parameter entities are not supported');
        if (text.startsWith('<!ENTITY', i)) {
          i += 8;
          if (!isWhite(text.charCodeAt(i))) fail('expected whitespace in ENTITY');
          skipWhite();
          if (text.charCodeAt(i) === 0x25) fail('parameter entities are not supported');
          const name = readName(); skipWhite();
          if (text.charCodeAt(i) === 0x22 || text.charCodeAt(i) === 0x27) {
            const at = i;
            const raw = quoted();
            if (raw.indexOf('<') >= 0) fail('entity values with markup are not supported', at);
            // The first declaration of an entity is binding.
            if (!(name in entities)) entities[name] = decode(normalizeLines(raw), at);
          } else {
            // External entity: not loaded, so references to it are undefined (like a browser parser).
            if (text.startsWith('SYSTEM', i)) { i += 6; skipWhite(); quoted(); }
            else if (text.startsWith('PUBLIC', i)) { i += 6; skipWhite(); quoted(); skipWhite(); quoted(); }
            else fail('bad ENTITY declaration');
            skipWhite();
            if (text.startsWith('NDATA', i)) { i += 5; skipWhite(); readName(); }
          }
          skipWhite(); expect('>');
          continue;
        }
        if (text.startsWith('<!', i)) {
          // ELEMENT / ATTLIST / NOTATION: skip, honouring quoted strings.
          i += 2;
          while (i < n && text.charCodeAt(i) !== 0x3E) { if (text.charCodeAt(i) === 0x22 || text.charCodeAt(i) === 0x27) quoted(); else i++; }
          expect('>');
          continue;
        }
        fail('bad internal subset');
      }
      skipWhite();
    }
    expect('>');
  };
  function comment() {
    const close = text.indexOf('--', i + 4);
    if (close < 0) fail('unterminated comment');
    if (text.charCodeAt(close + 2) !== 0x3E) fail('"--" in a comment', close);
    i = close + 3;
  }
  function processingInstruction() {
    const start = i;
    i += 2;
    const target = readName();
    if (target.toLowerCase() === 'xml' && (start !== bodyStart || target !== 'xml')) fail('misplaced XML declaration', start);
    const close = text.indexOf('?>', i);
    if (close < 0) fail('unterminated processing instruction');
    if (close > i && !isWhite(text.charCodeAt(i))) fail('bad processing instruction');
    i = close + 2;
  }

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { characterData(i, n); i = n; break; }
    if (lt > i) characterData(i, lt);
    i = lt;
    const next = text.charCodeAt(i + 1);
    if (next === 0x2F) {
      // End tag.
      const start = i;
      i += 2;
      const name = readName();
      skipWhite(); expect('>');
      const open = stack.pop();
      if (open !== name) fail(open ? `</${name}> closes <${open}>` : `unexpected </${name}>`, start);
      if (!stack.length) rootClosed = true;
      handler.endElement(name, start, i);
    } else if (next === 0x21) {
      if (text.startsWith('<!--', i)) comment();
      else if (text.startsWith('<![CDATA[', i)) {
        if (!stack.length) fail('CDATA outside the root element');
        const close = text.indexOf(']]>', i + 9);
        if (close < 0) fail('unterminated CDATA section');
        handler.text?.(normalizeLines(text.slice(i + 9, close)));
        i = close + 3;
      } else if (text.startsWith('<!DOCTYPE', i)) doctype();
      else fail('bad markup declaration');
    } else if (next === 0x3F) processingInstruction();
    else {
      // Start tag.
      const start = i;
      i++;
      if (rootClosed) fail('content after the root element', start);
      const name = readName();
      const attributes: XmlAttribute[] = [];
      let selfClosing = false;
      for (;;) {
        const white = i < n && isWhite(text.charCodeAt(i));
        skipWhite();
        const c = text.charCodeAt(i);
        if (c === 0x3E) { i++; break; }
        if (c === 0x2F) { i++; expect('>'); selfClosing = true; break; }
        if (i >= n) fail('unterminated start tag', start);
        if (!white) fail('expected whitespace between attributes');
        const attributeStart = i;
        const attributeName = readName();
        skipWhite(); expect('='); skipWhite();
        const valueAt = i + 1;
        const raw = quoted();
        for (const other of attributes) if (other.name === attributeName) fail(`duplicate attribute ${attributeName}`, attributeStart);
        attributes.push({ name: attributeName, value: attributeValue(raw, valueAt), start: attributeStart, end: i });
      }
      root ??= name;
      stack.push(name);
      handler.startElement(name, attributes, start, i, selfClosing);
      if (selfClosing) {
        stack.pop();
        if (!stack.length) rootClosed = true;
        handler.endElement(name, start, i);
      }
    }
  }
  if (!root) fail('no root element');
  if (stack.length) fail(`unclosed <${stack.at(-1)}>`, n);
  return root!;
}

/** A light element tree for a captured subtree; it mirrors the parts of the DOM Element API the importers use. */
export class XmlElement {
  readonly localName: string;
  readonly children: XmlElement[] = [];
  /** Child elements and text, in document order (for textContent). */
  private readonly content: (XmlElement | string)[] = [];
  private readonly attributeMap: Map<string, string>;
  constructor(readonly name: string, attributes: readonly XmlAttribute[], readonly parentElement: XmlElement | null = null) {
    this.localName = localNameOf(name);
    this.attributeMap = new Map(attributes.map(attribute => [attribute.name, attribute.value]));
  }
  getAttribute(name: string): string | null { return this.attributeMap.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributeMap.has(name); }
  setAttribute(name: string, value: string): void { this.attributeMap.set(name, value); }
  /** Concatenated character data of the subtree, like Node.textContent. */
  get textContent(): string {
    if (this.content.length === 1 && typeof this.content[0] === 'string') return this.content[0];
    let out = '';
    for (const item of this.content) out += typeof item === 'string' ? item : item.textContent;
    return out;
  }
  append(item: XmlElement | string): void {
    if (typeof item === 'string') {
      const last = this.content.length - 1;
      if (last >= 0 && typeof this.content[last] === 'string') this.content[last] += item;
      else this.content.push(item);
    } else { this.children.push(item); this.content.push(item); }
  }
  /** Descendant elements in document order (like getElementsByTagName('*')). */
  descendants(): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (element: XmlElement) => { for (const item of element.children) { out.push(item); walk(item); } };
    walk(this);
    return out;
  }
}

/** Builds light trees for subtrees a caller chooses to capture while a document streams past. */
export class XmlTreeBuilder {
  private current: XmlElement | null = null;
  /** Whether a captured subtree is open. */
  get capturing(): boolean { return this.current !== null; }
  /** Open an element: a new capture root when `capture` is set and nothing is captured, or a child of the open one. */
  open(name: string, attributes: readonly XmlAttribute[], capture: boolean): XmlElement | null {
    if (!this.current && !capture) return null;
    const element = new XmlElement(name, attributes, this.current);
    this.current?.append(element);
    this.current = element;
    return element;
  }
  /** Close the open element; returns it when it was a capture root (the subtree is complete). */
  close(): XmlElement | null {
    const element = this.current;
    if (!element) return null;
    this.current = element.parentElement;
    return this.current ? null : element;
  }
  text(value: string): void { this.current?.append(value); }
}

/** Parse a whole (small) document into a light tree; throws XmlError when it is not well-formed. */
export function parseXmlTree(text: string): XmlElement {
  const builder = new XmlTreeBuilder();
  let root: XmlElement | null = null;
  scanXml(text, {
    startElement: (name, attributes) => { builder.open(name, attributes, true); },
    endElement: () => { root = builder.close() || root; },
    text: value => builder.text(value),
  });
  return root!;
}
