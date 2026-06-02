import test from "node:test";
import assert from "node:assert/strict";
import { OBSIDIAN_OPEN_PDF_ACTION } from "../src/lib/obsidian-protocol";
import {
  buildEpubRenderedChapters,
  buildPdfRenderedChapters,
  renderEpubBookMarkdown,
  renderEpubChapterIndexMarkdown,
  renderEpubChapterMarkdown,
  renderIndexMarkdown,
  renderPdfBookMarkdown,
  renderPdfChapterIndexMarkdown,
  renderPdfChapterMarkdown,
} from "../src/lib/render-markdown";
import type { Book, EpubAnnotation } from "../src/lib/types";

const demoBook: Book = {
  assetId: "ABCDEF0123456789",
  title: "Demo Book",
  author: "Author",
  publisher: "Publisher",
  path: "/tmp/demo.epub",
  format: "EPUB",
  annotationCount: 1,
  annotationModifiedAt: new Date("2026-05-30T04:34:56Z"),
};

test("renderIndexMarkdown includes key fields", () => {
  const output = renderIndexMarkdown(
    [demoBook],
    new Date("2026-02-01T00:00:00Z"),
    "books",
    new Map([[demoBook.assetId, "books/demo-short-name.md"]]),
    {
      [demoBook.assetId]: {
        assetId: demoBook.assetId,
        title: "demo-short-name",
        format: "EPUB",
        hash: "EPUB|mod:1|schema:30",
        lastSyncedAt: "2026-02-01T00:00:00.000Z",
        bookFileRelativePath: "books/demo-short-name.md",
        chapterNotes: false,
        chapterFileRelativePaths: [],
        pdfAssetDirRelativePath: null,
        coverImageRelativePath: null,
      },
    },
  );
  assert.match(output, /^---\n/m);
  assert.match(output, /title: "Apple Books Notes Sync Index"/);
  assert.match(output, /generated_at: "2026-02-01 00:00:00"/);
  assert.match(output, /book_count: 1/);
  assert.match(output, /\| 书名 \| 作者 \| 格式 \|/);
  assert.match(output, /\[\[books\/demo-short-name\]\]/);
  assert.match(output, /\| Author \| EPUB \|/);
});

test("renderIndexMarkdown sorts by lastSyncedAt desc without showing timestamp column", () => {
  const newerBook: Book = {
    ...demoBook,
    assetId: "NEWER",
    title: "Newer",
    author: "A",
  };
  const olderBook: Book = {
    ...demoBook,
    assetId: "OLDER",
    title: "Older",
    author: "B",
  };

  const output = renderIndexMarkdown(
    [olderBook, newerBook],
    new Date("2026-02-01T00:00:00Z"),
    "books",
    new Map([
      [olderBook.assetId, "books/older.md"],
      [newerBook.assetId, "books/newer.md"],
    ]),
    {
      [olderBook.assetId]: {
        assetId: olderBook.assetId,
        title: "older",
        format: "EPUB",
        hash: "EPUB|mod:1|schema:30",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        bookFileRelativePath: "books/older.md",
        chapterNotes: false,
        chapterFileRelativePaths: [],
        pdfAssetDirRelativePath: null,
        coverImageRelativePath: null,
      },
      [newerBook.assetId]: {
        assetId: newerBook.assetId,
        title: "newer",
        format: "EPUB",
        hash: "EPUB|mod:2|schema:30",
        lastSyncedAt: "2026-02-01T00:00:00.000Z",
        bookFileRelativePath: "books/newer.md",
        chapterNotes: false,
        chapterFileRelativePaths: [],
        pdfAssetDirRelativePath: null,
        coverImageRelativePath: null,
      },
    },
  );

  const newerIndex = output.indexOf("[[books/newer]]");
  const olderIndex = output.indexOf("[[books/older]]");
  assert.notEqual(newerIndex, -1);
  assert.notEqual(olderIndex, -1);
  assert.ok(newerIndex < olderIndex);
  assert.doesNotMatch(output, /最后同步/);
});

