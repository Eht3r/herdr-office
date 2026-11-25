export const exposureLevels = [
  "hidden",
  "status",
  "title",
  "messages",
  "raw",
] as const;
export type ExposureLevel = (typeof exposureLevels)[number];
export type Audience = "owner" | "public";
export type Visibility = Record<Audience, ExposureLevel>;
export type HoursRule = Partial<
  Record<number, [start: number, end: number] | null>
>;

export interface OfficeSettings {
  company: {
    name: string;
    latitude: number;
    longitude: number;
    timeZone: string;
    country: string;
  };
  work: {
    enabled: boolean;
    learn: boolean;
    company: HoursRule;
    teams: Record<string, HoursRule>;
    remoteWork: "none" | "afterHours";
    absence: { nap: number; sleep: number; leave: number };
  };
  sharing: { speech: Visibility; teams: Record<string, Partial<Visibility>> };
  security: {
    masks: string[];
    trustedNetworks: string[];
    allowedHosts: string[];
    publicHosts: string[];
  };
}
