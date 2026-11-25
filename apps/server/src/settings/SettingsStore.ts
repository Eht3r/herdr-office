import { isIP } from "node:net";
import {
  type ExposureLevel,
  exposureLevels,
  type OfficeSettings,
  redact,
} from "@herdr-office/core";
import Database from "better-sqlite3";
import { accessOptionsFromEnv } from "../access.ts";
import {
  configuredHours,
  configuredTeamHours,
  parseHours,
} from "../sim/WorkHours.ts";

export function defaults(env: NodeJS.ProcessEnv = {}): OfficeSettings {
  const level = exposureLevels.find(
    (level) => level === env.OFFICE_SPEECH_EXPOSURE,
  );
  const absence = (value: string | undefined, fallback: number) =>
    value?.trim() ? Number(value) : fallback;
  return {
    company: {
      name: env.OFFICE_COMPANY_NAME ?? "Herdr Office",
      latitude: env.OFFICE_LATITUDE?.trim()
        ? Number(env.OFFICE_LATITUDE)
        : 37.5665,
      longitude: env.OFFICE_LONGITUDE?.trim()
        ? Number(env.OFFICE_LONGITUDE)
        : 126.978,
      timeZone: env.OFFICE_TIME_ZONE ?? "Asia/Seoul",
      country: env.OFFICE_COUNTRY ?? "KR",
    },
    work: {
      enabled: env.OFFICE_WORK_HOURS_ENABLED !== "false",
      learn: env.OFFICE_LEARN_HOURS === "true",
      company: configuredHours(env.OFFICE_COMPANY_HOURS) ?? {},
      teams: configuredTeamHours(env.OFFICE_TEAM_HOURS),
      remoteWork: env.OFFICE_REMOTE_WORK === "none" ? "none" : "afterHours",
      absence: {
        nap: absence(env.OFFICE_ABSENCE_NAP_MINUTES, 30),
        sleep: absence(env.OFFICE_ABSENCE_SLEEP_MINUTES, 300),
        leave: absence(env.OFFICE_ABSENCE_LEAVE_MINUTES, 1440),
      },
    },
    sharing: {
      speech: { owner: level ?? "status", public: "status" },
      teams: {},
    },
    security: { ...accessOptionsFromEnv(env), masks: [] },
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RangeError(message);
  return value as Record<string, unknown>;
}

function label(value: unknown, message: string, max = 100): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /\p{Cc}/u.test(value)
  )
    throw new RangeError(message);
  return value.trim();
}

function numberIn(
  value: unknown,
  min: number,
  max: number,
  message: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new RangeError(message);
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new RangeError("켜기와 끄기 중 하나를 선택하세요.");
  return value;
}

function mapRules<T>(
  value: unknown,
  rule: (value: unknown) => T,
): Record<string, T> {
  const entries = Object.entries(
    record(value, "팀별 설정 형식이 올바르지 않습니다."),
  );
  if (entries.length > 256)
    throw new RangeError("팀 설정은 최대 256개까지 저장할 수 있습니다.");
  return Object.fromEntries(
    entries.map(([id, value]) => [
      label(id, "팀 ID가 올바르지 않습니다.", 256),
      rule(value),
    ]),
  );
}

function exposure(value: unknown): ExposureLevel {
  const found = exposureLevels.find((level) => level === value);
  if (found === undefined)
    throw new RangeError("말풍선 공개 단계를 선택하세요.");
  return found;
}

function strings(
  value: unknown,
  limit: number,
  parse: (value: unknown) => string,
): string[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new RangeError(`최대 ${limit}개까지 입력할 수 있습니다.`);
  return [...new Set(value.map(parse))];
}

function network(value: unknown): string {
  const input = label(value, "올바른 IP 주소 또는 CIDR을 입력하세요.");
  const [address, prefix, extra] = input.split("/");
  const family = isIP(address);
  if (
    !family ||
    extra !== undefined ||
    (prefix !== undefined &&
      (!/^\d{1,3}$/u.test(prefix) ||
        Number(prefix) > (family === 4 ? 32 : 128)))
  )
    throw new RangeError("올바른 IP 주소 또는 CIDR을 입력하세요.");
  return input;
}

function host(value: unknown): string {
  const input = label(
    value,
    "포트 없이 호스트 이름을 입력하세요.",
    253,
  ).toLowerCase();
  if (
    isIP(input) ||
    input
      .split(".")
      .every((part) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u.test(part))
  )
    return input;
  throw new RangeError("프로토콜·경로·포트 없이 호스트 이름을 입력하세요.");
}

