/** Minimal string-based XML writing: escaping plus element helpers that pretty-print with two-space indents. */

export type Attrs = Record<string, string | number | undefined>;
export type Child = string | false | null | undefined;

export function escapeXml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Raw newlines would be re-indented by `el`; character references keep text exact.
    .replace(/\r?\n/g, '&#10;');
}

function open(name: string, attrs?: Attrs): string {
  const text = Object.entries(attrs ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  return `<${name}${text}`;
}

/** `<name …>text</name>`, or the empty `<name …/>` when `text` is undefined. */
export function leaf(name: string, text?: string | number, attrs?: Attrs): string {
  return text === undefined ? `${open(name, attrs)}/>` : `${open(name, attrs)}>${escapeXml(text)}</${name}>`;
}

/** An element whose children are elements, one per line and indented; falsy children are skipped. */
export function el(name: string, attrs: Attrs | undefined, children: Child[]): string {
  const kids = children.filter((child): child is string => Boolean(child));
  if (!kids.length) return `${open(name, attrs)}/>`;
  const body = kids.map((kid) => kid.replace(/^/gm, '  ')).join('\n');
  return `${open(name, attrs)}>\n${body}\n</${name}>`;
}