test("renderEpubBookMarkdown groups by chapter", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Highlighted text",
      noteText: "My note",
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /^---\n/m);
  assert.match(output, /title: "Demo Book"/);
  assert.match(output, /author: "Author"/);
  assert.match(output, /format: "EPUB"/);
  assert.match(output, /annotation_count: 1/);
  assert.match(output, /last_modified_at: 2026-05-30T04:34:56/);
  assert.match(output, /open_url: "\[Demo Book\]\(<ibooks:\/\/assetid\/ABCDEF0123456789>\)"/);
  assert.match(output, /## 未分章/);
  assert.doesNotMatch(output, /## chapter-1\.xhtml/);
  assert.match(output, /\[2026-02-01 00:00:00\]\(<ibooks:\/\/assetid\/ABCDEF0123456789#epubcfi\(.*\)>\) Highlighted text/);
  assert.match(output, /\nMy note\n/);
  assert.doesNotMatch(output, /- 笔记:/);
});

test("renderEpubBookMarkdown includes cover path when available", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Highlighted text",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(
    demoBook,
    annotations,
    undefined,
    undefined,
    "[[iBooks/assets/covers/ABCDEF0123456789.png]]",
  );
  assert.ok(output.includes('cover: "[[iBooks/assets/covers/ABCDEF0123456789.png]]"'));
});

test("renderEpubBookMarkdown omits cover property when unavailable", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Highlighted text",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.doesNotMatch(output, /^cover:/m);
});

test("renderEpubBookMarkdown maps internal chapter ids to 未分章", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "id_11",
      selectedText: "A",
      noteText: null,
      location: "epubcfi(/6/22[id_11]!/4/2[chapter]/1:1)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "id_6",
      selectedText: "B",
      noteText: null,
      location: "epubcfi(/6/12[id_6]!/4/2[chapter]/1:1)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /## 未分章/);
  assert.doesNotMatch(output, /## id_11/);
  assert.doesNotMatch(output, /## id_6/);
});

test("renderEpubBookMarkdown normalizes quote whitespace and note blank edges", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "  line1 \n   line2\tline3  ",
      noteText: "\n\n  first line\n    second line\nthird line   \n\n",
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /> \[2026-02-01 00:00:00\]\(<ibooks:\/\/assetid\/ABCDEF0123456789#epubcfi\(.*\)>\) line1 line2 line3/);
  assert.match(output, /\n {2}first line\n {4}second line\nthird line\n/);
  assert.doesNotMatch(output, /\n\n\n {2}first line/);
  assert.doesNotMatch(output, /third line {3}/);
});

test("renderEpubBookMarkdown omits note block when note is empty", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Only quote",
      noteText: " \n \n",
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /Only quote/);
  assert.doesNotMatch(output, /笔记:/);
});

test("renderEpubBookMarkdown collapses multi-paragraph selected text into one quote line", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "钱宝琮得到结论：\n\n余考《周髀》所详天体论。",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(
    output,
    /> \[2026-02-01 00:00:00\]\(<ibooks:\/\/assetid\/ABCDEF0123456789#epubcfi\(.*\)>\) 钱宝琮得到结论：余考《周髀》所详天体论。/,
  );
  assert.doesNotMatch(output, /钱宝琮得到结论：:/);
  assert.doesNotMatch(output, /\n余考《周髀》所详天体论。\n/);
});

test("renderEpubBookMarkdown keeps single separator between entries", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "First",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Second",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:6,:10)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.doesNotMatch(output, /---\n\n---/);
  assert.match(output, /First/);
  assert.match(output, /Second/);
});

