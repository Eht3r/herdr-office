import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { hostname } from "node:os";
import {
  buildOrg,
  DEFAULT_VACANCY_MS,
  evidenceKey,
  type Group,
  type HierarchyOverride,
  type ManagementEvidence,
  type OfficeDelta,
  type OfficeMessage,
  type OfficeSnapshot,
  type Placement,
  parseHcMessages,
  redact,
  retainVacantTeams,
  type Team,
} from "@herdr-office/core";
import type {
  HcClient,
  HcFact,
  HcTerminal,
  TerminalList,
} from "../hc/HcClient.ts";
import {
  LAYOUT_DOCUMENT,
  type LayoutSpace,
  LOCAL_MACHINE,
  liveTeams,
  readLayout,
  terminalAgent,
} from "./normalize.ts";

import { hostnameLabel, publicMachineId } from "./publicView.ts";

export interface OrganizationSettings {
  groups: Group[];
  overrides: HierarchyOverride[];
  defaultWhenUnknown: boolean;
  /** Saved placements by public building id. */
  placements?: Record<string, Partial<Placement>>;
}

export class Company extends EventEmitter<{
  delta: [OfficeDelta];
  screen: [string, string];
}> {
  private value: OfficeSnapshot = {
    revision: 0,
    connected: false,
    organization: { buildings: [] },
  };
  private teams: Team[] = [];
  private readonly evidence = new Map<string, ManagementEvidence>();
  private layouts = new Map<string, LayoutSpace[]>();
  private readonly seenMessages = new Map<string, Set<string>>();
  private readonly reads = new Map<string, Promise<void>>();
  private readonly terminals = new Map<string, HcTerminal>();
  private remoteMachines: TerminalList["machines"] = [];
  private vacancyTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private refreshPending = false;
  private refreshRunning = false;
  private refreshLayouts = false;
  private streamEpoch = 0;
  private stopped = false;

  constructor(
    private readonly hc: Pick<HcClient, "watch" | "request" | "close">,
    private readonly settings: () => OrganizationSettings,
    private readonly vacancyMs = DEFAULT_VACANCY_MS,
  ) {
    super();
  }

  start(): void {
    this.hc.watch(
      {},
      {
        snapshot: () => this.scheduleRefresh(true),
        event: (fact) => this.applyFact(fact),
        missed: () => this.scheduleRefresh(true),
        heartbeat: () => {
          this.scheduleRefresh(false);
          for (const terminal of this.terminals.values()) {
            if (!this.reads.has(terminal.address))
              this.readScreen(terminal, false, true);
          }
        },
        disconnected: () => {
          this.streamEpoch++;
          this.publish(false);
        },
      },
    );
    this.hc.watch(
      { docs: ["*"] },
      {
        snapshot: () => this.scheduleRefresh(true),
        event: () => this.scheduleRefresh(true),
        missed: () => this.scheduleRefresh(true),
        disconnected: () => {},
      },
    );
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.vacancyTimer);
    clearTimeout(this.refreshTimer);
    this.hc.close();
  }

  snapshot(): OfficeSnapshot {
    return this.value;
  }

  settingsChanged(): void {
    this.publish(this.value.connected);
  }

  private applyFact(fact: HcFact): void {
    // Titles are frequent. Structural transitions are reconciled against terminal.list.
    const terminal = fact.terminal && this.terminals.get(fact.terminal);
    if (
      terminal &&
      fact.type === "title" &&
      fact.data &&
      typeof fact.data === "object" &&
      "title" in fact.data &&
      typeof fact.data.title === "string" &&
      !this.refreshRunning
    ) {
      if (terminal.title !== fact.data.title) {
        this.terminals.set(terminal.address, {
          ...terminal,
          title: fact.data.title,
        });
        this.publish(this.value.connected);
      }
      return;
    }
    if (fact.type !== "size") this.scheduleRefresh(fact.type === "doc");
  }

  private scheduleRefresh(layouts: boolean, delay = 75): void {
    if (this.stopped) return;
    this.refreshPending = true;
    this.refreshLayouts ||= layouts;
    if (this.refreshTimer || this.refreshRunning) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, delay);
  }

  private async refresh(): Promise<void> {
    const epoch = this.streamEpoch;
    const withLayouts = this.refreshLayouts;
    this.refreshPending = false;
    this.refreshLayouts = false;
    this.refreshRunning = true;
    try {
      const result = await this.hc.request<TerminalList>("terminal.list");
      const machines = result.machines.filter((machine) => !machine.temporary);
      const machineSetChanged =
        machines.map(({ name }) => name).join("\n") !==
        this.remoteMachines.map(({ name }) => name).join("\n");
      if (withLayouts || machineSetChanged) {
        const next = await this.loadLayouts(machines);
        if (this.stopped || epoch !== this.streamEpoch) return;
        this.layouts = next;
      }
      if (this.stopped || epoch !== this.streamEpoch) return;
      const previous = new Map(this.terminals);
      this.terminals.clear();
      this.remoteMachines = machines;
      const names = new Set(machines.map(({ name }) => name));
      for (const terminal of result.terminals) {
        const machine = terminal.address.slice(
          0,
          terminal.address.lastIndexOf("/"),
        );
        if (
          terminal.state === "live" &&
          (!terminal.address.includes("/") || names.has(machine))
        ) {
          this.terminals.set(terminal.address, terminal);
        }
      }
      for (const [address, old] of previous) {
        const current = this.terminals.get(address);
        if (!current?.labels["herdr.space"] || !terminalAgent(current)) {
          this.seenMessages.delete(address);
        } else if (!old.labels["herdr.space"] || !terminalAgent(old)) {
          this.readScreen(current, false);
        } else if (current.turn !== old.turn) {
          this.readScreen(current, true);
        }
      }
      for (const [address, terminal] of this.terminals) {
        if (!previous.has(address)) this.readScreen(terminal, false);
      }
      this.publish(true);
    } catch {
      if (!this.stopped && epoch === this.streamEpoch) {
        this.publish(false);
        this.refreshPending = true;
        this.refreshLayouts ||= withLayouts;
      }
    } finally {
      this.refreshRunning = false;
      if (this.refreshPending)
        this.scheduleRefresh(false, this.value.connected ? 75 : 1000);
    }
  }

  private async loadLayouts(
    machines: TerminalList["machines"],
  ): Promise<Map<string, LayoutSpace[]>> {
    const targets = [LOCAL_MACHINE, ...machines.map(({ name }) => name)];
    const layouts = await Promise.all(
      targets.map(async (name): Promise<[string, LayoutSpace[]]> => {
        try {
          const result = await this.hc.request<{ value: unknown }>("doc.get", {
            name: LAYOUT_DOCUMENT,
            ...(name === LOCAL_MACHINE ? {} : { on: name }),
          });
          return [name, readLayout(result.value)];
        } catch {
          return [name, []];
        }
      }),
    );
    return new Map(layouts);
  }

  private publish(connected: boolean, messages: OfficeMessage[] = []): void {
    const live = liveTeams([...this.terminals.values()], this.layouts);
    this.teams = retainVacantTeams(
      live,
      this.teams,
      Date.now(),
      this.vacancyMs,
    );
    clearTimeout(this.vacancyTimer);
    const expiry = Math.min(
      ...this.teams.flatMap(({ vacantSince }) =>
        vacantSince === null ? [] : [vacantSince + this.vacancyMs],
      ),
    );
    if (Number.isFinite(expiry)) {
      this.vacancyTimer = setTimeout(
        () => this.publish(this.value.connected),
        Math.max(0, expiry - Date.now()),
      );
    }

    const {
      defaultWhenUnknown,
      placements = {},
      ...settings
    } = this.settings();
    const local = {
      id: LOCAL_MACHINE,
      name: "본사",
      host: hostnameLabel(hostname()),
      ...placements[LOCAL_MACHINE],
    };
    const machines = [
      local,
      ...this.remoteMachines.map(({ name, host }, index) => {
        const safeHost = hostnameLabel(host) ?? hostnameLabel(name);
        return {
          id: name,
          host: safeHost,
          name: safeHost ? `${safeHost} 사옥` : `사옥 ${index + 1}`,
          ...placements[publicMachineId(name)],
        };
      }),
    ];
    // Retain empty remote buildings until their departing teams expire.
    for (const team of this.teams) {
      if (!machines.some(({ id }) => id === team.machineId)) {
        const previous = this.value.organization.buildings.find(
          ({ id }) => id === team.machineId,
        );
        machines.push({
          id: team.machineId,
          name: previous?.name ?? "사옥",
          host: previous?.host,
        });
      }
    }
    const organization = buildOrg({
      machines,
      teams: this.teams,
      ...settings,
      messages: [...this.evidence.values()],
      hierarchy: { defaultWhenUnknown },
    });
    const previous = new Map(
      this.value.organization.buildings.map((building) => [
        building.id,
        JSON.stringify(building),
      ]),
    );
    const upsert = organization.buildings.filter(
      (building) => JSON.stringify(building) !== previous.get(building.id),
    );
    const remove = [...previous.keys()].filter(
      (id) => !machines.some((machine) => machine.id === id),
    );
    const connectionChanged = connected !== this.value.connected;
    if (
      !connectionChanged &&
      !upsert.length &&
      !remove.length &&
      !messages.length
    )
      return;
    const revision = this.value.revision + 1;
    this.value = { revision, connected, organization };
    this.emit("delta", {
      revision,
      ...(connectionChanged ? { connected } : {}),
      ...(upsert.length || remove.length
        ? { buildings: { upsert, remove } }
        : {}),
      ...(messages.length ? { messages } : {}),
    });
  }

  private readScreen(
    terminal: HcTerminal,
    emit: boolean,
    usageOnly = false,
  ): void {
    const { address } = terminal;
    if (!terminal.labels["herdr.space"] || !terminalAgent(terminal)) return;
    const previousRead = this.reads.get(address) ?? Promise.resolve();
    const read = previousRead
      .then(async () => {
        if (this.stopped || !this.terminals.has(address)) return;
        const { text } = await this.hc.request<{ text: string }>(
          "terminal.read",
          { terminal: address, lines: usageOnly ? 0 : 120 },
        );
        if (this.stopped || !this.terminals.has(address)) return;
        this.emit("screen", address, text);
        if (usageOnly) return;
        const receiverScope = address.slice(0, address.lastIndexOf("/"));
        const tags = parseHcMessages(text, address, Date.now()).map((tag) => {
          const localSender = `${receiverScope}/${tag.from}`;
          return receiverScope &&
            !tag.from.includes("/") &&
            this.terminals.has(localSender)
            ? { ...tag, from: localSender }
            : tag;
        });
        const seen = this.seenMessages.get(address) ?? new Set<string>();
        this.seenMessages.set(address, seen);
        const added = unseenMessages(seen, tags);
        if (!emit) return;
        for (const message of added) {
          const sender = this.terminals.get(message.from);
          const parentSpaceId = sender?.labels["herdr.space"];
          const childSpaceId =
            this.terminals.get(address)?.labels["herdr.space"];
          if (parentSpaceId && childSpaceId && parentSpaceId !== childSpaceId) {
            this.evidence.set(evidenceKey(parentSpaceId, childSpaceId), {
              parentSpaceId,
              childSpaceId,
            });
          }
        }
        if (added.length)
          this.publish(
            this.value.connected,
            added.map((message) => ({
              ...message,
              body: redact(message.body),
            })),
          );
      })
      .catch(() => {});
    this.reads.set(address, read);
    void read.then(() => {
      if (this.reads.get(address) === read) this.reads.delete(address);
    });
  }
}

function unseenMessages(
  seen: Set<string>,
  messages: OfficeMessage[],
): OfficeMessage[] {
  const added: OfficeMessage[] = [];
  for (const message of messages) {
    const normalized = message.body
      .replace(/(?:…|\.{3})$/u, "")
      .replace(/\s+/gu, "");
    const prefix = [...normalized].slice(0, 32).join("");
    const key = createHash("sha256")
      .update(JSON.stringify([message.from, prefix]))
      .digest("hex");
    if (!seen.delete(key)) added.push(message);
    seen.add(key);
  }
  for (const key of seen) {
    if (seen.size <= 512) break;
    seen.delete(key);
  }
  return added;
}
