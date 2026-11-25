import {
  hashSeed,
  type TownDecoration,
  type TownStory,
  type WeatherKind,
} from "@herdr-office/core";
import type { WorkDay } from "../calendar.ts";

const weatherReport: Record<WeatherKind, string> = {
  clear: "구름이 적고 산책하기 좋은 날입니다.",
  cloudy: "해가 구름 사이로 간간이 비칩니다.",
  rain: "비가 내려 우산을 챙긴 주민이 많습니다.",
  snow: "눈이 내려 보도와 지붕에 눈이 쌓였습니다.",
  fog: "옅은 안개가 있어 교차로 시야가 짧습니다.",
  storm: "뇌우로 주민들이 야외 일정을 줄였습니다.",
};
const localEvents = [
  ["골목 택배 도착", "정오쯤 주거지 앞에 택배 차량이 잠시 정차했습니다."],
  [
    "공원에 나타난 길고양이",
    "화단 옆 벤치에서 고양이가 한동안 햇볕을 쬐었습니다.",
  ],
  ["인도 보수 안내", "가게 앞 보도블록을 바꾸는 소규모 공사가 있습니다."],
  ["버스 운행 지연", "도로 사정으로 정류장에 평소보다 조금 늦게 도착합니다."],
] as const;

export function neighborhoodEvents(
  day: WorkDay,
  weather: WeatherKind,
  at: number,
  employees: number,
  seed: string,
): { decoration: TownDecoration; stories: TownStory[] } {
  const season =
    day.month <= 2 || day.month === 12
      ? { color: "#91b7cb", name: "겨울 조명" }
      : day.month <= 5
        ? { color: "#d48f9d", name: "봄꽃 장식" }
        : day.month <= 8
          ? { color: "#6ea588", name: "여름 녹음 장식" }
          : { color: "#c9945d", name: "가을 단풍 장식" };
  const decoration: TownDecoration = day.isHoliday
    ? {
        kind: "festival",
        name: `${day.holidayNames[0]} 동네 축제`,
        color: "#d2a15d",
      }
    : day.isWeekend
      ? { kind: "market", name: "주말 장터", color: "#d58a70" }
      : { kind: "season", ...season };
  const story = (
    kind: TownStory["kind"],
    key: string,
    title: string,
    body: string,
  ): TownStory => ({ id: `${day.date}:${key}`, at, kind, title, body });
  const wet = ["rain", "snow", "storm"].includes(weather);
  const selected = hashSeed(`${seed}:${day.date}:local`) % localEvents.length;
  const local = wet
    ? [...new Set([3, selected, (selected + 1) % localEvents.length])]
    : [selected];
  return {
    decoration,
    stories: [
      story("weather", "forecast", "오늘의 동네 날씨", weatherReport[weather]),
      story(
        "company",
        "campus",
        "캠퍼스 소식",
        `오늘 캠퍼스에는 직원 ${employees}명이 등록되어 있습니다.`,
      ),
      story(
        "event",
        "decoration",
        decoration.name,
        decoration.kind === "season"
          ? "공원 산책길이 계절 장식으로 바뀌었습니다."
          : "주민들이 공원 앞에 모입니다.",
      ),
      ...local.map((index) =>
        story(
          "local",
          `local-${index}`,
          localEvents[index][0],
          localEvents[index][1],
        ),
      ),
    ],
  };
}