test("renderEpubChapterIndexMarkdown links generated chapter notes", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "id_1",
      selectedText: "First chapter quote",
      noteText: null,
      location: "epubcfi(/6/8[id_1]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "id_2",
      selectedText: "Second chapter quote",
      noteText: "Second note",
      location: "epubcfi(/6/10[id_2]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
  ];
  const chapters = buildEpubRenderedChapters(
    annotations,
    new Map([
      ["id_1", "第一章"],
      ["id_2", "第二章"],
    ]),
    new Map([
      ["id_1", 1],
      ["id_2", 2],
    ]),
  );

  const indexOutput = renderEpubChapterIndexMarkdown(demoBook, chapters, [
    "books/Demo Book/001-第一章.md",
    "books/Demo Book/002-第二章.md",
  ]);
  const chapterOutput = renderEpubChapterMarkdown(demoBook, chapters[1]!, 2);

  assert.match(indexOutput, /chapter_notes: true/);
  assert.match(indexOutput, /\[\[books\/Demo Book\/001-第一章\|第一章\]\]/);
  assert.match(indexOutput, /\| \[\[books\/Demo Book\/002-第二章\|第二章\]\] \| 1 \|/);
  assert.match(chapterOutput, /book_title: "Demo Book"/);
  assert.match(chapterOutput, /chapter: "第二章"/);
  assert.match(chapterOutput, /Second chapter quote/);
  assert.match(chapterOutput, /\nSecond note\n/);
});