// Restricted, bounded regex: no groups, alternation, lookarounds, backreferences
// or ambiguous chained quantifiers. A single variable repetition cannot backtrack exponentially.
export function compileMask(value: string): RegExp {
  const atom = String.raw`(?:\\[dDsSwW.^$*+?{}()[\]\/\\-]|\[(?:\\[^\r\n]|[^\]\\\r\n])+\]|[^\\\[\].^$*+?{}()|])`;
  const token = new RegExp(
    `(${atom})(\\{\\d{1,3}(?:,\\d{1,3})?\\}|[?+*])?`,
    "uy",
  );
  let current = value.startsWith("^") ? 1 : 0;
  const end =
    value.endsWith("$") && !value.endsWith("\\$")
      ? value.length - 1
      : value.length;
  let repeated = false;
  let required = false;
  while (current < end) {
    token.lastIndex = current;
    const matched = token.exec(value);
    if (!matched || token.lastIndex > end)
      throw new RangeError(
        "마스킹 정규식은 문자·문자 클래스와 간단한 반복만 지원합니다.",
      );
    const quantity = matched[2];
    if (quantity) {
      const counts = quantity.match(/\d+/gu)?.map(Number);
      if (
        repeated ||
        counts?.some((n) => n > 128) ||
        (["+", "*"].includes(quantity) &&
          (token.lastIndex !== end ||
            (end < value.length && !value.startsWith("^"))))
      )
        throw new RangeError(
          "반복은 패턴마다 한 번만 사용할 수 있습니다. + 또는 *는 끝에 두세요.",
        );
      repeated = true;
      required ||= quantity === "+" || (counts?.[0] ?? 0) > 0;
    } else {
      required = true;
    }
    current = token.lastIndex;
  }
  if (!required)
    throw new RangeError(
      "빈 문자열과 일치하는 마스킹 규칙은 저장할 수 없습니다.",
    );
  try {
    return new RegExp(value, "gu");
  } catch {
    throw new RangeError("마스킹 정규식 문법을 확인하세요.");
  }
}

export function validateSettings(input: unknown): OfficeSettings {
  const root = record(input, "설정 형식이 올바르지 않습니다.");
  const company = record(root.company, "회사 설정을 입력하세요.");
  const work = record(root.work, "근무 설정을 입력하세요.");
  const absence = record(work.absence, "부재 기준을 입력하세요.");
  const sharing = record(root.sharing, "공개 단계를 입력하세요.");
  const speech = record(sharing.speech, "공개 단계를 입력하세요.");
  const security = record(root.security, "보안 설정을 입력하세요.");
  const country = label(
    company.country,
    "두 글자 국가 코드를 입력하세요.",
    2,
  ).toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country))
    throw new RangeError("두 글자 국가 코드를 입력하세요.");
  const timeZone = label(company.timeZone, "시간대를 입력하세요.");
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new RangeError("시간대는 Asia/Seoul과 같은 IANA 이름을 사용하세요.");
  }
  const duration = (value: unknown) =>
    numberIn(value, 1, 10080, "부재 기준은 1~10080분으로 입력하세요.");
  const nap = duration(absence.nap);
  const sleep = duration(absence.sleep);
  const leave = duration(absence.leave);
  if (!(nap < sleep && sleep < leave))
    throw new RangeError(
      "쪽잠, 수면, 조기퇴근 기준은 순서대로 늘어나야 합니다.",
    );
  if (work.remoteWork !== "none" && work.remoteWork !== "afterHours")
    throw new RangeError("재택 정책을 선택하세요.");
  return {
    company: {
      name: label(company.name, "회사 이름을 1~100자로 입력하세요."),
      latitude: numberIn(company.latitude, -90, 90, "위도는 -90~90입니다."),
      longitude: numberIn(
        company.longitude,
        -180,
        180,
        "경도는 -180~180입니다.",
      ),
      timeZone,
      country,
    },
    work: {
      enabled: boolean(work.enabled),
      learn: boolean(work.learn),
      company: parseHours(work.company),
      teams: mapRules(work.teams, parseHours),
      remoteWork: work.remoteWork,
      absence: { nap, sleep, leave },
    },
    sharing: {
      speech: {
        owner: exposure(speech.owner),
        public: exposure(speech.public),
      },
      teams: mapRules(sharing.teams, (input) => {
        const rule = record(input, "팀 공개 단계를 확인하세요.");
        return {
          ...(rule.owner !== undefined ? { owner: exposure(rule.owner) } : {}),
          ...(rule.public !== undefined
            ? { public: exposure(rule.public) }
            : {}),
        };
      }),
    },
    security: {
      masks: strings(security.masks, 16, (value) => {
        const rule = label(value, "마스킹 패턴은 1~120자로 입력하세요.", 120);
        compileMask(rule);
        return rule;
      }),
      trustedNetworks: strings(security.trustedNetworks, 128, network),
      allowedHosts: strings(security.allowedHosts, 128, host),
      publicHosts: strings(security.publicHosts, 128, host),
    },
  };
}

export class SettingsStore {
  private readonly db;
  private value: OfficeSettings;
  private patterns: RegExp[];

  constructor(path: string, env: NodeJS.ProcessEnv = {}) {
    this.db = new Database(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS office_settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)",
    );
    const stored = this.db
      .prepare<[], { value: string }>(
        "SELECT value FROM office_settings WHERE id = 1",
      )
      .get();
    this.value = validateSettings(
      stored ? JSON.parse(stored.value) : defaults(env),
    );
    this.patterns = this.value.security.masks.map(compileMask);
    if (!stored)
      this.db
        .prepare("INSERT OR IGNORE INTO office_settings VALUES (1, ?)")
        .run(JSON.stringify(this.value));
  }

  get(): OfficeSettings {
    return this.value;
  }

  save(input: unknown): OfficeSettings {
    const value = validateSettings(input);
    const patterns = value.security.masks.map(compileMask);
    this.db
      .prepare("UPDATE office_settings SET value = ? WHERE id = 1")
      .run(JSON.stringify(value));
    this.value = value;
    this.patterns = patterns;
    return value;
  }

  mask = (text: string): string =>
    this.patterns.reduce(
      (text, pattern) => text.replace(pattern, "[REDACTED]"),
      redact(text),
    );
  close(): void {
    this.db.close();
  }
}
