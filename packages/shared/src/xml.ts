/** Minimal, dependency-free XML writer with correct escaping. */

export type XmlAttrs = Record<string, string | undefined>;

export type XmlChild = XmlNode | string | null | undefined | false;

export interface XmlNode {
  tag: string;
  attrs?: XmlAttrs;
  children?: XmlChild[];
  /** Force `<tag></tag>` instead of `<tag />` when there are no children. */
  keepOpen?: boolean;
}

export function el(tag: string, attrs?: XmlAttrs, ...children: XmlChild[]): XmlNode {
  return { tag, attrs, children };
}

/** `<tag>text</tag>` shorthand. */
export function leaf(tag: string, text: string | number | boolean, attrs?: XmlAttrs): XmlNode {
  return { tag, attrs, children: [String(text)] };
}

export function escapeXmlText(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function escapeXmlAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

function renderAttrs(attrs: XmlAttrs | undefined): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('');
}

function isNode(child: XmlChild): child is XmlNode {
  return typeof child === 'object' && child !== null && 'tag' in child;
}

function renderNode(node: XmlNode, depth: number, indent: string): string {
  const pad = indent.repeat(depth);
  const kids = (node.children ?? []).filter((c): c is XmlNode | string => c !== null && c !== undefined && c !== false);
  const open = `${pad}<${node.tag}${renderAttrs(node.attrs)}`;

  if (kids.length === 0) {
    return node.keepOpen ? `${open}></${node.tag}>` : `${open} />`;
  }

  if (kids.length === 1 && typeof kids[0] === 'string') {
    return `${open}>${escapeXmlText(kids[0])}</${node.tag}>`;
  }

  const body = kids
    .map((child) => (isNode(child) ? renderNode(child, depth + 1, indent) : `${indent.repeat(depth + 1)}${escapeXmlText(child)}`))
    .join('\n');
  return `${open}>\n${body}\n${pad}</${node.tag}>`;
}

export function renderXml(root: XmlNode, options: { declaration?: string; indent?: string } = {}): string {
  const declaration = options.declaration ?? '<?xml version="1.0" encoding="utf-8"?>';
  return `${declaration}\n${renderNode(root, 0, options.indent ?? '  ')}\n`;
}
