import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDoctor } from "../src/lib/doctor";
import type { IBooksPaths } from "../src/lib/types";

test("runDoctor reports missing Apple Books databases without raw SQL noise", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-doctor-"));
  try {
    const paths: IBooksPaths = {
      booksPlistPath: path.join(tempDir, "Books.plist"),
      libraryDbPath: path.join(tempDir, "BKLibrary.sqlite"),
      annotationDbPath: path.join(tempDir, "AEAnnotation.sqlite"),
      epubInfoDbPath: null,
    };

    const report = await runDoctor(paths, null, null);
    const queryCheck = report.checks.find((check) => check.name === "Apple Books data query");

    assert.equal(queryCheck?.ok, false);
    assert.match(queryCheck?.detail ?? "", /Apple Books databases are missing or unreadable/);
    assert.match(queryCheck?.detail ?? "", /HOME was overridden\/isolated/);
    assert.doesNotMatch(queryCheck?.detail ?? "", /SELECT/i);
    assert.deepEqual(report.summary, {
      books: 0,
      epubBooks: 0,
      pdfBooks: 0,
      unsupportedBooks: 0,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
