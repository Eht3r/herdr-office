import type { PersonalityTrait, WaypointKind } from "./simulation.ts";

export type ActivityPlace = Exclude<
  WaypointKind,
  "station" | "entrance" | "elevator" | "sleepCapsules"
>;
export type ActivityCondition =
  | "lunch"
  | "afternoon"
  | "night"
  | "rain"
  | "snow"
  | "friday"
  | "monday"
  | "holiday";
export type CompanyEvent =
  | "celebration"
  | "blockedLong"
  | "returned"
  | "newTeam"
  | "sharedBreak";

export interface Activity {
  id: string;
  motion: string;
  places: ActivityPlace[];
  items: string[];
  lines: string[];
  duration: [number, number];
  companions: boolean;
  dailyLimit: number;
  weight: number;
  traits?: PersonalityTrait[];
  when?: ActivityCondition;
  event?: CompanyEvent;
  next?: string;
}

function activity(
  id: string,
  motion: string,
  places: ActivityPlace[],
  items: string[],
  line: string,
  options: Partial<Activity> = {},
): Activity {
  return {
    id,
    motion,
    places,
    items,
    lines: [line],
    duration: [25, 80],
    companions: false,
    dailyLimit: 3,
    weight: 1,
    ...options,
  };
}

export const activities: readonly Activity[] = [
  activity(
    "stretch",
    "stretch",
    ["desk", "rooftop"],
    ["none"],
    "어깨 좀 펴야겠어요.",
    { duration: [15, 30], traits: ["active"] },
  ),
  activity(
    "water",
    "drink",
    ["desk", "kitchenette"],
    ["water", "mug"],
    "물부터 한 잔 마실게요.",
    { duration: [15, 45] },
  ),
  activity(
    "stockChart",
    "phone",
    ["desk", "lounge"],
    ["phone"],
    "오늘 장이 어떻게 됐더라?",
    {
      traits: ["investor"],
      lines: ["올랐네요! 기분 좋다.", "아이고, 또 빠졌네…"],
    },
  ),
  activity("news", "phone", ["desk", "lounge"], ["phone"], "뉴스 좀 볼까요?"),
  activity(
    "music",
    "sit",
    ["desk", "lounge"],
    ["earbuds"],
    "노래 한 곡만 듣고 갈게요.",
    { traits: ["quiet"] },
  ),
  activity(
    "read",
    "read",
    ["desk", "lounge", "park"],
    ["book", "ereader"],
    "아까 읽던 데가 어디였지?",
    { traits: ["quiet"] },
  ),
  activity(
    "puzzle",
    "play",
    ["desk", "lounge"],
    ["phone", "controller"],
    "한 판만 더 해볼까?",
    { traits: ["gamer"] },
  ),
  activity(
    "plant",
    "waterPlant",
    ["desk", "rooftop"],
    ["wateringCan"],
    "화분에 물 줘야지.",
  ),
  activity(
    "tidy",
    "tidy",
    ["desk"],
    ["cloth", "organizer"],
    "책상을 조금 치워볼까요?",
  ),
  activity(
    "doodle",
    "draw",
    ["desk", "lounge"],
    ["notebook", "pencil"],
    "생각난 걸 그려둘래요.",
  ),
  activity(
    "photo",
    "photo",
    ["desk", "rooftop", "park"],
    ["phone", "camera"],
    "이 장면은 찍어둬야겠어요.",
  ),
  activity(
    "breathe",
    "breathe",
    ["desk", "rooftop", "park"],
    ["none"],
    "후… 잠깐 숨 돌릴게요.",
  ),
  activity(
    "checkCalendar",
    "read",
    ["desk"],
    ["calendar", "notebook"],
    "오늘 일정이 뭐가 남았더라?",
  ),
  activity(
    "snack",
    "eat",
    ["desk", "kitchenette", "lounge"],
    ["cookie", "nuts", "fruit"],
    "출출해서 조금만 먹을게요.",
    { event: "sharedBreak", companions: true },
  ),
  activity(
    "tea",
    "drink",
    ["desk", "kitchenette", "cafe"],
    ["mug", "tea"],
    "따뜻한 차 한 잔 어때요?",
    { companions: true },
  ),
  activity("restroom", "walk", ["restroom"], ["none"], "", {
    duration: [55, 90],
    next: "wash",
  }),
  activity("wash", "wash", ["restroom"], ["soap"], "손 씻고 갈게요.", {
    duration: [15, 30],
    next: "water",
  }),
  activity(
    "coffee",
    "drink",
    ["kitchenette", "cafe"],
    ["mug", "coffee"],
    "커피 같이 마실래요?",
    { companions: true, traits: ["social"] },
  ),
  activity(
    "mondayCoffee",
    "drink",
    ["kitchenette", "cafe"],
    ["coffee"],
    "월요일엔 커피가 필요해요.",
    { when: "monday" },
  ),
  activity(
    "chat",
    "talk",
    ["lounge", "cafe"],
    ["mug", "none"],
    "{name}님, 잠깐 이야기할래요?",
    { companions: true, traits: ["social"] },
  ),
  activity(
    "tableTennis",
    "play",
    ["lounge"],
    ["paddle"],
    "탁구 한 게임 할래요?",
    { companions: true, traits: ["active"], duration: [90, 180] },
  ),
  activity(
    "darts",
    "play",
    ["lounge"],
    ["darts"],
    "이번엔 가운데 맞힐 거예요.",
    { companions: true, traits: ["active"] },
  ),
  activity(
    "boardGame",
    "play",
    ["lounge"],
    ["cards", "boardGame"],
    "시간 되면 같이 한 판 해요.",
    { companions: true, traits: ["gamer"], duration: [120, 240] },
  ),
  activity("nap", "lieDown", ["lounge"], ["cushion"], "잠깐 눈 좀 붙일게요.", {
    when: "afternoon",
    duration: [120, 300],
    traits: ["quiet"],
  }),
  activity(
    "yoga",
    "exercise",
    ["lounge", "rooftop", "park"],
    ["mat"],
    "몸 좀 풀고 올게요.",
    { traits: ["active"], duration: [60, 150] },
  ),
  activity(
    "walk",
    "walk",
    ["park", "rooftop"],
    ["none"],
    "잠깐 바람 쐬고 올게요.",
    { event: "blockedLong", duration: [90, 180], traits: ["active"] },
  ),
  activity(
    "shop",
    "shop",
    ["convenienceStore"],
    ["tote", "phone"],
    "편의점 잠깐 들렀다 올게요.",
    { duration: [120, 240] },
  ),
  activity(
    "lunch",
    "eat",
    ["restaurant"],
    ["meal"],
    "같이 점심 먹으러 갈래요?",
    { when: "lunch", companions: true, duration: [180, 450] },
  ),
  activity(
    "delivery",
    "collect",
    ["kitchenette", "desk"],
    ["parcel"],
    "오늘 오기로 한 게 왔네요.",
  ),
  activity(
    "call",
    "call",
    ["rooftop", "park"],
    ["phone", "earbuds"],
    "전화 한 통만 하고 올게요.",
  ),
  activity("cake", "eat", ["lounge"], ["cake"], "케이크 같이 나눠 먹어요!", {
    weight: 0.09,
    companions: true,
  }),
  activity(
    "lateSnack",
    "eat",
    ["kitchenette", "desk"],
    ["meal", "snackBox"],
    "저녁 못 먹어서 야식 시켰어요.",
    { when: "night" },
  ),
  activity(
    "rainWindow",
    "look",
    ["desk", "lounge"],
    ["mug", "none"],
    "조용히 비 구경하기 좋네요.",
    { when: "rain" },
  ),
  activity(
    "snowWindow",
    "photo",
    ["desk", "rooftop"],
    ["phone"],
    "눈 오는 거 봤어요?",
    { when: "snow" },
  ),
  activity(
    "fridayChat",
    "talk",
    ["lounge", "cafe"],
    ["mug", "none"],
    "금요일이라 그런지 조금 들뜨네요.",
    { when: "friday", companions: true },
  ),
  activity(
    "holidayTreat",
    "eat",
    ["kitchenette", "lounge"],
    ["holidayTreat"],
    "휴일인데 같이 간식라도 먹어요.",
    { when: "holiday", companions: true },
  ),
  activity(
    "celebrate",
    "highFive",
    ["desk", "lounge"],
    ["none"],
    "드디어 끝났네요. 하이파이브!",
    { event: "celebration", companions: true },
  ),
  activity(
    "welcome",
    "wave",
    ["desk", "lounge"],
    ["none"],
    "{name}님, 잘 쉬고 오셨어요?",
    { event: "returned", companions: true },
  ),
  activity(
    "visit",
    "look",
    ["lounge", "rooftop"],
    ["camera", "none"],
    "새 사무실 어떻게 꾸몄는지 볼까요?",
    { event: "newTeam", companions: true },
  ),
  activity(
    "homeNap",
    "lieDown",
    ["home"],
    ["cushion", "blanket"],
    "소파에 잠깐 누워 있을게요.",
    { duration: [30, 180] },
  ),
  activity(
    "homeCooking",
    "cook",
    ["home"],
    ["pan", "tea", "fruit"],
    "집에 있는 걸로 뭐 좀 만들까요?",
    { duration: [25, 120] },
  ),
  activity("homePet", "play", ["home"], ["petToy", "treat"], "잠깐 놀아줄게.", {
    duration: [20, 65],
  }),
  activity(
    "homeReading",
    "read",
    ["home"],
    ["book", "ereader"],
    "조용히 책 몇 쪽 읽어야지.",
    { duration: [25, 90], traits: ["quiet"] },
  ),
  activity(
    "homeStretch",
    "stretch",
    ["home"],
    ["mat", "none"],
    "방에서 스트레칭 좀 할게요.",
    { duration: [25, 80], traits: ["active"] },
  ),
  activity(
    "homeWalk",
    "walk",
    ["park"],
    ["none", "phone"],
    "동네 한 바퀴 돌고 올게요.",
    { duration: [65, 150], traits: ["active"] },
  ),
];

// Optional providers may propose catalog entries for validation in a later stage.
export interface ActivityExtension {
  propose(context: {
    date: string;
    conditions: ActivityCondition[];
  }): Promise<Activity[]>;
}
