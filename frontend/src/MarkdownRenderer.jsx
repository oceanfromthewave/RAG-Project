import { useState } from "react";

function inlineFormat(text, keyPrefix = "") {
  if (!text) return null;
  const parts = [];
  // **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-t${idx++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    if (match[0].startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b${idx++}`}>{match[2]}</strong>);
    } else if (match[0].startsWith("*")) {
      parts.push(<em key={`${keyPrefix}-i${idx++}`}>{match[3]}</em>);
    } else if (match[0].startsWith("`")) {
      parts.push(<code key={`${keyPrefix}-c${idx++}`}>{match[4]}</code>);
    } else if (match[0].startsWith("[")) {
      parts.push(<a key={`${keyPrefix}-a${idx++}`} href={match[6]} target="_blank" rel="noopener noreferrer">{match[5]}</a>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-t${idx++}`}>{text.slice(lastIndex)}</span>);
  }
  return parts.length === 0 ? <span key={`${keyPrefix}-fallback`}>{text}</span> : parts;
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || "code"}</span>
        <button className="md-code-copy" onClick={handleCopy}>
          {copied ? "✓ 복사됨" : "복사"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function TableBlock({ lines, blockIdx }) {
  if (lines.length < 2) return null;
  const parseRow = (line) => line.split("|").filter((_, i, arr) => (i > 0 && i < arr.length - 1) || (arr.length === 1)).map(c => c.trim());
  
  const header = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="md-table-wrapper">
      <table className="md-table">
        <thead>
          <tr>
            {header.map((h, i) => <th key={`${blockIdx}-th-${i}`}>{inlineFormat(h, `th-${i}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${blockIdx}-tr-${i}`}>
              {row.map((cell, j) => <td key={`${blockIdx}-td-${i}-${j}`}>{inlineFormat(cell, `td-${i}-${j}`)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextBlock({ text, blockIdx }) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = Math.min(hMatch[1].length, 6);
      const Tag = `h${level}`;
      elements.push(<Tag key={`${blockIdx}-h-${i}`} className="md-heading">{inlineFormat(hMatch[2], `h-${i}`)}</Tag>);
      i++; continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={`${blockIdx}-hr-${i}`} className="md-hr" />);
      i++; continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(<blockquote key={`${blockIdx}-bq-${i}`} className="md-blockquote">{inlineFormat(quoteLines.join("\n"), `bq-${i}`)}</blockquote>);
      continue;
    }

    // Table detection: starts with | and next line has |---|
    if (line.startsWith("|") && lines[i+1]?.trim().match(/^\|?[:\s-]*\|[:\s-]*\|/)) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<TableBlock key={`${blockIdx}-tbl-${i}`} lines={tableLines} blockIdx={blockIdx} />);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(<li key={`${blockIdx}-li-${i}`}>{inlineFormat(lines[i].replace(/^[-*+]\s/, ""), `li-${i}`)}</li>);
        i++;
      }
      elements.push(<ul key={`${blockIdx}-ul-${i}`} className="md-ul">{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={`${blockIdx}-oli-${i}`}>{inlineFormat(lines[i].replace(/^\d+\.\s/, ""), `oli-${i}`)}</li>);
        i++;
      }
      elements.push(<ol key={`${blockIdx}-ol-${i}`} className="md-ol">{items}</ol>);
      continue;
    }

    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Paragraph: collect consecutive non-special lines
    const stopRe = /^(#{1,6}\s|[-*+]\s|\d+\.\s|> |(-{3,}|\*{3,}|_{3,})$)/;
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !stopRe.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(<p key={`${blockIdx}-p-${i}`} className="md-p">{inlineFormat(paraLines.join(" "), `p-${i}`)}</p>);
    }
  }

  return <>{elements}</>;
}

export default function SimpleMarkdown({ content }) {
  if (!content) return null;

  // Split out fenced code blocks
  const parts = [];
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  let idx = 0;

  while ((match = codeRe.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", content: content.slice(last, match.index), idx: idx++ });
    }
    parts.push({ type: "code", lang: match[1], code: match[2].trimEnd(), idx: idx++ });
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    parts.push({ type: "text", content: content.slice(last), idx: idx++ });
  }

  return (
    <div className="markdown-body">
      {parts.map((p) =>
        p.type === "code"
          ? <CodeBlock key={p.idx} lang={p.lang} code={p.code} />
          : <TextBlock key={p.idx} text={p.content} blockIdx={p.idx} />
      )}
    </div>
  );
}
