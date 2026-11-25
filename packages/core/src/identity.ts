const familyNames = [
  "김",
  "이",
  "박",
  "최",
  "정",
  "강",
  "조",
  "윤",
  "장",
  "임",
  "한",
  "서",
  "신",
  "오",
  "권",
  "배",
];
const givenNames = [
  "지우",
  "서윤",
  "도현",
  "서진",
  "하준",
  "윤서",
  "유진",
  "지민",
  "민서",
  "수현",
  "시우",
  "재현",
  "하린",
  "지안",
  "현우",
  "수아",
  "민준",
  "태윤",
  "유나",
  "예준",
  "은서",
  "소윤",
  "유현",
  "채원",
  "정우",
  "현서",
  "예린",
  "선우",
  "하윤",
  "서현",
  "나윤",
  "재인",
];

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value)
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619);
  return hash >>> 0;
}

export function seededEmployeeName(spaceId: string, address: string): string {
  const seed = hashSeed(JSON.stringify([spaceId, address]));
  return (
    familyNames[seed % familyNames.length] +
    givenNames[Math.floor(seed / familyNames.length) % givenNames.length]
  );
}

export type Provider = "claude" | "codex" | "cursor";

export function providerFor(agent: string | null): Provider | null {
  const value = agent?.toLowerCase();
  if (value?.includes("claude")) return "claude";
  if (value?.includes("codex")) return "codex";
  if (value === "agent" || value?.includes("cursor")) return "cursor";
  return null;
}
