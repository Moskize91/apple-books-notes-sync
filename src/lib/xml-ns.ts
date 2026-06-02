import { XMLParser, XMLValidator } from "fast-xml-parser";

const TEXT_NODE_NAME = "#text";
const ATTRIBUTES_NODE_NAME = ":@";

export type XmlNode = {
  name: string;
  localName: string;
  attributes: Map<string, string>;
  children: XmlNode[];
  content: Array<string | XmlNode>;
  text: string;
};

type OrderedXmlNode = Record<string, unknown>;

const parser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: true,
  trimValues: false,
});

function localXmlName(name: string): string {
  const prefixIndex = name.indexOf(":");
  return prefixIndex >= 0 ? name.slice(prefixIndex + 1) : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOrderedAttributes(input: unknown): Map<string, string> {
  const attributes = new Map<string, string>();
  if (!isRecord(input)) {
    return attributes;
  }

  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    attributes.set(name, String(value));
  }
  return attributes;
}

function orderedEntryToNode(entry: OrderedXmlNode): XmlNode | null {
  const elementName = Object.keys(entry).find((key) => key !== ATTRIBUTES_NODE_NAME && key !== TEXT_NODE_NAME);
  if (!elementName) {
    return null;
  }

  const rawChildren = entry[elementName];
  const children: XmlNode[] = [];
  const content: Array<string | XmlNode> = [];
  const textParts: string[] = [];

  if (Array.isArray(rawChildren)) {
    for (const childEntry of rawChildren) {
      if (!isRecord(childEntry)) {
        continue;
      }
      const text = childEntry[TEXT_NODE_NAME];
      if (text !== undefined && text !== null) {
        const textValue = String(text);
        content.push(textValue);
        textParts.push(textValue);
        continue;
      }
      const childNode = orderedEntryToNode(childEntry);
      if (childNode) {
        content.push(childNode);
        children.push(childNode);
      }
    }
  } else if (rawChildren !== undefined && rawChildren !== null) {
    const textValue = String(rawChildren);
    content.push(textValue);
    textParts.push(textValue);
  }

  return {
    name: elementName,
    localName: localXmlName(elementName),
    attributes: readOrderedAttributes(entry[ATTRIBUTES_NODE_NAME]),
    children,
    content,
    text: textParts.join(""),
  };
}

export function parseXmlDocument(xml: string): XmlNode | null {
  if (XMLValidator.validate(xml) !== true) {
    return null;
  }

  const parsed = (() => {
    try {
      return parser.parse(xml) as unknown;
    } catch {
      return null;
    }
  })();
  if (!Array.isArray(parsed)) {
    return null;
  }

  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue;
    }
    const node = orderedEntryToNode(entry);
    if (node) {
      return node;
    }
  }
  return null;
}

export function getXmlAttr(node: XmlNode, name: string): string | null {
  const exact = node.attributes.get(name);
  if (exact !== undefined) {
    return exact;
  }

  for (const [attrName, value] of node.attributes.entries()) {
    if (localXmlName(attrName) === name) {
      return value;
    }
  }
  return null;
}

export function getXmlText(node: XmlNode): string {
  const parts: string[] = [];
  for (const item of node.content) {
    parts.push(typeof item === "string" ? item : getXmlText(item));
  }
  return parts.join("");
}

export function findXmlChild(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((child) => child.localName === name) ?? null;
}

export function findXmlChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.localName === name);
}

export function findXmlDescendant(node: XmlNode, name: string): XmlNode | null {
  for (const child of node.children) {
    if (child.localName === name) {
      return child;
    }
    const descendant = findXmlDescendant(child, name);
    if (descendant) {
      return descendant;
    }
  }
  return null;
}

export function findXmlDescendants(node: XmlNode, name: string): XmlNode[] {
  const matches: XmlNode[] = [];
  for (const child of node.children) {
    if (child.localName === name) {
      matches.push(child);
    }
    matches.push(...findXmlDescendants(child, name));
  }
  return matches;
}
