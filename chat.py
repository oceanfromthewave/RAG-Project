from backend.rag import ask_rag


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
