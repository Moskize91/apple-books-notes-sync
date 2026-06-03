import test from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultBooksBaseRelativePath,
  getBooksFolderRelativePath,
  normalizeVaultRelativePath,
  renderBooksBase,
} from "../src/lib/books-base";

test("getDefaultBooksBaseRelativePath uses the managed folder", () => {
  assert.equal(getDefaultBooksBaseRelativePath("Apple Books Notes"), "Apple Books Notes/Books.base");
  assert.equal(getBooksFolderRelativePath("Apple Books Notes"), "Apple Books Notes/books");
});

test("renderBooksBase filters direct book notes and uses English labels", () => {
  const output = renderBooksBase({ managedDirName: "Apple Books Notes" });
  assert.match(output, /file\.folder == "Apple Books Notes\/books"/);
  assert.match(output, /displayName: Author/);
  assert.match(output, /displayName: Format/);
  assert.match(output, /displayName: Publisher/);
  assert.match(output, /name: Books/);
  assert.doesNotMatch(output, /作者|类型|出版社|表格/);
});

test("normalizeVaultRelativePath rejects paths outside the vault", () => {
  assert.equal(normalizeVaultRelativePath(" Apple Books Notes/Books.base "), "Apple Books Notes/Books.base");
  assert.equal(normalizeVaultRelativePath("Apple Books Notes//Books.base"), "Apple Books Notes/Books.base");
  assert.throws(() => normalizeVaultRelativePath("../Books.base"), /inside the vault/);
  assert.throws(() => normalizeVaultRelativePath("/tmp/Books.base"), /inside the vault/);
  assert.throws(() => normalizeVaultRelativePath(""), /must not be empty/);
});
