import {
  type CompanyEvent,
  classifyIntent,
  type Department,
  type Employee,
  type EmployeeUsage,
  hashSeed,
  highestImportance,
  type Importance,
  type OfficeMessage,
  type OfficeSnapshot,
  type SpeechExposure,
  statusLine,
  type Timeline,
  toSpeech,
  type Waypoint,
} from "@herdr-office/core";
import type { WorkDay } from "../calendar.ts";
import { publicAddress, withoutIp } from "../state/publicView.ts";
import {
  type AbsenceThresholds,
  classifyAbsence,
  defaultAbsenceThresholds,
} from "./absence.ts";
import {
  createEmployeeState,
  createPersona,
  desk,
  type EmployeeState,
  home,
} from "./employeeState.ts";
import { atHome, commute, completeActions, queueAction } from "./movement.ts";
import { type BreakPlan, planBreak } from "./RestPlanner.ts";
import { plannedRemote, type RemoteWorkPolicy } from "./remoteWork.ts";
import type { SimulationStore } from "./SimulationStore.ts";
import { applyTaskSignal, taskImportance } from "./taskSignals.ts";
import type { WorkHours } from "./WorkHours.ts";

const minute = 60_000;
const noUsage: EmployeeUsage = {
  usedPct: null,
  resetAt: null,
  exhausted: false,
};

interface StaffMember {
  employee: Employee;
  lead: boolean;
  departmentName: string;
}

export function staff(snapshot: OfficeSnapshot): StaffMember[] {
  const members: StaffMember[] = [];
  const add = (departments: Department[]) => {
    for (const department of departments) {
      for (const employee of department.employees) {
        if (employee.agent)
          members.push({
            employee,
            lead: employee.address === department.leadAddress,
            departmentName: department.name,
          });
      }
      add(department.departments);
    }
  };
  for (const building of snapshot.organization.buildings) {
    add(building.departments);
    for (const group of building.groups) add(group.departments);
  }
  return members;
}

export interface PlanningFrame {
  snapshot: OfficeSnapshot;
  day: WorkDay;
  at: number;
  messages?: OfficeMessage[];
  usage?: (employee: Employee, at: number) => EmployeeUsage;
  weather?: "rain" | "snow";
}

export class Planner {
  private initialized = false;
  private thresholds: AbsenceThresholds;
  private readonly exposure: SpeechExposure;
  private remoteWork: RemoteWorkPolicy;

  private readonly collectSpeech: boolean;
  private readonly mask: (text: string) => string;

  constructor(
    private readonly store: SimulationStore,
    private readonly hours: WorkHours,
    options: {
      exposure?: SpeechExposure;
      collectSpeech?: boolean;
      mask?: (text: string) => string;
      thresholds?: AbsenceThresholds;
      remoteWork?: RemoteWorkPolicy;
    } = {},
  ) {
    this.thresholds = options.thresholds ?? defaultAbsenceThresholds;
    const { napMs, sleepMs, leaveMs } = this.thresholds;
    if (
      !(
        0 < napMs &&
        napMs < sleepMs &&
        sleepMs < leaveMs &&
        Number.isFinite(leaveMs)
      )
    ) {
      throw new RangeError("Absence thresholds must increase");
    }
    this.exposure = options.exposure ?? "status";
    this.remoteWork = options.remoteWork ?? "afterHours";
    this.collectSpeech = options.collectSpeech ?? false;
    this.mask = options.mask ?? ((text) => text);
  }

  configure(remoteWork: RemoteWorkPolicy, thresholds: AbsenceThresholds): void {
    this.thresholds = thresholds;
    this.remoteWork = remoteWork;
  }

  plan(frame: PlanningFrame): Timeline {
    const result = this.store.transaction(() => this.planFrame(frame));
    if (frame.snapshot.connected) this.initialized = true;
    return result;
  }

