import { readEpubPackageMetadata } from "./epub";
import type { Book } from "./types";

function normalizeMetadataValue(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

export async function hydrateEpubPackageMetadata<T extends Book>(books: T[]): Promise<T[]> {
  return Promise.all(
    books.map(async (book) => {
      if (book.format !== "EPUB") {
        return book;
      }

      const metadata = await readEpubPackageMetadata(book.path);
      return {
        ...book,
        title: normalizeMetadataValue(book.title) ?? normalizeMetadataValue(metadata.title) ?? book.title,
        author: normalizeMetadataValue(book.author) ?? normalizeMetadataValue(metadata.creator),
        publisher: normalizeMetadataValue(book.publisher) ?? normalizeMetadataValue(metadata.publisher),
      };
    }),
  );
}
