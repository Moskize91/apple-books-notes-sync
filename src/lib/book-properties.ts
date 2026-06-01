import YAML from "yaml";

export const BOOK_PROPERTY_KEYS = {
  title: "title",
  author: "author",
  publisher: "publisher",
  format: "format",
  annotationCount: "annotation_count",
  annotatedPages: "annotated_pages",
  lastModifiedAt: "last_modified_at",
  cover: "cover",
  sourceFile: "source_file",
  syncPaused: "sync_paused",
} as const;

export const BOOK_RETIRED_PROPERTY_KEYS = ["pdf_beta"] as const;

export const BOOK_INTERACTIVE_PROPERTY_DEFAULTS = {
  [BOOK_PROPERTY_KEYS.syncPaused]: false,
} as const;

export const BOOK_INTERACTIVE_PROPERTY_KEYS = Object.keys(
  BOOK_INTERACTIVE_PROPERTY_DEFAULTS,
) as Array<keyof typeof BOOK_INTERACTIVE_PROPERTY_DEFAULTS>;

export const BOOK_PRESET_PROPERTY_KEYS = [
  BOOK_PROPERTY_KEYS.title,
  BOOK_PROPERTY_KEYS.author,
  BOOK_PROPERTY_KEYS.publisher,
  BOOK_PROPERTY_KEYS.format,
  BOOK_PROPERTY_KEYS.annotationCount,
  BOOK_PROPERTY_KEYS.annotatedPages,
  BOOK_PROPERTY_KEYS.lastModifiedAt,
  BOOK_PROPERTY_KEYS.cover,
  BOOK_PROPERTY_KEYS.sourceFile,
  BOOK_PROPERTY_KEYS.syncPaused,
] as const;

const BOOK_PRESET_PROPERTY_KEY_SET = new Set<string>(BOOK_PRESET_PROPERTY_KEYS);
const BOOK_RETIRED_PROPERTY_KEY_SET = new Set<string>(BOOK_RETIRED_PROPERTY_KEYS);
const BOOK_INTERACTIVE_PROPERTY_KEY_SET = new Set<string>(BOOK_INTERACTIVE_PROPERTY_KEYS);

type FrontmatterParts = {
  frontmatter: string;
  body: string;
};

type FrontmatterObject = Record<string, unknown>;

export function mergeBookMarkdownProperties(generatedMarkdown: string, existingMarkdown: string | null): string {
  if (!existingMarkdown) {
    return generatedMarkdown;
  }

  const generatedParts = splitFrontmatter(generatedMarkdown);
  if (!generatedParts) {
    return generatedMarkdown;
  }

  const generatedProperties = parseFrontmatterObject(generatedParts.frontmatter);
  if (!generatedProperties) {
    return generatedMarkdown;
  }

  const existingParts = splitFrontmatter(existingMarkdown);
  const existingProperties = existingParts ? parseFrontmatterObject(existingParts.frontmatter) : null;
  if (!existingProperties) {
    return generatedMarkdown;
  }

  const mergedEntries = buildMergedPropertyEntries(generatedProperties, existingProperties);
  return `${renderFrontmatterEntries(mergedEntries)}${generatedParts.body}`;
}

export function hasBookMarkdownPropertyDrift(generatedMarkdown: string, existingMarkdown: string | null): boolean {
  if (!existingMarkdown) {
    return true;
  }

  const generatedParts = splitFrontmatter(generatedMarkdown);
  if (!generatedParts) {
    return false;
  }

  const generatedProperties = parseFrontmatterObject(generatedParts.frontmatter);
  if (!generatedProperties) {
    return false;
  }

  const existingParts = splitFrontmatter(existingMarkdown);
  const existingProperties = existingParts ? parseFrontmatterObject(existingParts.frontmatter) : null;
  if (!existingProperties) {
    return true;
  }

  for (const [key, generatedValue] of Object.entries(generatedProperties)) {
    if (isInteractiveBookPropertyKey(key)) {
      if (!isValidInteractiveBookPropertyValue(key, existingProperties[key])) {
        return true;
      }
      continue;
    }

    if (!isDeepEqual(existingProperties[key], generatedValue)) {
      return true;
    }
  }

  for (const key of Object.keys(existingProperties)) {
    if (BOOK_RETIRED_PROPERTY_KEY_SET.has(key)) {
      return true;
    }

    if (BOOK_PRESET_PROPERTY_KEY_SET.has(key) && !(key in generatedProperties)) {
      return true;
    }
  }

  return false;
}

