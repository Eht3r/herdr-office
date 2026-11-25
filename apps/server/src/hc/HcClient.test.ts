import { expect, it, vi } from "vitest";
import { HcClient } from "./HcClient.ts";

const fixture = `
  const input = require("node:readline").createInterface({ input: process.stdin });
  const send = (line) => console.log(JSON.stringify({ jsonrpc: "2.0", ...line }));
  input.once("line", (line) => {
    const { id, method } = JSON.parse(line);
    if (method === "terminal.list") {
      send({ id, result: { terminals: [], machines: [] } });
      return;
    }
    const terminal = "t1";
    const event = (seq) => send({ method: "event", params: { seq, terminal, type: "turn" } });
    send({ id, result: { seq: 1, terminals: [] } });
    event(2);
    send({ method: "missed", params: {} });
    event(3);
    send({ method: "snapshot", params: { seq: 4, terminals: [] } });
    event(4);
    event(5);
    input.close();
    process.stdin.unref();
  });
`;

it("reconnects a subscription and filters stale events across a missed snapshot", async () => {
  const hc = new HcClient(process.execPath, ["-e", fixture]);
  const seen: string[] = [];
  const disconnected = vi.fn();
  try {
    expect(await hc.request("terminal.list")).toEqual({
      terminals: [],
      machines: [],
    });
    hc.watch(
      {},
      {
        snapshot: ({ seq }) => seen.push(`snapshot:${seq}`),
        event: ({ seq }) => seen.push(`event:${seq}`),
        missed: () => seen.push("missed"),
        disconnected,
      },
    );
    // Two child processes start with a reconnect delay; allow for a busy test run.
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledTimes(2), {
      timeout: 10_000,
    });
    const sequence = [
      "snapshot:1",
      "event:2",
      "missed",
      "snapshot:4",
      "event:5",
    ];
    expect(seen).toEqual([...sequence, ...sequence]);
  } finally {
    hc.close();
  }
});
