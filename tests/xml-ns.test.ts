import test from "node:test";
import assert from "node:assert/strict";
import {
  findXmlChild,
  findXmlDescendant,
  findXmlDescendants,
  getXmlAttr,
  getXmlText,
  parseXmlDocument,
} from "../src/lib/xml-ns";

test("parseXmlDocument ignores declarations and exposes local names", () => {
  const root = parseXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>
<ns0:package xmlns:ns0="http://www.idpf.org/2007/opf">
  <ns0:manifest>
    <ns0:item id="doc10" href="Text/chapter1.html" media-type="application/xhtml+xml"/>
  </ns0:manifest>
</ns0:package>
`);

  assert.equal(root?.name, "ns0:package");
  assert.equal(root?.localName, "package");
  const item = root ? findXmlDescendant(root, "item") : null;
  assert.equal(item?.localName, "item");
  assert.equal(item ? getXmlAttr(item, "id") : null, "doc10");
  assert.equal(item ? getXmlAttr(item, "href") : null, "Text/chapter1.html");
});

test("getXmlAttr reads exact and namespaced attributes by local name", () => {
  const root = parseXmlDocument(`<html xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc" id="toc">
      <ol><li><a href="chapter.xhtml">Chapter</a></li></ol>
    </nav>
    <link type="text/css"/>
  </body>
</html>`);

  assert.ok(root);
  const nav = findXmlDescendant(root, "nav");
  const link = findXmlDescendant(root, "link");
  assert.equal(nav ? getXmlAttr(nav, "epub:type") : null, "toc");
  assert.equal(nav ? getXmlAttr(nav, "type") : null, "toc");
  assert.equal(link ? getXmlAttr(link, "type") : null, "text/css");
});

test("getXmlText collects text across nested markup", () => {
  const root = parseXmlDocument("<a href=\"chapter.xhtml\">Title <span>with inline</span> text</a>");

  assert.equal(root ? getXmlText(root).replace(/\s+/g, " ").trim() : "", "Title with inline text");
});

test("findXml helpers search children and descendants by local name", () => {
  const root = parseXmlDocument(`<root>
  <section><item id="nested"/></section>
  <item id="direct"/>
</root>`);

  assert.ok(root);
  assert.equal(findXmlChild(root, "item") ? getXmlAttr(findXmlChild(root, "item")!, "id") : null, "direct");
  assert.equal(findXmlDescendants(root, "item").length, 2);
});

test("parseXmlDocument returns null for malformed XML", () => {
  assert.equal(parseXmlDocument("<root><unclosed></root>"), null);
});
