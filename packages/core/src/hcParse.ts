import type { OfficeMessage } from "./types.ts";

const header =
  /^[ \t]*([❯›])[ \t]+<hc from=(?:"([\w./-]+)"|'([\w./-]+)'|([\w./-]+))[ \t]*>(.*)$/u;
const blockStart = /^[ \t]*[❯›•⏺](?:\s|$)/u;
const ellipsis = /(?:…|\.{3})$/u;

export function parseHcMessages(
  screen: string,
  to: string,
  at: number,
): OfficeMessage[] {
  const messages: OfficeMessage[] = [];
  const lines = screen.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const match = header.exec(lines[index]);
    if (!match) continue;
    const [, prompt, double, single, bare, first] = match;
    const bodyLines = [first.trimEnd()];
    const clippedPreview = prompt === "›" && ellipsis.test(bodyLines[0]);
    while (!clippedPreview && index + 1 < lines.length) {
      const line = lines[index + 1];
      if (!line.trim() || blockStart.test(line) || !line.startsWith("  "))
        break;
      bodyLines.push(line.slice(2).trimEnd());
      index++;
    }

    const body = bodyLines.join("\n").trim();
    if (!body) continue;
    messages.push({
      from: double ?? single ?? bare,
      to,
      body,
      at,
      ...(ellipsis.test(body) ? { truncated: true } : {}),
    });
  }

  return messages;
}
