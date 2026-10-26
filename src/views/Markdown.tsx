import type { ReactNode } from "react";

// Kleine Darstellung für Claudes Antworten: Überschriften (##), Aufzählungen (-, 1.) und **fett**.
// Jede ##-Überschrift wird ein eigener Abschnitt, damit sich z. B. der Tagesplan als Kacheln zeigen lässt.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

type Block = { kind: "p" | "ul" | "ol"; lines: string[] };
type Section = { title: string | null; blocks: Block[] };

function parse(text: string): Section[] {
  const sections: Section[] = [{ title: null, blocks: [] }];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const current = sections[sections.length - 1];
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      sections.push({ title: heading[1].replace(/\*\*/g, ""), blocks: [] });
      continue;
    }
    if (!line.trim()) {
      current.blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const kind = bullet ? "ul" : numbered ? "ol" : "p";
    const content = bullet?.[1] ?? numbered?.[1] ?? line;
    const last = current.blocks[current.blocks.length - 1];
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(content);
    else current.blocks.push({ kind, lines: [content] });
  }
  return sections.filter((s) => s.title || s.blocks.some((b) => b.lines.length));
}

function renderBlocks(blocks: Block[]) {
  return blocks
    .filter((b) => b.lines.length)
    .map((b, i) => {
      if (b.kind === "p") return <p key={i}>{b.lines.map((l, j) => <span key={j}>{inline(l)}{j < b.lines.length - 1 && <br />}</span>)}</p>;
      const items = b.lines.map((l, j) => <li key={j}>{inline(l)}</li>);
      return b.kind === "ul" ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
    });
}

export default function Markdown({ text, sectionClass }: { text: string; sectionClass?: string }) {
  return (
    <div className="md">
      {parse(text).map((s, i) => (
        <div key={i} className={s.title ? sectionClass : undefined}>
          {s.title && <h4>{s.title}</h4>}
          {renderBlocks(s.blocks)}
        </div>
      ))}
    </div>
  );
}