test("renderPdfBookMarkdown renders single text note directly", () => {
  const pdfBook: Book = {
    ...demoBook,
    format: "PDF",
    path: "/tmp/demo.pdf",
    annotationCount: null,
    annotationModifiedAt: new Date("2026-05-30T04:34:56Z"),
  };
  const output = renderPdfBookMarkdown(
    pdfBook,
    [
      {
        pageNumber: 8,
        imageRelativePath: "assets/pdf/asset-id/page-8.png",
        notes: [
          {
            marker: null,
            quoteText: "  单条 原文 \n  内容 ",
            noteText: " \n\n 单条笔记内容\n",
            hasRect: true,
          },
        ],
      },
    ],
    null,
    new Date("2026-05-31T01:02:03Z"),
  );

  assert.doesNotMatch(output, /## 页面标注/);
  assert.doesNotMatch(output, /### 第 8 页/);
  assert.match(output, /---/);
  assert.match(output, /last_modified_at: 2026-05-31T01:02:03/);
  assert.doesNotMatch(output, /last_modified_at: 2026-05-30T04:34:56/);
  assert.match(
    output,
    new RegExp(`open_url: "\\[Demo Book\\]\\(<obsidian:\\/\\/${OBSIDIAN_OPEN_PDF_ACTION}\\?pdf=%2Ftmp%2Fdemo\\.pdf>\\)"`),
  );
  assert.match(
    output,
    new RegExp(
      `<p align="center"><img src="\\.\\.\\/assets\\/pdf\\/asset-id\\/page-8\\.png" alt="第8页" \\/> <a href="obsidian:\\/\\/${OBSIDIAN_OPEN_PDF_ACTION}\\?pdf=%2Ftmp%2Fdemo\\.pdf&amp;page=8">第 8 页<\\/a><\\/p>`,
    ),
  );
  assert.match(output, /> 单条原文内容/);
  assert.match(output, /\n ?单条笔记内容\n/);
  assert.doesNotMatch(output, /\*\*标注/);
  const imageIndex = output.indexOf('<p align="center"><img src="../assets/pdf/asset-id/page-8.png" alt="第8页" />');
  const noteIndex = output.indexOf("单条笔记内容");
  assert.notEqual(imageIndex, -1);
  assert.notEqual(noteIndex, -1);
  assert.ok(imageIndex < noteIndex);
  assert.doesNotMatch(output, /\n!\[第8页\]/);
  assert.doesNotMatch(output, /^> !\[第8页\]/m);
});

test("renderPdfBookMarkdown renders multiple notes with markers and separators", () => {
  const pdfBook: Book = {
    ...demoBook,
    format: "PDF",
    annotationCount: null,
    annotationModifiedAt: null,
  };
  const output = renderPdfBookMarkdown(pdfBook, [
    {
      pageNumber: 12,
      imageRelativePath: "assets/pdf/asset-id/page-12.png",
      notes: [
        {
          marker: "①",
          quoteText: "第一条原文",
          noteText: "第一条笔记",
          hasRect: true,
        },
        {
          marker: "②",
          quoteText: "第二条原文",
          noteText: "第二条笔记",
          hasRect: false,
        },
      ],
    },
  ]);

  assert.match(output, /> \*\*标注 ①\*\* 第一条原文/);
  assert.match(output, /第一条笔记/);
  assert.match(output, /> \*\*标注 ②\*\* 第二条原文/);
  assert.match(output, /第二条笔记/);
  assert.match(output, /\n---\n\n> \*\*标注 ②\*\*/);
});

test("renderPdf chapter helpers group pages by outline leaves", () => {
  const pdfBook: Book = {
    ...demoBook,
    format: "PDF",
    path: "/tmp/demo.pdf",
    annotationCount: null,
    annotationModifiedAt: null,
  };
  const pages = [
    {
      pageNumber: 3,
      imageRelativePath: "assets/pdf/asset-id/page-3.png",
      notes: [{ marker: null, quoteText: "Chapter one page", noteText: "", hasRect: true }],
    },
    {
      pageNumber: 8,
      imageRelativePath: "assets/pdf/asset-id/page-8.png",
      notes: [{ marker: null, quoteText: "Chapter two page", noteText: "PDF note", hasRect: true }],
    },
  ];
  const chapters = buildPdfRenderedChapters(pages, [
    { title: "PDF 第一章", pageNumber: 1, order: 0 },
    { title: "PDF 第二章", pageNumber: 8, order: 1 },
  ]);

  const indexOutput = renderPdfChapterIndexMarkdown(pdfBook, chapters, [
    "books/Demo Book/001-PDF 第一章.md",
    "books/Demo Book/002-PDF 第二章.md",
  ]);
  const chapterOutput = renderPdfChapterMarkdown(pdfBook, chapters[1]!, 2, new Date("2026-05-31T01:02:03Z"));

  assert.equal(chapters.length, 2);
  assert.match(indexOutput, /chapter_notes: true/);
  assert.match(indexOutput, /\[\[books\/Demo Book\/002-PDF 第二章\|PDF 第二章\]\]/);
  assert.match(chapterOutput, /chapter: "PDF 第二章"/);
  assert.match(chapterOutput, /last_modified_at: 2026-05-31T01:02:03/);
  assert.match(chapterOutput, /Chapter two page/);
  assert.match(chapterOutput, /PDF note/);
  assert.match(chapterOutput, /src="..\/..\/assets\/pdf\/asset-id\/page-8.png"/);
});

test("renderEpubBookMarkdown uses chapter spine order instead of title sort", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "id_7",
      selectedText: "From chapter 7",
      noteText: null,
      location: "epubcfi(/6/14[id_7]!/4/2[chapter]/10/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "id_6",
      selectedText: "From chapter 6",
      noteText: null,
      location: "epubcfi(/6/12[id_6]!/4/2[chapter]/10/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(
    demoBook,
    annotations,
    new Map([
      ["id_6", "新版前言"],
      ["id_7", "《周髀算经》新论"],
    ]),
    new Map([
      ["id_6", 5],
      ["id_7", 6],
    ]),
  );

  const chapter6Index = output.indexOf("## 新版前言");
  const chapter7Index = output.indexOf("## 《周髀算经》新论");
  assert.notEqual(chapter6Index, -1);
  assert.notEqual(chapter7Index, -1);
  assert.ok(chapter6Index < chapter7Index);
});

test("renderEpubBookMarkdown uses cfi position order inside chapter", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "late-created-but-early-position",
      assetId: demoBook.assetId,
      chapterKey: "id_7",
      selectedText: "Position 66",
      noteText: null,
      location: "epubcfi(/6/14[id_7]!/4/2[chapter],/66/1:6,/68/2/3:4)",
      createdAt: new Date("2026-02-01T00:00:10Z"),
      kind: "highlight",
    },
    {
      id: "early-created-but-late-position",
      assetId: demoBook.assetId,
      chapterKey: "id_7",
      selectedText: "Position 206",
      noteText: null,
      location: "epubcfi(/6/14[id_7]!/4/2[chapter]/206/1,:0,:47)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(
    demoBook,
    annotations,
    new Map([["id_7", "《周髀算经》新论"]]),
    new Map([["id_7", 6]]),
  );

  const pos66Index = output.indexOf("Position 66");
  const pos206Index = output.indexOf("Position 206");
  assert.notEqual(pos66Index, -1);
  assert.notEqual(pos206Index, -1);
  assert.ok(pos66Index < pos206Index);
});
