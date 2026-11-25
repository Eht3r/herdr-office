import { expect, it } from "vitest";
import { parseHcMessages } from "./hcParse.ts";

it("reads Claude's unclosed prompt and its indented continuation up to the next block", () => {
  const screen = [
    '❯ <hc from="remote/t7">Please review the summary.',
    "  Compare the results with the previous run.",
    "    Retain meaningful nested indentation.",
    "  ⏺ I will check the results.",
    "  This is assistant output.",
    '❯ <hc from="t8">Second message',
    "",
    "  Unrelated text.",
  ].join("\n");
  expect(parseHcMessages(screen, "t1", 123)).toEqual([
    {
      from: "remote/t7",
      to: "t1",
      body: "Please review the summary.\nCompare the results with the previous run.\n  Retain meaningful nested indentation.",
      at: 123,
    },
    { from: "t8", to: "t1", body: "Second message", at: 123 },
  ]);
});

it("recognizes a clipped Codex preview and excludes the following assistant block", () => {
  const screen = [
    '› <hc from="t7">Please review the summary…',
    "  rendered preview metadata",
    "• I can review it.",
    '› <hc from="t8">Continue with the check.',
    "  Also verify the total.",
    "• Running it now.",
  ].join("\r\n");
  expect(parseHcMessages(screen, "t2", 456)).toEqual([
    {
      from: "t7",
      to: "t2",
      at: 456,
      body: "Please review the summary…",
      truncated: true,
    },
    {
      from: "t8",
      to: "t2",
      at: 456,
      body: "Continue with the check.\nAlso verify the total.",
    },
  ]);
});

it("ignores tags quoted in ordinary terminal output and empty prompts", () => {
  const screen = [
    '• Example: <hc from="t1">Not a message',
    '  <hc from="t1">Also not a message',
    '› <hc from="t1">',
  ].join("\n");
  expect(parseHcMessages(screen, "t2", 123)).toEqual([]);
});
