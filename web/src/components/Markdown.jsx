import { Fragment } from "react";

/** HTML-escape a string before JSX injection. */
function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Renders inline formatting: **bold**, *italic*, `code`, [text](url).
 * Only http/https link schemes are allowed; anything else renders as text.
 */
function inline(text, prefix = "") {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*]+\*)/g;
  let last = 0;
  let i = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(esc(text.slice(last, m.index)));
    const tok = m[0];
    const key = `${prefix}${i++}`;
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{inline(tok.slice(2, -2), `b${key}`)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="md-code">
          {esc(tok.slice(1, -1))}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (mm && /^https?:\/\//i.test(mm[2])) {
        nodes.push(
          <a key={key} href={mm[2]} target="_blank" rel="noreferrer">
            {mm[1]}
          </a>,
        );
      } else {
        nodes.push(esc(tok));
      }
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key}>{inline(tok.slice(1, -1), `i${key}`)}</em>);
    } else {
      nodes.push(esc(tok));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(esc(text.slice(last)));
  return nodes;
}

/** Renders a non-code block. */
function block(content, index) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // Blockquote: every line starts with ">"
  if (trimmed.split("\n").every((l) => l.trimStart().startsWith(">"))) {
    const quote = trimmed
      .split("\n")
      .map((l) => l.trimStart().replace(/^>\s?/, ""))
      .join("\n");
    return (
      <blockquote key={index} className="md-quote">
        {inline(quote, `q${index}`)}
      </blockquote>
    );
  }

  // Heading
  const head = /^(#{1,4})\s+(.+)$/.exec(trimmed);
  if (head) {
    const level = Math.min(head[1].length, 4);
    return (
      <div key={index} className={`md-h md-h${level}`}>
        {inline(head[2], `h${index}`)}
      </div>
    );
  }

  // Unordered list (consecutive "- " / "* " lines)
  const lines = trimmed.split("\n");
  if (lines.every((l) => /^[-*]\s+/.test(l.trimStart()))) {
    return (
      <ul key={index} className="md-ul">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.trimStart().replace(/^[-*]\s+/, ""), `li${index}-${i}`)}</li>
        ))}
      </ul>
    );
  }

  // Plain paragraph
  return <p key={index}>{inline(trimmed, `p${index}`)}</p>;
}

/**
 * MiniMarkdown. Splits the text line-by-line so fenced code blocks survive
 * internal blank lines, then renders each block. All raw text is escaped.
 */
export function MiniMarkdown({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const open = /^```/.test(line.trimStart());

    if (open) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trimStart())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence
      blocks.push({ type: "code", content: buf.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trimStart())
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "block", content: buf.join("\n") });
  }

  return (
    <div className="md">
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.type === "code" ? (
            <pre className="md-pre">
              <code>{esc(b.content)}</code>
            </pre>
          ) : (
            block(b.content, i)
          )}
        </Fragment>
      ))}
    </div>
  );
}
