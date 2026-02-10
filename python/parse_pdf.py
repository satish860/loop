"""PDF parser using PyMuPDF4LLM. Extracts text with page markers."""

import sys
import argparse
import pymupdf


def parse_pdf(filepath: str) -> str:
    """Extract text from PDF with --- PAGE N --- markers."""
    try:
        doc = pymupdf.open(filepath)
    except Exception as e:
        print(f"Error: Could not open '{filepath}': {e}", file=sys.stderr)
        sys.exit(1)

    output = []
    for i, page in enumerate(doc, start=1):
        output.append(f"--- PAGE {i} ---")
        text = page.get_text()
        if text.strip():
            output.append(text.strip())
        else:
            output.append("(empty page)")

    doc.close()
    return "\n\n".join(output)


def main():
    parser = argparse.ArgumentParser(description="Extract text from PDF with page markers")
    parser.add_argument("filepath", help="Path to PDF file")
    parser.add_argument("--output", "-o", help="Write output to file instead of stdout")
    args = parser.parse_args()

    result = parse_pdf(args.filepath)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"Written to {args.output} ({result.count('--- PAGE')} pages)")
    else:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print(result)


if __name__ == "__main__":
    main()
