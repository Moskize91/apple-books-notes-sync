import type { PdfRenderBackend } from "./types";

export function isPdfRenderBackend(value: unknown): value is PdfRenderBackend {
  return value === "auto" || value === "swift" || value === "mutool" || value === "poppler";
}

export function parsePdfRenderBackend(value: unknown, fallback: PdfRenderBackend = "auto"): PdfRenderBackend {
  if (isPdfRenderBackend(value)) {
    return value;
  }
  return fallback;
}