export function readBookSyncPaused(markdown: string | null): boolean {
  if (!markdown) {
    return false;
  }

  const existingParts = splitFrontmatter(markdown);
  const existingProperties = existingParts ? parseFrontmatterObject(existingParts.frontmatter) : null;
  return existingProperties?.[BOOK_PROPERTY_KEYS.syncPaused] === true;
}

function splitFrontmatter(markdown: string): FrontmatterParts | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) {
    return null;
  }

  const frontmatter = match[1] ?? "";
  let body = markdown.slice(match[0].length);
  if (body.startsWith("\r\n")) {
    body = body.slice(2);
  } else if (body.startsWith("\n")) {
    body = body.slice(1);
  }
  return { frontmatter, body };
}

function parseFrontmatterObject(frontmatter: string): FrontmatterObject | null {
  try {
    const parsed = YAML.parse(frontmatter) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

function buildMergedPropertyEntries(
  generatedProperties: FrontmatterObject,
  existingProperties: FrontmatterObject,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];

  for (const [key, generatedValue] of Object.entries(generatedProperties)) {
    if (isInteractiveBookPropertyKey(key) && isValidInteractiveBookPropertyValue(key, existingProperties[key])) {
      entries.push([key, existingProperties[key]]);
      continue;
    }
    entries.push([key, generatedValue]);
  }

  for (const [key, existingValue] of Object.entries(existingProperties)) {
    if (BOOK_PRESET_PROPERTY_KEY_SET.has(key) || BOOK_RETIRED_PROPERTY_KEY_SET.has(key)) {
      continue;
    }
    entries.push([key, existingValue]);
  }

  return entries;
}

function renderFrontmatterEntries(entries: Array<[string, unknown]>): string {
  const lines = ["---"];
  for (const [key, value] of entries) {
    lines.push(...renderFrontmatterEntry(key, value));
  }
  lines.push("---");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderFrontmatterEntry(key: string, value: unknown): string[] {
  if (!isSimpleYamlKey(key) || isComplexYamlValue(value)) {
    return YAML.stringify({ [key]: value }, { lineWidth: 0 }).trimEnd().split(/\r?\n/);
  }

  if (typeof value === "string") {
    const renderedValue =
      key === BOOK_PROPERTY_KEYS.lastModifiedAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
        ? value
        : JSON.stringify(value);
    return [`${key}: ${renderedValue}`];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [`${key}: ${String(value)}`];
  }

  if (value === null) {
    return [`${key}: null`];
  }

  return YAML.stringify({ [key]: value }, { lineWidth: 0 }).trimEnd().split(/\r?\n/);
}

function isInteractiveBookPropertyKey(key: string): key is keyof typeof BOOK_INTERACTIVE_PROPERTY_DEFAULTS {
  return BOOK_INTERACTIVE_PROPERTY_KEY_SET.has(key);
}

function isValidInteractiveBookPropertyValue(
  key: keyof typeof BOOK_INTERACTIVE_PROPERTY_DEFAULTS,
  value: unknown,
): boolean {
  switch (key) {
    case BOOK_PROPERTY_KEYS.syncPaused:
      return typeof value === "boolean";
  }
}

function isPlainObject(value: unknown): value is FrontmatterObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComplexYamlValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function isSimpleYamlKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key);
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => isDeepEqual(value, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && isDeepEqual(left[key], right[key]))
    );
  }

  return false;
}
