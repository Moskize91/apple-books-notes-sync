import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { EpubAnnotation } from "./types";
import {
  findXmlChild,
  findXmlChildren,
  findXmlDescendant,
  findXmlDescendants,
  getXmlAttr,
  getXmlText,
  parseXmlDocument,
  type XmlNode,
} from "./xml-ns";

const CHAPTER_PATTERN = /\[([^\]]+)\]/;
const execFileAsync = promisify(execFile);

function findRootfilePath(containerXml: string): string | null {
  const root = parseXmlDocument(containerXml);
  const rootfile = root ? findXmlDescendant(root, "rootfile") : null;
  return rootfile ? getXmlAttr(rootfile, "full-path") : null;
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

type EpubTocNode = {
  title: string;
  href: string | null;
  children: EpubTocNode[];
};

function parseOpfMetadata(opfXml: string): EpubPackageMetadata {
  const root = parseXmlDocument(opfXml);
  const metadata = root ? findXmlDescendant(root, "metadata") : null;
  const readMetadataText = (elementName: string): string | null => {
    const element = metadata ? findXmlChild(metadata, elementName) : null;
    const value = element ? getXmlText(element).replace(/\s+/g, " ").trim() : "";
    return value || null;
  };

  return {
    title: readMetadataText("title"),
    creator: readMetadataText("creator"),
    publisher: readMetadataText("publisher"),
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
  const root = parseXmlDocument(opfXml);

  if (!root) {
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

  const spine = findXmlDescendant(root, "spine");
  ncxItemId = spine ? getXmlAttr(spine, "toc") : null;

  if (spine) {
    let spineIndex = 0;
    for (const itemref of findXmlChildren(spine, "itemref")) {
      const idref = getXmlAttr(itemref, "idref");
      if (idref && !spineOrderById.has(idref)) {
        spineOrderById.set(idref, spineIndex);
        spineIndex += 1;
      }
    }
  }

  for (const meta of findXmlDescendants(root, "meta")) {
    if ((getXmlAttr(meta, "name") ?? "").toLowerCase() === "cover") {
      coverItemId = getXmlAttr(meta, "content") ?? coverItemId;
    }
  }

  const manifest = findXmlDescendant(root, "manifest");
  for (const item of manifest ? findXmlChildren(manifest, "item") : []) {
    const id = getXmlAttr(item, "id");
    const href = getXmlAttr(item, "href");
    if (id && href) {
      manifestHrefById.set(id, href);
      const mediaType = getXmlAttr(item, "media-type");
      if (mediaType) {
        manifestMediaTypeById.set(id, mediaType);
      }
      const properties = getXmlAttr(item, "properties")
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
      if (!ncxItemId && mediaType === "application/x-dtbncx+xml") {
        ncxItemId = id;
      }
    }
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
  const root = parseXmlDocument(ncxXml);
  const navMap = root ? findXmlDescendant(root, "navMap") : null;
  for (const navPoint of navMap ? findXmlDescendants(navMap, "navPoint") : []) {
    const navLabel = findXmlChild(navPoint, "navLabel");
    const text = navLabel ? findXmlChild(navLabel, "text") : null;
    const content = findXmlChild(navPoint, "content");
    const title = text ? getXmlText(text).replace(/\s+/g, " ").trim() : "";
    const src = content ? (getXmlAttr(content, "src") ?? "") : "";
    const href = src.split("#")[0]?.trim();
    if (title && href && !hrefToTitle.has(href)) {
      hrefToTitle.set(href, title);
    }
  }
  return hrefToTitle;
}

function splitHrefPath(href: string | null): string | null {
  if (!href) {
    return null;
  }
  return href.split("#")[0]?.trim() || null;
}

function parseNcxTocNode(navPoint: XmlNode): EpubTocNode | null {
  const navLabel = findXmlChild(navPoint, "navLabel");
  const text = navLabel ? findXmlChild(navLabel, "text") : null;
  const title = text ? getXmlText(text).replace(/\s+/g, " ").trim() : "";
  if (!title) {
    return null;
  }
  const content = findXmlChild(navPoint, "content");
  return {
    title,
    href: splitHrefPath(content ? getXmlAttr(content, "src") : null),
    children: findXmlChildren(navPoint, "navPoint")
      .map((child) => parseNcxTocNode(child))
      .filter((node): node is EpubTocNode => Boolean(node)),
  };
}

function parseNcxTocForest(ncxXml: string): EpubTocNode[] {
  const root = parseXmlDocument(ncxXml);
  const navMap = root ? findXmlDescendant(root, "navMap") : null;
  return (navMap ? findXmlChildren(navMap, "navPoint") : [])
    .map((navPoint) => parseNcxTocNode(navPoint))
    .filter((node): node is EpubTocNode => Boolean(node));
}

function findFirstDirectChild(node: XmlNode, names: string[]): XmlNode | null {
  for (const child of node.children) {
    if (names.includes(child.localName)) {
      return child;
    }
  }
  return null;
}

function parseNavLiTocNode(li: XmlNode): EpubTocNode | null {
  const titleNode = findFirstDirectChild(li, ["a", "span"]);
  const title = titleNode ? getXmlText(titleNode).replace(/\s+/g, " ").trim() : "";
  if (!title) {
    return null;
  }
  const childOl = findXmlChild(li, "ol");
  return {
    title,
    href: titleNode?.localName === "a" ? splitHrefPath(getXmlAttr(titleNode, "href")) : null,
    children: (childOl ? findXmlChildren(childOl, "li") : [])
      .map((child) => parseNavLiTocNode(child))
      .filter((node): node is EpubTocNode => Boolean(node)),
  };
}

function parseNavTocForest(navXml: string): EpubTocNode[] {
  const root = parseXmlDocument(navXml);
  if (!root) {
    return [];
  }
  const navs = findXmlDescendants(root, "nav");
  const tocNav = navs.find((nav) => getXmlAttr(nav, "type") === "toc") ?? root;
  const ol = findXmlDescendant(tocNav, "ol");
  if (ol) {
    return findXmlChildren(ol, "li")
      .map((li) => parseNavLiTocNode(li))
      .filter((node): node is EpubTocNode => Boolean(node));
  }
  return findXmlDescendants(tocNav, "a")
    .map((link): EpubTocNode | null => {
      const title = getXmlText(link).replace(/\s+/g, " ").trim();
      if (!title) {
        return null;
      }
      const node: EpubTocNode = { title, href: splitHrefPath(getXmlAttr(link, "href")), children: [] };
      return node;
    })
    .filter((node): node is EpubTocNode => Boolean(node));
}

function buildManifestKeyByResolvedPath(
  manifestHrefById: Map<string, string>,
  opfRelativePath: string,
): Map<string, string> {
  const keyByPath = new Map<string, string>();
  const opfDir = path.posix.dirname(opfRelativePath);
  for (const [key, href] of manifestHrefById.entries()) {
    keyByPath.set(resolveEpubRelativePath(opfDir, href), key);
  }
  return keyByPath;
}

function addTocTitlePaths(
  target: Map<string, string[]>,
  nodes: EpubTocNode[],
  tocRelativePath: string,
  manifestKeyByResolvedPath: Map<string, string>,
  parentTitles: string[] = [],
): void {
  const tocDir = path.posix.dirname(tocRelativePath);
  for (const node of nodes) {
    const titlePath = [...parentTitles, node.title];
    const resolvedPath = node.href ? resolveEpubRelativePath(tocDir, node.href) : null;
    const key = resolvedPath ? manifestKeyByResolvedPath.get(resolvedPath) : undefined;
    if (key && !target.has(key)) {
      target.set(key, titlePath);
    }
    addTocTitlePaths(target, node.children, tocRelativePath, manifestKeyByResolvedPath, titlePath);
  }
}

function parseNavHrefTitleMap(navXml: string): Map<string, string> {
  const hrefToTitle = new Map<string, string>();
  const root = parseXmlDocument(navXml);
  const navs = root ? findXmlDescendants(root, "nav") : [];
  const tocNav = navs.find((nav) => getXmlAttr(nav, "type") === "toc") ?? root;
  if (!tocNav) {
    return hrefToTitle;
  }

  for (const link of findXmlDescendants(tocNav, "a")) {
    const href = (getXmlAttr(link, "href") ?? "").split("#")[0]?.trim();
    const title = getXmlText(link).replace(/\s+/g, " ").trim();
    if (title && href && !hrefToTitle.has(href)) {
      hrefToTitle.set(href, title);
    }
  }

  return hrefToTitle;
}

function isHtmlTocDocument(html: string): boolean {
  if (/\bsgc-toc-/i.test(html)) {
    return true;
  }
  const root = parseXmlDocument(html);
  if (!root) {
    return false;
  }
  const title = findXmlDescendant(root, "title");
  if (title && getXmlText(title).replace(/\s+/g, " ").trim().toLowerCase() === "contents") {
    return true;
  }
  return findXmlDescendants(root, "nav").some((nav) => getXmlAttr(nav, "type") === "toc");
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

export async function readEpubChapterTitlePathByKey(bookPath: string | null): Promise<Map<string, string[]>> {
  if (!bookPath) {
    return new Map<string, string[]>();
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return new Map<string, string[]>();
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return new Map<string, string[]>();
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return new Map<string, string[]>();
  }

  const { manifestHrefById, manifestMediaTypeById, ncxItemId, navItemId } = parseOpfManifest(opfXml);
  const titlePathByKey = new Map<string, string[]>();
  const manifestKeyByResolvedPath = buildManifestKeyByResolvedPath(manifestHrefById, rootfileRelativePath);
  const opfDir = path.posix.dirname(rootfileRelativePath);

  if (ncxItemId) {
    const ncxHref = manifestHrefById.get(ncxItemId);
    if (ncxHref) {
      const ncxRelativePath = resolveEpubRelativePath(opfDir, ncxHref);
      const ncxXml = await readEpubEntryText(bookPath, isDirectory, ncxRelativePath);
      if (ncxXml) {
        addTocTitlePaths(titlePathByKey, parseNcxTocForest(ncxXml), ncxRelativePath, manifestKeyByResolvedPath);
      }
    }
  }

  if (navItemId) {
    const navHref = manifestHrefById.get(navItemId);
    if (navHref) {
      const navRelativePath = resolveEpubRelativePath(opfDir, navHref);
      const navXml = await readEpubEntryText(bookPath, isDirectory, navRelativePath);
      if (navXml) {
        addTocTitlePaths(titlePathByKey, parseNavTocForest(navXml), navRelativePath, manifestKeyByResolvedPath);
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
    const relativePath = resolveEpubRelativePath(opfDir, href);
    const html = await readEpubEntryText(bookPath, isDirectory, relativePath);
    if (html && isHtmlTocDocument(html)) {
      addTocTitlePaths(titlePathByKey, parseNavTocForest(html), relativePath, manifestKeyByResolvedPath);
    }
  }

  return titlePathByKey;
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
