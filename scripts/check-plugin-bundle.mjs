import fs from "node:fs";
import module from "node:module";

const bundlePath = "plugin-dist/main.js";
const source = fs.readFileSync(bundlePath, "utf8");
const builtins = new Set([
  ...module.builtinModules,
  ...module.builtinModules.map((name) => `node:${name}`),
]);
const allowedExternal = new Set(["obsidian"]);
const allowedOptionalExternal = new Set(["sharp"]);

function isIdentifierChar(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

function skipWhitespace(index) {
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

function readString(index) {
  const quote = source[index];
  if (quote !== '"' && quote !== "'") {
    return null;
  }

  let value = "";
  index += 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, end: index + 1 };
    }
    value += char;
    index += 1;
  }
  return null;
}

function skipString(index) {
  const quote = source[index];
  index += 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === quote) {
      return index;
    }
  }
  return index;
}

function skipLineComment(index) {
  const end = source.indexOf("\n", index + 2);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(index) {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function collectSpecifiers() {
  const specifiers = new Set();
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' || char === "'" || char === "`") {
      index = skipString(index);
      continue;
    }
    if (char === "/" && next === "/") {
      index = skipLineComment(index);
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(index);
      continue;
    }

    const startsRequire = source.startsWith("require", index);
    const startsImport = source.startsWith("import", index);
    if (!startsRequire && !startsImport) {
      index += 1;
      continue;
    }

    const before = source[index - 1] ?? "";
    const after = source[index + (startsRequire ? "require".length : "import".length)] ?? "";
    if (isIdentifierChar(before) || isIdentifierChar(after)) {
      index += 1;
      continue;
    }

    let cursor = skipWhitespace(index + (startsRequire ? "require".length : "import".length));
    if (source[cursor] !== "(") {
      index += 1;
      continue;
    }
    cursor = skipWhitespace(cursor + 1);
    const parsed = readString(cursor);
    if (parsed) {
      const afterString = skipWhitespace(parsed.end);
      if (source[afterString] === ")") {
        specifiers.add(parsed.value);
      }
      index = parsed.end;
      continue;
    }

    index += 1;
  }

  return specifiers;
}

const unexpected = [];
const optional = [];

for (const specifier of [...collectSpecifiers()].sort()) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    builtins.has(specifier) ||
    allowedExternal.has(specifier)
  ) {
    continue;
  }
  if (allowedOptionalExternal.has(specifier)) {
    optional.push(specifier);
    continue;
  }
  unexpected.push(specifier);
}

if (optional.length > 0) {
  console.warn(`Optional plugin externals: ${optional.join(", ")}`);
}

if (unexpected.length > 0) {
  console.error(`Unexpected plugin externals: ${unexpected.join(", ")}`);
  process.exitCode = 1;
}
