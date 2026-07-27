import sys
from pathlib import Path

# scripts/ 에서 실행해도 repo 루트를 import 경로에 올려 backend 패키지를 찾게 한다.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.services.rag import ask_rag


def main():
    while True:
        query = input("\nQuestion (or 'exit'): ").strip()

        if not query:
            continue

        if query.lower() in {"exit", "quit"}:
            break

        result = ask_rag(query)
        print("\nAnswer:")
        print(result["answer"])

        if result["sources"]:
            print("\nSources:")
            for source in result["sources"]:
                print(f"- {source['source']} ({source['score']})")


if __name__ == "__main__":
    main()