  private planFrame({
    snapshot,
    day,
    at,
    messages = [],
    usage,
    weather,
  }: PlanningFrame): Timeline {
    const organization = staff(snapshot);
    const states = new Map(
      this.store.states().map((state) => [state.id, state]),
    );
    const registered = new Set(
      [...states.values()].map((state) => state.spaceId),
    );
    const freshSections = new Set<string>();
    const members = new Map(
      organization.map((member) => [
        publicAddress(member.employee.address),
        member,
      ]),
    );
    const usageByEmployee: Timeline["usage"] = {};
    const limitsByEmployee = new Map(
      [...members].map(([id, { employee }]) => [
        id,
        usage?.(employee, at) ?? noUsage,
      ]),
    );
    const unavailable = new Set(
      [...limitsByEmployee]
        .filter(([, limits]) => limits.exhausted)
        .map(([id]) => id),
    );
    for (const state of states.values()) completeActions(state, at);

    if (snapshot.connected) {
      for (const [id, { employee }] of members) {
        const previous = states.get(id);
        if (!previous) {
          const persona = this.persona(id, employee);
          const state = createEmployeeState(
            employee,
            persona,
            at,
            this.initialized,
          );
          states.set(id, state);
          if (this.initialized) {
            if (!registered.has(employee.spaceId))
              freshSections.add(employee.spaceId);
            commute(
              state,
              at,
              "firstCommute",
              true,
              "오늘부터 함께 일하게 됐어요. 잘 부탁드려요!",
            );
          }
        } else if (previous.spaceId !== employee.spaceId) {
          previous.spaceId = employee.spaceId;
          previous.persona = this.persona(id, employee);
          if (!registered.has(employee.spaceId))
            freshSections.add(employee.spaceId);
        }
        if (previous && !previous.present) {
          previous.present = true;
          previous.position = home(previous);
          previous.actions = [];
          commute(previous, at, "commuteIn", true, "다시 왔습니다!");
        }
      }
      for (const state of states.values()) {
        if (!state.present || members.has(state.id)) continue;
        state.present = false;
        state.actions = [];
        if (!atHome(state))
          commute(state, at, "finalDeparture", false, "그동안 감사했습니다!");
        else
          queueAction(
            state,
            at,
            "finalDeparture",
            home(state),
            4_000,
            "그동안 감사했습니다!",
          );
      }
      if (freshSections.size) {
        for (const [id] of members) {
          const state = states.get(id);
          if (state && !freshSections.has(state.spaceId))
            state.event = "newTeam";
        }
      }

      const changes = new Map<string, boolean>();
      for (const [id, { employee }] of members) {
        const state = states.get(id);
        if (!state) continue;
        const changed = state.status !== employee.status;
        changes.set(id, changed);
        if (!changed) continue;
        if (
          employee.status === "done" ||
          (state.status === "working" && employee.status === "idle")
        ) {
          if (
            employee.status === "done" &&
            state.status === "working" &&
            at - state.statusSince >= 30 * minute
          )
            state.event = "celebration";
          state.priority = undefined;
          state.revisionSignals = undefined;
        }
        state.status = employee.status;
        state.statusSince = at;
      }

      for (const { from, to, body, at: sentAt } of messages) {
        const first = publicAddress(from);
        const second = publicAddress(to);
        const sender = states.get(first);
        const recipient = members.get(second);
        const receiverState = states.get(second);
        if (!sender || !recipient || !receiverState || first === second)
          continue;
        const message = { from, to, body: this.mask(body), at: sentAt };
        const recipientRole = recipient.lead ? "lead" : undefined;
        const speech = toSpeech(message, {
          exposure: this.exposure,
          recipientRole,
        });
        const source = members.get(first);
        applyTaskSignal({
          sender,
          recipient: receiverState,
          states,
          senderIsLead: source?.lead ?? false,
          infrastructure: /infra|인프라|\bsre\b/iu.test(
            source?.departmentName ?? "",
          ),
          intent: this.collectSpeech ? classifyIntent(body) : speech.intent,
          body,
          at: sentAt,
        });
        this.store.interact(first, second);
        sender.conversation = [
          ...sender.conversation.slice(-19),
          {
            recipientId: second,
            line: withoutIp(speech.line),
            at: sentAt,
            ...(this.collectSpeech
              ? {
                  speech: {
                    status: withoutIp(
                      toSpeech(message, { exposure: "status", recipientRole })
                        .line,
                    ),
                    title: withoutIp(
                      toSpeech(message, { exposure: "title", recipientRole })
                        .line,
                    ),
                    messages: withoutIp(
                      `“${[...message.body.trim().replace(/\s+/gu, " ")].slice(0, 120).join("")}”라고 전했어요.`,
                    ),
                    raw: withoutIp([...message.body].slice(0, 800).join("")),
                  },
                }
              : {}),
          },
        ];
      }

      const duties = new Map<string, Importance>();
      const teamDuties = new Map<string, Importance>();
      for (const [id, { employee }] of members) {
        const state = states.get(id);
        if (!state) continue;
        const direct = taskImportance(state, employee, at);
        duties.set(id, direct);
        if (!unavailable.has(id)) {
          teamDuties.set(
            state.spaceId,
            highestImportance(
              teamDuties.get(state.spaceId) ?? "normal",
              direct,
            ),
          );
        }
      }

      for (const [id, { employee, lead }] of members) {
        const state = states.get(id);
        if (!state) continue;
        const today = this.hours.dayFor(state.spaceId, day, at);
        const limits = limitsByEmployee.get(id) ?? noUsage;
        usageByEmployee[id] =
          this.exposure === "status"
            ? { resetAt: limits.resetAt, exhausted: limits.exhausted }
            : limits;
        const importance = highestImportance(
          duties.get(id) ?? "normal",
          lead ? (teamDuties.get(state.spaceId) ?? "normal") : "normal",
        );
        if (employee.status === "working" && !limits.exhausted)
          this.hours.observe(state.spaceId, today, at);
        this.advance(
          state,
          states,
          members,
          today,
          at,
          limits,
          changes.get(id) ?? false,
          importance,
          unavailable,
          weather,
        );
      }
    }

    for (const state of states.values()) this.store.save(state);
    return {
      at,
      today: this.hours.dayFor("@company", day, at),
      usage: usageByEmployee,
      positions: Object.fromEntries(
        [...states.values()]
          .filter((state) => state.present || state.actions.length)
          .map(({ id, position }) => [id, position]),
      ),
      notesByEmployee: Object.fromEntries(
        [...states.values()]
          .filter(({ present, notes }) => present && notes > 0)
          .map(({ id, notes }) => [id, notes]),
      ),
      inboxByEmployee: Object.fromEntries(
        [...states.values()]
          .filter(({ present, notes, inbox }) => present && notes > 0 && inbox)
          .map(({ id, inbox }) => [id, (inbox ?? []).slice(-20)]),
      ),
      actions: [...states.values()]
        .flatMap(({ actions }) => actions)
        .sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id)),
    };
  }

  private persona(id: string, employee: Employee) {
    return this.store.persona(JSON.stringify([employee.spaceId, id]), () =>
      createPersona(employee),
    );
  }

  private advance(
    state: EmployeeState,
    states: Map<string, EmployeeState>,
    members: Map<string, StaffMember>,
    day: WorkDay,
    at: number,
    usage: EmployeeUsage,
    changed: boolean,
    importance: Importance,
    unavailable: ReadonlySet<string>,
    weather?: PlanningFrame["weather"],
  ): void {
    const elapsed = Math.min(10_000, Math.max(0, at - state.lastTick));
    state.lastTick = at;
    if (this.handleAbsence(state, usage, day, importance, at)) {
      state.remoteActive = false;
      this.conversation(state, states, at, unavailable, true);
      return;
    }

    if (state.overtimeDate !== day.date) {
      if (state.overtimeMs >= 30 * minute) {
        state.lateMinutes = Math.min(
          90,
          Math.floor(state.overtimeMs / (30 * minute)) * 15,
        );
        state.lateDate = day.date;
      }
      state.overtimeDate = day.date;
      state.overtimeMs = 0;
    }

    const working = state.status === "working";
    const offsite =
      atHome(state) ||
      Boolean(state.remoteActive && state.position.kind === "park");
    const remote =
      plannedRemote(this.remoteWork, state, day, importance) &&
      (working ||
        Boolean(
          state.remoteActive &&
            state.status !== "done" &&
            at - state.statusSince < 30 * minute,
        ));
    state.remoteActive = remote;
    if (working && !day.workingHours && !remote) state.overtimeMs += elapsed;
    const conversationInProgress = state.actions.some(
      ({ props }) => props.reason === "conversation",
    );
    if (
      conversationInProgress &&
      !changed &&
      (importance === "normal" || !offsite)
    )
      return;
    if (
      state.actions.some(
        ({ kind }) => kind === "return" || kind === "readNotes",
      )
    )
      return;
    const pendingTrip = state.actions.some((action) => action.props.trip);
    const goingHome = pendingTrip && state.actions.at(-1)?.to.kind === "home";
    if (pendingTrip && (!goingHome || (!working && importance === "normal")))
      return;
    if (working) {
      this.work(
        state,
        day,
        at,
        changed,
        goingHome,
        remote,
        offsite,
        importance,
      );
      this.warnUsage(state, day, at, usage, true);
      this.conversation(state, states, at, unavailable);
      return;
    }

    if (changed) {
      state.actions = [];
      const line = statusLine(state.status);
      if (line)
        queueAction(state, at, "react", state.position, 3_500, line, {
          reason: state.status ?? undefined,
        });
    }
    if (state.actions.length && (importance === "normal" || !offsite)) return;
    if (this.conversation(state, states, at, unavailable)) return;
    if (state.status === "blocked" && at - state.statusSince < 8 * minute)
      return;

    const delay = state.lateDate === day.date ? state.lateMinutes : 0;
    const arrival = Math.max(
      0,
      day.scheduledStart + state.persona.arrivalOffsetMinutes + delay,
    );
    if (remote) {
      this.rest(state, states, members, day, at, state.event, weather, true);
      return;
    }
    if (offsite) {
      if (importance !== "normal") {
        state.actions = [];
        this.commuteForTask(state, day, at, importance, !day.workingHours);
        return;
      }
      if (
        day.scheduledDay &&
        day.minute >= arrival &&
        day.minute < day.scheduledEnd
      ) {
        commute(
          state,
          at,
          "commuteIn",
          true,
          delay ? "어제 늦어서 오늘은 조금 늦게 왔어요." : "좋은 아침입니다!",
        );
      }
      return;
    }
    const earlyArrival =
      day.scheduledDay &&
      day.minute >= arrival &&
      day.minute < day.scheduledStart;
    if (!day.workingHours && !earlyArrival && state.status !== "blocked") {
      if (importance !== "normal") return;
      commute(state, at, "commuteOut", false, "오늘은 이만 들어갈게요.");
      return;
    }

    if (state.notes) {
      this.readNotes(state, at);
      return;
    }
    if (this.warnUsage(state, day, at, usage)) return;
    const event: CompanyEvent | undefined =
      state.status === "blocked" ? "blockedLong" : state.event;
    this.rest(state, states, members, day, at, event, weather);
  }

  private warnUsage(
    state: EmployeeState,
    day: WorkDay,
    at: number,
    usage: EmployeeUsage,
    working = false,
  ): boolean {
    if (
      usage.usedPct === null ||
      usage.usedPct < 90 ||
      state.warningDay === day.date ||
      (working &&
        (state.actions.length !== 1 ||
          !["work", "overtime"].includes(state.actions[0].kind)))
    )
      return false;
    state.warningDay = day.date;
    const work = working ? state.actions.pop() : undefined;
    queueAction(
      state,
      at,
      "usageWarning",
      work?.to ?? desk(state),
      6_000,
      "조금만 더 하면 쉬어야겠어요.",
      {
        items: ["batteryYellow", "coffee"],
        ...(this.exposure !== "status" ? { usedPct: usage.usedPct } : {}),
      },
    );
    if (work)
      queueAction(
        state,
        at,
        work.kind,
        work.to,
        Math.max(1, work.startAt + work.durationMs - at),
        work.line,
        work.props,
      );
    return true;
  }

  private work(
    state: EmployeeState,
    day: WorkDay,
    at: number,
    changed: boolean,
    goingHome: boolean,
    remote: boolean,
    offsite: boolean,
    importance: Importance,
  ): void {
    if (
      changed ||
      goingHome ||
      state.actions.some(({ kind }) => kind === "break" || kind === "react")
    )
      state.actions = [];
    const mode = remote
      ? "homeWork"
      : day.workingHours
        ? null
        : day.isWeekend || day.isHoliday
          ? "specialShift"
          : "officeOvertime";
    if (offsite && !remote) {
      state.actions = [];
      this.commuteForTask(state, day, at, importance, !day.workingHours);
      return;
    }
    const reason = mode ?? "work";
    if (state.actions.some((action) => action.props.reason === reason)) return;
    state.actions = [];
    const destination = mode === "homeWork" ? home(state) : desk(state);
    if (state.position.kind !== destination.kind)
      queueAction(state, at, "move", destination, 5_000, "앗, 일 들어왔다.");
    if (state.notes && destination.kind === "desk") this.readNotes(state, at);
    queueAction(
      state,
      at,
      !day.workingHours && !remote ? "overtime" : "work",
      destination,
      5 * minute,
      mode === "homeWork"
        ? "오늘은 집에서 마저 할게요."
        : mode === "officeOvertime"
          ? "조금만 더 하고 갈게요."
          : statusLine("working"),
      {
        reason,
        importance,
        ...(remote ? { remoteWork: true } : {}),
        items:
          mode === "homeWork"
            ? ["laptop"]
            : mode
              ? [
                  "deskLamp",
                  ...(state.overtimeMs >= 60 * minute ? ["lateMeal"] : []),
                ]
              : [],
      },
    );
  }

  private commuteForTask(
    state: EmployeeState,
    day: WorkDay,
    at: number,
    importance: Importance,
    outside: boolean,
  ): void {
    const special = outside && (day.isWeekend || day.isHoliday);
    if (outside) {
      const line = special
        ? day.isHoliday
          ? "공휴일 특근이라 다녀올게요."
          : "주말 특근이라 다녀올게요."
        : "아… 다시 왔습니다.";
      commute(
        state,
        at,
        "emergencyCommute",
        true,
        line,
        special ? "specialShift" : "urgent",
        hashSeed(state.id) % 2 ? "taxi" : "run",
      );
      return;
    }
    commute(
      state,
      at,
      "commuteIn",
      true,
      importance === "important"
        ? "중요한 일이 생겨서 회사로 갈게요."
        : "일이 들어왔네요. 출근할게요.",
      "arrival",
    );
  }

  private handleAbsence(
    state: EmployeeState,
    usage: EmployeeUsage,
    day: WorkDay,
    importance: Importance,
    at: number,
  ): boolean {
    const previous = state.absence;
    if (!usage.exhausted) {
      if (!previous) return false;
      state.absence = null;
      state.actions = [];
      state.event = "returned";
      if (
        atHome(state) &&
        !day.workingHours &&
        this.remoteWork === "afterHours" &&
        importance === "normal"
      )
        return false;
      if (atHome(state))
        commute(state, at, "return", true, "좋은 아침입니다. 다시 왔어요!");
      else
        queueAction(
          state,
          at,
          "return",
          desk(state),
          7_000,
          "이제 다시 시작해 볼까요?",
        );
      if (state.notes) this.readNotes(state, at);
      return true;
    }
    const resetAt = usage.resetAt;
    const since = previous?.since ?? at;
    const { napMs, sleepMs, leaveMs } = this.thresholds;
    const thresholds = `${napMs}:${sleepMs}:${leaveMs}`;
    const kind =
      resetAt === null
        ? at - since < this.thresholds.napMs
          ? "powerNap"
          : "sleep"
        : previous?.resetAt === resetAt &&
            (previous.thresholds === undefined ||
              previous.thresholds === thresholds)
          ? previous.kind
          : classifyAbsence(resetAt - at, this.thresholds);
    state.absence = { kind, since, resetAt, thresholds };
    if (
      previous?.kind === kind &&
      previous.resetAt === resetAt &&
      state.actions.length
    )
      return true;
    state.actions = [];
    const gone = kind === "earlyLeave" || kind === "vacation";
    const target: Waypoint =
      gone || atHome(state)
        ? home(state)
        : kind === "sleep"
          ? { kind: "sleepCapsules", buildingId: state.buildingId }
          : desk(state);
    const lines = {
      powerNap: "잠깐 눈 좀 붙일게요.",
      sleep: "다시 시작할 때까지 조금 잘게요.",
      earlyLeave: "먼저 들어가볼게요!",
      vacation: "자리를 비웁니다.",
    };
    const props = {
      absence: kind,
      resetAt,
      items:
        kind === "vacation"
          ? [
              "calendar",
              "plant",
              ...(resetAt && resetAt - at >= 3 * 86_400_000
                ? ["postcard"]
                : []),
            ]
          : ["batteryRed"],
    };
    if (gone && !atHome(state))
      commute(state, at, "commuteOut", false, lines[kind], kind);
    else if (state.position.kind !== target.kind)
      queueAction(state, at, "move", target, 6_000, lines[kind], props);
    const start = state.actions.at(-1);
    const duration =
      resetAt === null
        ? 5 * minute
        : Math.max(
            1,
            resetAt - (start ? start.startAt + start.durationMs : at),
          );
    queueAction(state, at, "absence", target, duration, lines[kind], props);
    return true;
  }

  private readNotes(state: EmployeeState, at: number): void {
    queueAction(
      state,
      at,
      "readNotes",
      desk(state),
      5_000,
      "어떤 쪽지가 왔나 볼까요?",
      { noteCount: state.notes, notes: state.inbox ?? [], items: ["note"] },
    );
  }

  private conversation(
    state: EmployeeState,
    states: Map<string, EmployeeState>,
    at: number,
    unavailable: ReadonlySet<string>,
    absent = false,
  ): boolean {
    if (!state.conversation.length) return false;
    if (
      !absent &&
      state.actions.some(
        ({ kind }) =>
          kind === "talk" || kind === "videocall" || kind === "leaveNote",
      )
    )
      return false;
    const message = state.conversation.shift();
    if (!message) return false;
    const recipient = states.get(message.recipientId);
    if (!recipient) return false;
    const to = desk(recipient);
    const recipientUnavailable =
      recipient.absence || unavailable.has(recipient.id) || !recipient.present;
    const availableForCall =
      !recipientUnavailable &&
      !absent &&
      (!atHome(state) || state.remoteActive) &&
      (!atHome(recipient) || recipient.remoteActive);
    if (availableForCall && (state.remoteActive || recipient.remoteActive)) {
      if (
        recipient.actions.some(
          ({ props }) => props.trip || props.reason === "conversation",
        )
      ) {
        state.conversation.unshift(message);
        return false;
      }
      for (const [participant, companion] of [
        [state, recipient],
        [recipient, state],
      ]) {
        participant.actions = [];
        queueAction(
          participant,
          at,
          "videocall",
          participant.position,
          8_000,
          participant === state ? message.line : "네, 듣고 있어요.",
          {
            reason: "conversation",
            items: ["laptop", "videoCall"],
            companions: [companion.id],
            ...(participant === state && message.speech
              ? { speech: message.speech }
              : {}),
            ...(participant.remoteActive ? { remoteWork: true } : {}),
          },
        );
      }
      return true;
    }
    if (
      absent ||
      recipient.absence ||
      unavailable.has(recipient.id) ||
      !recipient.present ||
      atHome(recipient) ||
      atHome(state)
    ) {
      recipient.notes++;
      recipient.inbox = [
        ...(recipient.inbox ?? []).slice(-49),
        {
          fromId: state.id,
          line: message.line,
          at: message.at,
          ...(message.speech ? { speech: message.speech } : {}),
        },
      ];
      if (!absent && !atHome(state)) {
        state.actions = [];
        queueAction(
          state,
          at,
          "leaveNote",
          to,
          8_000,
          "자리에 쪽지를 남겨둘게요.",
          {
            reason: "conversation",
            items: ["note"],
            noteCount: recipient.notes,
          },
        );
        queueAction(state, at, "move", desk(state), 5_000, "", {
          reason: "conversation",
        });
      }
    } else {
      state.actions = [];
      queueAction(
        state,
        at,
        "move",
        recipient.position,
        state.buildingId === recipient.buildingId ? 5_000 : 13_000,
        "",
        { reason: "conversation" },
      );
      queueAction(state, at, "talk", recipient.position, 6_000, message.line, {
        reason: "conversation",
        companions: [recipient.id],
        ...(message.speech ? { speech: message.speech } : {}),
      });
      queueAction(state, at, "move", desk(state), 5_000, "", {
        reason: "conversation",
      });
    }
    return true;
  }

  private rest(
    state: EmployeeState,
    states: Map<string, EmployeeState>,
    members: Map<string, StaffMember>,
    day: WorkDay,
    at: number,
    event?: CompanyEvent,
    weather?: PlanningFrame["weather"],
    remote = false,
  ): void {
    const companions = [...states.values()]
      .filter(
        (person) =>
          !remote &&
          person.id !== state.id &&
          person.spaceId === state.spaceId &&
          members.has(person.id) &&
          !person.absence &&
          !atHome(person) &&
          !person.actions.length &&
          (person.status === null || person.status === "idle"),
      )
      .map((person) => ({
        id: person.id,
        name: members.get(person.id)?.employee.name ?? person.persona.name,
        affinity: this.store.affinity(state.id, person.id),
      }));
    const random = seededRandom(
      hashSeed(`${state.id}:${state.serial}:${day.date}`),
    );
    const plan = planBreak(
      {
        idleMs: at - state.statusSince,
        remote,
        month: day.month,
        minute: day.minute,
        weekday: day.weekday,
        holiday: day.holidayNames[0],
        weather,
        traits: state.persona.traits,
        event: event ?? (companions.length >= 1 ? "sharedBreak" : undefined),
        preferred: state.nextBreak,
        companions,
        ...this.store.breakHistory(state.id, day.date),
      },
      random,
    );
    if (!plan) return;
    state.event = undefined;
    state.nextBreak = plan.next;
    const destination: Waypoint =
      plan.place === "home"
        ? home(state)
        : plan.place === "desk"
          ? desk(state)
          : { kind: plan.place, buildingId: state.buildingId };
    const group = [state.id, ...plan.companions]
      .map((id) => states.get(id))
      .filter((member): member is EmployeeState => Boolean(member));
    const available = group.filter((member) => {
      if (member === state) return true;
      const { recent, counts } = this.store.breakHistory(member.id, day.date);
      return (
        !recent.some(({ activity }) => activity === plan.activity) &&
        (counts.get(plan.activity) ?? 0) < plan.dailyLimit
      );
    });
    // Start group activities together after the slowest required walk.
    const walk = available.some(
      (member) => !samePlace(member.position, destination),
    )
      ? 6_000
      : 0;
    for (const member of available) {
      this.scheduleBreak(
        member,
        plan,
        destination,
        available.map(({ id }) => id).filter((id) => id !== member.id),
        day,
        at,
        walk,
      );
      if (member !== state) this.store.interact(state.id, member.id);
    }
  }

  private scheduleBreak(
    state: EmployeeState,
    plan: BreakPlan,
    target: Waypoint,
    companions: string[],
    day: WorkDay,
    at: number,
    walk: number,
  ): void {
    if (walk) queueAction(state, at, "move", target, walk);
    const items = plan.item === "none" ? [] : [plan.item];
    queueAction(
      state,
      at,
      "break",
      target,
      plan.durationMs,
      withoutIp(plan.line),
      {
        activity: plan.activity,
        motion: plan.motion,
        ...(state.remoteActive ? { remoteWork: true } : {}),
        items,
        companions,
      },
    );
    this.store.addBreak(state.id, at, day.date, plan.activity, plan.line);
  }
}

function samePlace(first: Waypoint, second: Waypoint): boolean {
  return (
    first.kind === second.kind &&
    first.buildingId === second.buildingId &&
    first.employeeId === second.employeeId
  );
}

function seededRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
