from __future__ import annotations

from backend.store import DATA_DIR, ensure_storage_dirs, index_document, read_document, ALLOWED_SUFFIXES


def main():
    ensure_storage_dirs()

    indexed_files = 0
    indexed_chunks = 0

    for path in sorted(DATA_DIR.iterdir()):
        if not path.is_file():
            continue

        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue

        text = read_document(path)
        if not text.strip():
            print(f"Skipped empty file: {path.name}")
            continue

        chunk_count = index_document(path.name, text)
        indexed_files += 1
        indexed_chunks += chunk_count
        print(f"Indexed {path.name}: {chunk_count} chunks")

    print(f"Done. Indexed {indexed_files} files / {indexed_chunks} chunks.")


if __name__ == "__main__":
    main()
