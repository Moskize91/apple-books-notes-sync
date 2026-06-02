import type { PdfPageLinkTarget, PdfRenderBackend } from "./types";

export function isPdfRenderBackend(value: unknown): value is PdfRenderBackend {
  return value === "auto" || value === "swift" || value === "mutool" || value === "poppler";
}

export function parsePdfRenderBackend(value: unknown, fallback: PdfRenderBackend = "auto"): PdfRenderBackend {
  if (isPdfRenderBackend(value)) {
    return value;
  }
  return fallback;
}

export function isPdfPageLinkTarget(value: unknown): value is PdfPageLinkTarget {
  return value === "default" || value === "edge" || value === "chrome";
}

export function parsePdfPageLinkTarget(value: unknown, fallback: PdfPageLinkTarget = "edge"): PdfPageLinkTarget {
  if (isPdfPageLinkTarget(value)) {
    return value;
  }
  return fallback;
}
