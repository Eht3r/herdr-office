import type { OfficeEvent, OfficeSnapshot } from "@herdr-office/core";
import { expect, it, vi } from "vitest";
import { applyOfficeEvent, subscribeOffice, useOffice } from "./officeStore.ts";

const local = { id: "local", name: "Local", departments: [], groups: [] };
const remote = { ...local, id: "remote", name: "Remote" };
const initial: OfficeSnapshot = {
  revision: 5,
  connected: true,
  organization: { buildings: [local] },
};

it("applies building upserts and removals and distinguishes stale revisions from gaps", () => {
  const delta: OfficeEvent = {
    type: "delta",
    delta: {
      revision: 6,
      connected: false,
      buildings: { upsert: [remote], remove: ["local"] },
    },
  };
  expect(applyOfficeEvent(initial, delta)).toEqual({
    revision: 6,
    connected: false,
    organization: { buildings: [remote] },
  });
  expect(
    applyOfficeEvent(initial, { type: "delta", delta: { revision: 4 } }),
  ).toBe(initial);
  expect(
    applyOfficeEvent(initial, { type: "delta", delta: { revision: 9 } }),
  ).toBeNull();
  expect(applyOfficeEvent(null, delta)).toBeNull();
});

it("reconnects to recover a missing revision and waits for a new snapshot", async () => {
  class Socket {
    static connections: Socket[] = [];
    onmessage?: (message: { data: string }) => void;
    onclose?: () => void;
    constructor(readonly url: URL) {
      Socket.connections.push(this);
    }
    sendEvent(message: OfficeEvent) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
    close() {
      this.onclose?.();
    }
  }
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", {
    location: { href: "https://office.example.test/" },
    setTimeout,
    clearTimeout,
  });
  const stop = subscribeOffice();
  try {
    const [first] = Socket.connections;
    expect(first.url.href).toBe("wss://office.example.test/ws");
    first.sendEvent({ type: "snapshot", snapshot: initial });
    expect(useOffice.getState().connection).toBe("open");
    first.sendEvent({ type: "delta", delta: { revision: 7 } });
    expect(useOffice.getState().connection).toBe("retrying");
    await vi.advanceTimersByTimeAsync(300);
    const [, second] = Socket.connections;
    second.sendEvent({
      type: "snapshot",
      snapshot: { ...initial, revision: 1 },
    });
    expect(useOffice.getState()).toMatchObject({
      connection: "open",
      snapshot: { revision: 1 },
    });
    second.sendEvent({
      type: "delta",
      delta: {
        revision: 2,
        buildings: {
          remove: [],
          upsert: [
            {
              ...local,
              departments: [
                {
                  id: "new-team",
                  machineId: "local",
                  name: "New team",
                  folder: null,
                  employees: [],
                  leadAddress: null,
                  vacantSince: null,
                  departments: [],
                },
              ],
            },
          ],
        },
      },
    });
    expect(useOffice.getState().appeared.has("department:new-team")).toBe(true);
  } finally {
    stop();
    useOffice.setState(useOffice.getInitialState());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
