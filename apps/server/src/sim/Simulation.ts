import { EventEmitter } from "node:events";
import type {
  OfficeMessage,
  OfficeSnapshot,
  Timeline,
} from "@herdr-office/core";
import type { CompanyCalendar } from "../calendar.ts";
import type { UsageMonitor } from "../usage.ts";
import { type Planner, staff } from "./Planner.ts";
import type { SimulationStore } from "./SimulationStore.ts";

export interface Clock {
  now(): number;
}

export class Simulation extends EventEmitter<{ timeline: [Timeline] }> {
  private timer?: ReturnType<typeof setInterval>;
  private pending: OfficeMessage[] = [];
  private current: Timeline;
  private busy = false;
  private stopped = false;
  private snapshot: OfficeSnapshot = {
    revision: 0,
    connected: false,
    organization: { buildings: [] },
  };

  constructor(
    private readonly planner: Planner,
    private readonly calendar: CompanyCalendar,
    private readonly usage: UsageMonitor,
    private readonly store: SimulationStore,
    private readonly clock: Clock = { now: Date.now },
    private readonly onError: (error: unknown) => void = console.error,
  ) {
    super();
    const at = clock.now();
    const states = store.states();
    this.current = {
      at,
      today: null,
      usage: {},
      positions: Object.fromEntries(
        states
          .filter(({ present }) => present)
          .map(({ id, position }) => [id, position]),
      ),
      notesByEmployee: Object.fromEntries(
        states
          .filter(({ present, notes }) => present && notes > 0)
          .map(({ id, notes }) => [id, notes]),
      ),
      actions: states
        .flatMap(({ actions }) => actions)
        .filter((action) => action.startAt + action.durationMs > at),
    };
  }

  observe(snapshot: OfficeSnapshot, messages?: OfficeMessage[]): void {
    this.snapshot = snapshot;
    if (messages?.length)
      this.pending = [...this.pending, ...messages].slice(-250);
  }

  observeScreen(address: string, text: string): void {
    const { employee } =
      staff(this.snapshot).find(
        (member) => member.employee.address === address,
      ) ?? {};
    if (employee) this.usage.observeScreen(employee, text, this.clock.now());
  }

  timeline(): Timeline {
    const at = this.clock.now();
    return {
      ...this.current,
      at,
      actions: this.current.actions.filter(
        (action) => action.startAt + action.durationMs > at,
      ),
    };
  }

  start(): void {
    this.usage.start();
    this.timer = setInterval(() => void this.tick(), 1_000);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.usage.stop();
    this.store.close();
  }

  async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const at = this.clock.now();
      const day = await this.calendar.today(at);
      if (this.stopped) return;
      const count = this.pending.length;
      const next = this.planner.plan({
        snapshot: this.snapshot,
        day,
        at,
        messages: this.pending.slice(0, count),
        usage: (employee) => this.usage.usageFor(employee, at),
      });
      if (this.snapshot.connected) this.pending.splice(0, count);
      const comparable = ({
        actions,
        today,
        usage,
        positions,
        notesByEmployee,
      }: Timeline) =>
        JSON.stringify({
          actions,
          usage,
          positions,
          notesByEmployee,
          day: today?.date,
          holiday: today?.holidayNames,
          workingHours: today?.workingHours,
          warning: today?.warning,
          zone: today?.timeZone,
        });
      const changed = comparable(next) !== comparable(this.current);
      this.current = next;
      if (changed) this.emit("timeline", this.timeline());
    } catch (error) {
      this.onError(error);
    } finally {
      this.busy = false;
    }
  }
}
