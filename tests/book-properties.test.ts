import test from "node:test";
import assert from "node:assert/strict";
import { hasBookMarkdownPropertyDrift, mergeBookMarkdownProperties, readBookChapterNotes } from "../src/lib/book-properties";

test("mergeBookMarkdownProperties preserves user fields and rewrites managed fields", () => {
  const generated = `---
title: "Generated title"
author: "Generated author"
format: "PDF"
sync_paused: false
chapter_notes: false
annotated_pages: 2
---

generated body
`;
  const existing = `---
title: "User title"
author: "User author"
format: "PDF"
sync_paused: true
chapter_notes: true
custom_text: "keep me"
custom_list:
  - one
  - two
pdf_beta: true
---

old body
`;

  const merged = mergeBookMarkdownProperties(generated, existing);

  assert.match(merged, /title: "Generated title"/);
  assert.match(merged, /author: "Generated author"/);
  assert.match(merged, /sync_paused: true/);
  assert.match(merged, /chapter_notes: true/);
  assert.match(merged, /custom_text: "keep me"/);
  assert.match(merged, /custom_list:\n {2}- one\n {2}- two/);
  assert.doesNotMatch(merged, /pdf_beta/);
  assert.match(merged, /\n\ngenerated body\n$/);
  assert.doesNotMatch(merged, /old body/);
});

test("mergeBookMarkdownProperties resets invalid or missing interactive fields", () => {
  const generated = `---
title: "Generated title"
format: "PDF"
sync_paused: false
chapter_notes: false
---

body
`;

  assert.match(
    mergeBookMarkdownProperties(
      generated,
      `---
title: "Generated title"
format: "PDF"
sync_paused: "true"
chapter_notes: "true"
---

old body
`,
    ),
    /sync_paused: false/,
  );
  assert.match(
    mergeBookMarkdownProperties(
      generated,
      `---
title: "Generated title"
format: "PDF"
sync_paused: false
chapter_notes: "true"
---

old body
`,
    ),
    /chapter_notes: false/,
  );

  assert.match(
    mergeBookMarkdownProperties(
      generated,
      `---
title: "Generated title"
format: "PDF"
---

old body
`,
    ),
    /sync_paused: false/,
  );
});

test("hasBookMarkdownPropertyDrift ignores valid interactive edits and user fields", () => {
  const generated = `---
title: "Generated title"
format: "PDF"
sync_paused: false
chapter_notes: false
---

`;
  const existing = `---
title: "Generated title"
format: "PDF"
sync_paused: true
chapter_notes: true
my_field: "user value"
---

body
`;

  assert.equal(hasBookMarkdownPropertyDrift(generated, existing), false);
});

test("hasBookMarkdownPropertyDrift detects managed and invalid interactive fields", () => {
  const generated = `---
title: "Generated title"
format: "PDF"
sync_paused: false
chapter_notes: false
---

`;

  assert.equal(
    hasBookMarkdownPropertyDrift(
      generated,
      `---
title: "User title"
format: "PDF"
sync_paused: true
chapter_notes: true
---

body
`,
    ),
    true,
  );

  assert.equal(
    hasBookMarkdownPropertyDrift(
      generated,
      `---
title: "Generated title"
format: "PDF"
sync_paused: "true"
chapter_notes: false
---

body
`,
    ),
    true,
  );
});

test("hasBookMarkdownPropertyDrift detects retired pdf_beta field", () => {
  const generated = `---
title: "Generated title"
format: "PDF"
sync_paused: false
chapter_notes: false
---

`;
  const existing = `---
title: "Generated title"
format: "PDF"
sync_paused: false
chapter_notes: false
pdf_beta: true
---

body
`;

  assert.equal(hasBookMarkdownPropertyDrift(generated, existing), true);
});

test("readBookChapterNotes reads only valid boolean values", () => {
  assert.equal(
    readBookChapterNotes(`---
title: "Generated title"
chapter_notes: true
---

body
`),
    true,
  );
  assert.equal(
    readBookChapterNotes(`---
title: "Generated title"
chapter_notes: "true"
---

body
`),
    null,
  );
  assert.equal(readBookChapterNotes(null), null);
});
