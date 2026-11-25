import { expect, it, vi } from "vitest";
import type { HcClient, HcTerminal, TerminalList } from "../hc/HcClient.ts";
import { Company } from "./Company.ts";

it("reconciles a missed subscription and expires a vacant space", async () => {
  vi.useFakeTimers();
  const terminal: HcTerminal = {
    address: "t1",
    cwd: "/workspace/fallback",
    state: "live",
    status: { state: "working", app: "codex" },
    labels: { "herdr.space": "space", where: "Example / Dev" },
  };
  let terminals: HcTerminal[] = [terminal];
  const watchers: Parameters<HcClient["watch"]>[1][] = [];
  const company = new Company(
    {
      watch(_params, handlers) {
        watchers.push(handlers);
      },
      async request<T>(method: string): Promise<T> {
        if (method === "terminal.list")
          return { terminals, machines: [] } satisfies TerminalList as T;
        if (method === "doc.get") {
          return {
            value: {
              spaces: [
                { id: "space", name: "", folder: "/workspace/document" },
              ],
            },
          } as T;
        }
        return { text: "" } as T;
      },
      close() {},
    },
    () => ({ groups: [], overrides: [], defaultWhenUnknown: true }),
    1_000,
  );

  try {
    company.start();
    watchers[0].snapshot({ seq: 1, terminals });
    await vi.advanceTimersByTimeAsync(75);
    const departments = () =>
      company.snapshot().organization.buildings[0].departments;
    expect(departments()[0]).toMatchObject({
      folder: "/workspace/fallback",
      name: "Example",
      leadAddress: "t1",
      vacantSince: null,
    });
    expect(company.snapshot().connected).toBe(true);
    terminals = [{ ...terminal, status: null, agent: "zsh" }];
    watchers[0].missed();
    await vi.advanceTimersByTimeAsync(75);
    expect(departments()[0]).toMatchObject({
      employees: [],
      leadAddress: null,
      vacantSince: expect.any(Number),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(departments()).toEqual([]);
  } finally {
    company.stop();
    vi.useRealTimers();
  }
});

it("publishes redacted new messages and uses directed messages as hierarchy evidence", async () => {
  vi.useFakeTimers();
  const sender: HcTerminal = {
    address: "t1",
    cwd: "/workspace/app",
    state: "live",
    turn: 0,
    status: { state: "working", app: "codex" },
    labels: { "herdr.space": "parent" },
  };
  let recipient: HcTerminal = {
    ...sender,
    address: "t2",
    cwd: "/workspace/app/feature",
    labels: { "herdr.space": "child" },
  };
  let screen = '› <hc from="t1">old message';
  const watchers: Parameters<HcClient["watch"]>[1][] = [];
  const company = new Company(
    {
      watch(_params, handlers) {
        watchers.push(handlers);
      },
      async request<T>(method: string, params?: object): Promise<T> {
        if (method === "terminal.list")
          return {
            terminals: [sender, recipient],
            machines: [],
          } satisfies TerminalList as T;
        if (method === "terminal.read")
          return {
            text:
              params && "terminal" in params && params.terminal === "t2"
                ? screen
                : "",
          } as T;
        return { value: null } as T;
      },
      close() {},
    },
    () => ({ groups: [], overrides: [], defaultWhenUnknown: false }),
  );
  const delta = vi.fn();
  company.on("delta", delta);

  try {
    company.start();
    watchers[0].snapshot({ seq: 1, terminals: [sender, recipient] });
    await vi.advanceTimersByTimeAsync(75);
    const departments = () =>
      company.snapshot().organization.buildings[0].departments;
    expect(departments().map(({ id }) => id)).toEqual(["parent", "child"]);
    recipient = { ...recipient, turn: 1 };
    screen +=
      '\n\n› <hc from="t1">TOKEN=example Please review this synthetic project…';
    watchers[0].event({
      seq: 2,
      terminal: "t2",
      type: "turn",
      data: { turn: 1 },
    });
    await vi.advanceTimersByTimeAsync(75);
    expect(departments().map(({ id }) => id)).toEqual(["parent"]);
    expect(departments()[0].departments[0].id).toBe("child");
    expect(delta).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [
          {
            from: "t1",
            to: "t2",
            body: "TOKEN=[REDACTED] Please review this synthetic project…",
            truncated: true,
            at: expect.any(Number),
          },
        ],
      }),
    );
    const captured = screen;
    for (const [turn, body] of [
      [2, ""],
      [3, captured],
      [4, captured.replace("…", " with updated details")],
    ] as const) {
      recipient = { ...recipient, turn };
      screen = body;
      watchers[0].event({
        seq: turn + 1,
        terminal: "t2",
        type: "turn",
        data: { turn },
      });
      await vi.advanceTimersByTimeAsync(75);
    }
    expect(delta.mock.calls.filter(([event]) => event.messages)).toHaveLength(
      1,
    );
  } finally {
    company.stop();
    vi.useRealTimers();
  }
});
