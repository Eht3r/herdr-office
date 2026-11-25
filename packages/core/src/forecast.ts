export type WeatherKind =
  | "clear"
  | "cloudy"
  | "rain"
  | "snow"
  | "fog"
  | "storm";
export interface WeatherLocation {
  latitude: number;
  longitude: number;
  timeZone: string;
}
export interface CurrentWeather {
  code: number;
  cloudCover: number;
  temperature: number;
  precipitation: number;
  snowfall: number;
}
export interface WeatherReading {
  location: WeatherLocation;
  current: CurrentWeather | null;
  at: number | null;
  stale: boolean;
}

export const seoul: WeatherLocation = {
  latitude: 37.5665,
  longitude: 126.978,
  timeZone: "Asia/Seoul",
};

export function weatherKind(code: number): WeatherKind {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51) return "rain";
  return code >= 2 ? "cloudy" : "clear";
}

export function forecastUrl({
  latitude,
  longitude,
  timeZone,
}: WeatherLocation): URL {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: timeZone,
    current: "weather_code,temperature_2m,cloud_cover,precipitation,snowfall",
  }).toString();
  return url;
}

export function readForecast(input: unknown): CurrentWeather {
  if (
    !input ||
    typeof input !== "object" ||
    !("current" in input) ||
    !input.current ||
    typeof input.current !== "object"
  ) {
    throw new Error("Current weather is missing");
  }
  const {
    weather_code: code,
    cloud_cover: cloudCover,
    temperature_2m: temperature,
    precipitation,
    snowfall,
  } = input.current as Record<string, unknown>;
  if (
    typeof code !== "number" ||
    typeof cloudCover !== "number" ||
    typeof temperature !== "number" ||
    typeof precipitation !== "number" ||
    typeof snowfall !== "number" ||
    ![code, cloudCover, temperature, precipitation, snowfall].every(
      Number.isFinite,
    )
  ) {
    throw new Error("Current weather is invalid");
  }
  return { code, cloudCover, temperature, precipitation, snowfall };
}
