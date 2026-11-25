import type {
  Department,
  OfficeEvent,
  OfficeSnapshot,
  Timeline,
  TownFrame,
} from "@herdr-office/core";
import { create } from "zustand";
import { departmentKey, groupKey } from "../layout/campusLayout.ts";

type Connection = "connecting" | "open" | "retrying";

interface OfficeState {
  snapshot: OfficeSnapshot | null;
  connection: Connection;
  appeared: ReadonlyMap<string, number>;
  timeline: Timeline | null;
  timelineReceivedAt: number;
  townFrame: TownFrame | null;
  townReceivedAt: number;
}

export const useOffice = create<OfficeState>(() => ({
  snapshot: null,
  connection: "connecting",
  appeared: new Map(),
  timeline: null,
  timelineReceivedAt: 0,
  townFrame: null,
  townReceivedAt: 0,
}));

export function applyOfficeEvent(
  previous: OfficeSnapshot | null,
  event: OfficeEvent,
): OfficeSnapshot | null {
  if (event.type === "snapshot") return event.snapshot;
  if (event.type === "actions" || event.type === "town") return previous;
  const { delta } = event;
  if (!previous) return null;
  if (delta.revision <= previous.revision) return previous;
  if (delta.revision !== previous.revision + 1) return null;

  let { organization } = previous;
  if (delta.buildings) {
    const buildings = new Map(
      organization.buildings.map((building) => [building.id, building]),
    );
    for (const id of delta.buildings.remove) buildings.delete(id);
    for (const building of delta.buildings.upsert)
      buildings.set(building.id, building);
    organization = { buildings: [...buildings.values()] };
  }
  return {
    ...previous,
    revision: delta.revision,
    connected: delta.connected ?? previous.connected,
    organization,
  };
}

function officeKeys(snapshot: OfficeSnapshot): Set<string> {
  const keys = new Set<string>();
  const addDepartments = (departments: Department[]) => {
    for (const department of departments) {
      keys.add(departmentKey(department.id));
      addDepartments(department.departments);
    }
  };
  for (const building of snapshot.organization.buildings) {
    addDepartments(building.departments);
    for (const group of building.groups) {
      keys.add(groupKey(building.id, group.id));
      addDepartments(group.departments);
    }
  }
  return keys;
}

function receive(event: OfficeEvent): boolean {
  const { snapshot: previous, appeared: old } = useOffice.getState();
  const snapshot = applyOfficeEvent(previous, event);
  if (!snapshot) return false;
  if (snapshot === previous) return true;
  let appeared = old;
  if (previous && previous.organization !== snapshot.organization) {
    const before = officeKeys(previous);
    const next = new Map<string, number>();
    const now = Date.now();
    for (const key of officeKeys(snapshot)) {
      const started = before.has(key) ? old.get(key) : now;
      if (started !== undefined && now - started < 1500) next.set(key, started);
    }
    appeared = next;
  }
  useOffice.setState({ snapshot, appeared });
  return true;
}

export function subscribeOffice(): () => void {
  let active = true;
  let failures = 0;
  let socket: WebSocket | undefined;
  let retry: number | undefined;
  let handshake: number | undefined;
  const endpoint = new URL("/ws", window.location.href);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";

  const connect = () => {
    if (!active) return;
    const current = new WebSocket(endpoint);
    socket = current;
    let ready = false;
    handshake = window.setTimeout(() => current.close(), 8000);
    current.onmessage = ({ data }) => {
      if (!active || socket !== current) return;
      try {
        const event = JSON.parse(data) as OfficeEvent;
        if (event.type === "town" && ready) {
          const before = useOffice.getState().townFrame;
          const frame = event.frame;
          useOffice.setState({
            townFrame:
              before?.layoutKey === frame.layoutKey
                ? { ...frame, neighborhood: before.neighborhood }
                : frame,
            townReceivedAt: Date.now(),
          });
          return;
        }
        if (event.type === "actions" && ready) {
          useOffice.setState({
            timeline: event.timeline,
            timelineReceivedAt: Date.now(),
          });
          return;
        }
        if (
          (event.type !== "snapshot" && event.type !== "delta") ||
          (!ready && event.type !== "snapshot") ||
          !receive(event)
        ) {
          current.close();
          return;
        }
        if (!ready) {
          ready = true;
          failures = 0;
          window.clearTimeout(handshake);
          useOffice.setState({ connection: "open" });
        }
      } catch {
        current.close();
      }
    };
    current.onerror = () => current.close();
    current.onclose = () => {
      if (!active || socket !== current) return;
      window.clearTimeout(handshake);
      useOffice.setState({ connection: "retrying" });
      const delay = Math.min(8000, 300 * 2 ** failures++);
      retry = window.setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    active = false;
    window.clearTimeout(retry);
    window.clearTimeout(handshake);
    socket?.close();
  };
}
