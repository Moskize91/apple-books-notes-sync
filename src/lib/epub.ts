import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { EpubAnnotation } from "./types";

const CHAPTER_PATTERN = /\[([^\]]+)\]/;
const XML_ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g;
const XML_NAME_PREFIX_PATTERN = String.raw`(?:[A-Za-z_][\w.-]*:)?`;
const execFileAsync = promisify(execFile);

function decodeXmlEntities(input: string): string {
  return input.replace(XML_ENTITY_PATTERN, (match, entity: string) => {
    if (entity === "amp") {
      return "&";
    }
    if (entity === "lt") {
      return "<";
    }
    if (entity === "gt") {
      return ">";
    }
    if (entity === "quot") {
      return '"';
    }
    if (entity === "apos") {
      return "'";
    }

    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const value = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    if (entity.startsWith("#")) {
      const value = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return match;
  });
}

function parseXmlAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = attrPattern.exec(tag);
  while (match) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? "";
    if (key && value !== undefined) {
      attrs.set(key, decodeXmlEntities(value));
    }
    match = attrPattern.exec(tag);
  }
  return attrs;
}

function findRootfilePath(containerXml: string): string | null {
  const match = containerXml.match(new RegExp(`<${XML_NAME_PREFIX_PATTERN}rootfile\\b[^>]*\\bfull-path="([^"]+)"`, "i"));
  if (!match?.[1]) {
    return null;
  }
  return decodeXmlEntities(match[1]);
}

type ParsedOpf = {
  manifestHrefById: Map<string, string>;
  manifestMediaTypeById: Map<string, string>;
  manifestPropertiesById: Map<string, string[]>;
  ncxItemId: string | null;
  navItemId: string | null;
  coverItemId: string | null;
  spineOrderById: Map<string, number>;
};

export type EpubPackageMetadata = {
  title: string | null;
  creator: string | null;
  publisher: string | null;
};

function stripXmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function readXmlElementText(xml: string, elementName: string): string | null {
  const escapedElementName = elementName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escapedElementName}\\b[^>]*>([\\s\\S]*?)</${escapedElementName}>`, "i");
  const match = xml.match(pattern);
  const value = decodeXmlEntities(stripXmlTags(match?.[1] ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

function parseOpfMetadata(opfXml: string): EpubPackageMetadata {
  return {
    title: readXmlElementText(opfXml, "dc:title"),
    creator: readXmlElementText(opfXml, "dc:creator"),
    publisher: readXmlElementText(opfXml, "dc:publisher"),
  };
}

function parseOpfManifest(opfXml: string): ParsedOpf {
  const manifestHrefById = new Map<string, string>();
  const manifestMediaTypeById = new Map<string, string>();
  const manifestPropertiesById = new Map<string, string[]>();
  let ncxItemId: string | null = null;
  let navItemId: string | null = null;
  let coverItemId: string | null = null;
  const spineOrderById = new Map<string, number>();

  const spineTagMatch = opfXml.match(new RegExp(`<${XML_NAME_PREFIX_PATTERN}spine\\b[^>]*>`, "i"));
  if (spineTagMatch?.[0]) {
    const spineAttrs = parseXmlAttributes(spineTagMatch[0]);
    ncxItemId = spineAttrs.get("toc") ?? null;
  }

  const itemrefPattern = new RegExp(`<${XML_NAME_PREFIX_PATTERN}itemref\\b[^>]*>`, "gi");
  let itemrefMatch = itemrefPattern.exec(opfXml);
  let spineIndex = 0;
  while (itemrefMatch) {
    const attrs = parseXmlAttributes(itemrefMatch[0]);
    const idref = attrs.get("idref");
    if (idref && !spineOrderById.has(idref)) {
      spineOrderById.set(idref, spineIndex);
      spineIndex += 1;
    }
    itemrefMatch = itemrefPattern.exec(opfXml);
  }

  const metaPattern = new RegExp(`<${XML_NAME_PREFIX_PATTERN}meta\\b[^>]*>`, "gi");
  let metaMatch = metaPattern.exec(opfXml);
  while (metaMatch) {
    const attrs = parseXmlAttributes(metaMatch[0]);
    if ((attrs.get("name") ?? "").toLowerCase() === "cover") {
      coverItemId = attrs.get("content") ?? coverItemId;
    }
    metaMatch = metaPattern.exec(opfXml);
  }

  const itemPattern = new RegExp(`<${XML_NAME_PREFIX_PATTERN}item\\b[^>]*>`, "gi");
  let itemMatch = itemPattern.exec(opfXml);
  while (itemMatch) {
    const attrs = parseXmlAttributes(itemMatch[0]);
    const id = attrs.get("id");
    const href = attrs.get("href");
    if (id && href) {
      manifestHrefById.set(id, href);
      const mediaType = attrs.get("media-type");
      if (mediaType) {
        manifestMediaTypeById.set(id, mediaType);
      }
      const properties = attrs
        .get("properties")
        ?.split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      if (properties && properties.length > 0) {
        manifestPropertiesById.set(id, properties);
      }
      if (!navItemId && properties?.includes("nav")) {
        navItemId = id;
      }
      if (!coverItemId && properties?.includes("cover-image")) {
        coverItemId = id;
      }
      if (!ncxItemId && attrs.get("media-type") === "application/x-dtbncx+xml") {
        ncxItemId = id;
      }
    }
    itemMatch = itemPattern.exec(opfXml);
  }

  return {
    manifestHrefById,
    manifestMediaTypeById,
    manifestPropertiesById,
    ncxItemId,
    navItemId,
    coverItemId,
    spineOrderById,
  };
}

function parseTocHrefTitleMap(ncxXml: string): Map<string, string> {
  const hrefToTitle = new Map<string, string>();
  const navPointPattern =
    /<navPoint\b[\s\S]*?<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>[\s\S]*?<content\b[^>]*\bsrc="([^"]+)"/gi;
  let navMatch = navPointPattern.exec(ncxXml);
  while (navMatch) {
    const title = decodeXmlEntities(navMatch[1] ?? "").replace(/\s+/g, " ").trim();
    const src = decodeXmlEntities(navMatch[2] ?? "");
    const href = src.split("#")[0]?.trim();
    if (title && href && !hrefToTitle.has(href)) {
      hrefToTitle.set(href, title);
    }
    navMatch = navPointPattern.exec(ncxXml);
  }
  return hrefToTitle;
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function parseNavHrefTitleMap(navXml: string): Map<string, string> {
  const hrefToTitle = new Map<string, string>();
  const tocNavMatch = navXml.match(/<nav\b[^>]*(?:\bepub:type|\btype)\s*=\s*(?:"toc"|'toc')[^>]*>([\s\S]*?)<\/nav>/i);
  const navBody = tocNavMatch?.[1] ?? navXml;
  const linkPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch = linkPattern.exec(navBody);
  while (linkMatch) {
    const hrefRaw = linkMatch[1] ?? linkMatch[2] ?? "";
    const href = decodeXmlEntities(hrefRaw).split("#")[0]?.trim();
    const titleRaw = stripHtmlTags(linkMatch[3] ?? "");
    const title = decodeXmlEntities(titleRaw).replace(/\s+/g, " ").trim();
    if (title && href && !hrefToTitle.has(href)) {
      hrefToTitle.set(href, title);
    }
    linkMatch = linkPattern.exec(navBody);
  }

  return hrefToTitle;
}

function isHtmlTocDocument(html: string): boolean {
  return /<title>\s*Contents\s*<\/title>/i.test(html) || /\bsgc-toc-/i.test(html) || /<nav\b[^>]*(?:\bepub:type|\btype)\s*=\s*(?:"toc"|'toc')/i.test(html);
}

function mergeResolvedHrefTitleMap(
  target: Map<string, string>,
  source: Map<string, string>,
  tocRelativePath: string,
): void {
  const tocDir = path.posix.dirname(tocRelativePath);
  for (const [href, title] of source.entries()) {
    const resolvedPath = resolveEpubRelativePath(tocDir, href);
    if (!target.has(resolvedPath)) {
      target.set(resolvedPath, title);
    }
  }
}

function normalizeEpubRelativePath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath.replace(/\\/g, "/"));
  return normalized.replace(/^\/+/, "").replace(/^(?:\.\.\/)+/g, "");
}

function resolveEpubRelativePath(baseDir: string, href: string): string {
  return normalizeEpubRelativePath(path.posix.join(baseDir, href));
}

async function readDirectoryEntryText(rootPath: string, relativePath: string): Promise<string | null> {
  const filePath = path.resolve(rootPath, relativePath);
  return fs.readFile(filePath, "utf8").catch(() => null);
}

async function readZipEntryText(zipPath: string, relativePath: string): Promise<string | null> {
  const entryPath = normalizeEpubRelativePath(relativePath);
  try {
    const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function readEpubEntryText(bookPath: string, isDirectory: boolean, relativePath: string): Promise<string | null> {
  if (isDirectory) {
    return readDirectoryEntryText(bookPath, relativePath);
  }
  return readZipEntryText(bookPath, relativePath);
}

async function readDirectoryEntryBuffer(rootPath: string, relativePath: string): Promise<Buffer | null> {
  const filePath = path.resolve(rootPath, relativePath);
  return fs.readFile(filePath).catch(() => null);
}

async function readZipEntryBuffer(zipPath: string, relativePath: string): Promise<Buffer | null> {
  const entryPath = normalizeEpubRelativePath(relativePath);
  try {
    const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath], {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch {
    return null;
  }
}

async function readEpubEntryBuffer(bookPath: string, isDirectory: boolean, relativePath: string): Promise<Buffer | null> {
  if (isDirectory) {
    return readDirectoryEntryBuffer(bookPath, relativePath);
  }
  return readZipEntryBuffer(bookPath, relativePath);
}

function findFallbackCoverItemId(parsedOpf: ParsedOpf): string | null {
  for (const [id, properties] of parsedOpf.manifestPropertiesById.entries()) {
    if (properties.includes("cover-image")) {
      return id;
    }
  }

  for (const [id, mediaType] of parsedOpf.manifestMediaTypeById.entries()) {
    const href = parsedOpf.manifestHrefById.get(id) ?? "";
    if (mediaType.startsWith("image/") && /(?:^|[/_-])cover(?:\.[^.]+)?$/i.test(href)) {
      return id;
    }
  }

  for (const [id, mediaType] of parsedOpf.manifestMediaTypeById.entries()) {
    const href = parsedOpf.manifestHrefById.get(id) ?? "";
    if (mediaType.startsWith("image/") && /cover/i.test(`${id} ${href}`)) {
      return id;
    }
  }

  return null;
}

function buildChapterTitleMapByResolvedPath(
  manifestHrefById: Map<string, string>,
  titleByPath: Map<string, string>,
  opfRelativePath: string,
): Map<string, string> {
  const chapterTitleByKey = new Map<string, string>();
  const opfDir = path.posix.dirname(opfRelativePath);

  for (const [key, href] of manifestHrefById.entries()) {
    const contentPath = resolveEpubRelativePath(opfDir, href);
    const matchedTitle = titleByPath.get(contentPath);
    if (matchedTitle) {
      chapterTitleByKey.set(key, matchedTitle);
    }
  }

  return chapterTitleByKey;
}

export async function readEpubChapterTitleByKey(bookPath: string | null): Promise<Map<string, string>> {
  if (!bookPath) {
    return new Map<string, string>();
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return new Map<string, string>();
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return new Map<string, string>();
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return new Map<string, string>();
  }

  const { manifestHrefById, manifestMediaTypeById, ncxItemId, navItemId } = parseOpfManifest(opfXml);
  const titleByPath = new Map<string, string>();

  if (ncxItemId) {
    const ncxHref = manifestHrefById.get(ncxItemId);
    if (ncxHref) {
      const ncxRelativePath = resolveEpubRelativePath(path.posix.dirname(rootfileRelativePath), ncxHref);
      const ncxXml = await readEpubEntryText(bookPath, isDirectory, ncxRelativePath);
      if (ncxXml) {
        mergeResolvedHrefTitleMap(titleByPath, parseTocHrefTitleMap(ncxXml), ncxRelativePath);
      }
    }
  }

  if (navItemId) {
    const navHref = manifestHrefById.get(navItemId);
    if (navHref) {
      const navRelativePath = resolveEpubRelativePath(path.posix.dirname(rootfileRelativePath), navHref);
      const navXml = await readEpubEntryText(bookPath, isDirectory, navRelativePath);
      if (navXml) {
        mergeResolvedHrefTitleMap(titleByPath, parseNavHrefTitleMap(navXml), navRelativePath);
      }
    }
  }

  for (const [itemId, href] of manifestHrefById.entries()) {
    if (itemId === navItemId || itemId === ncxItemId) {
      continue;
    }
    const mediaType = manifestMediaTypeById.get(itemId) ?? "";
    if (!/x?html/i.test(mediaType)) {
      continue;
    }
    const relativePath = resolveEpubRelativePath(path.posix.dirname(rootfileRelativePath), href);
    const html = await readEpubEntryText(bookPath, isDirectory, relativePath);
    if (html && isHtmlTocDocument(html)) {
      mergeResolvedHrefTitleMap(titleByPath, parseNavHrefTitleMap(html), relativePath);
    }
  }

  if (titleByPath.size > 0) {
    return buildChapterTitleMapByResolvedPath(manifestHrefById, titleByPath, rootfileRelativePath);
  }

  return new Map<string, string>();
}

export async function readEpubChapterOrderByKey(bookPath: string | null): Promise<Map<string, number>> {
  if (!bookPath) {
    return new Map<string, number>();
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return new Map<string, number>();
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return new Map<string, number>();
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return new Map<string, number>();
  }

  const { spineOrderById } = parseOpfManifest(opfXml);
  return spineOrderById;
}

export async function readEpubCoverImage(bookPath: string | null): Promise<Buffer | null> {
  if (!bookPath) {
    return null;
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return null;
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return null;
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return null;
  }

  const parsedOpf = parseOpfManifest(opfXml);
  const coverItemId = parsedOpf.coverItemId ?? findFallbackCoverItemId(parsedOpf);
  if (!coverItemId) {
    return null;
  }

  const coverHref = parsedOpf.manifestHrefById.get(coverItemId);
  if (!coverHref) {
    return null;
  }

  const coverRelativePath = resolveEpubRelativePath(path.posix.dirname(rootfileRelativePath), coverHref);
  return readEpubEntryBuffer(bookPath, isDirectory, coverRelativePath);
}

export async function readEpubPackageMetadata(bookPath: string | null): Promise<EpubPackageMetadata> {
  if (!bookPath) {
    return { title: null, creator: null, publisher: null };
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return { title: null, creator: null, publisher: null };
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return { title: null, creator: null, publisher: null };
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return { title: null, creator: null, publisher: null };
  }

  return parseOpfMetadata(opfXml);
}

export function extractChapterKey(location: string | null): string {
  if (!location) {
    return "未分章";
  }

  const match = location.match(CHAPTER_PATTERN);
  if (!match?.[1]) {
    return "未分章";
  }

  return match[1];
}

export function sortEpubAnnotations(annotations: EpubAnnotation[]): EpubAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.createdAt.getTime() !== right.createdAt.getTime()) {
      return left.createdAt.getTime() - right.createdAt.getTime();
    }

    const leftLocation = left.location ?? "";
    const rightLocation = right.location ?? "";
    if (leftLocation !== rightLocation) {
      return leftLocation.localeCompare(rightLocation);
    }

    return left.id.localeCompare(right.id);
  });
}
