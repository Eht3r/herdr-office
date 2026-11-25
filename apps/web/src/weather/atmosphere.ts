import type { WeatherKind, WeatherLocation } from "@herdr-office/core";
import { getMoonPosition, getPosition } from "suncalc";
import { Color } from "three";
import type { Point3 } from "../layout/campusLayout.ts";

export interface Atmosphere {
  at: number;
  hour: number;
  kind: WeatherKind;
  clouds: number;
  daylight: number;
  sky: string;
  haze: string;
  ambient: number;
  sunlight: number;
  direction: Point3;
  moonAzimuth: number;
  moonAltitude: number;
  night: boolean;
}

const radians = Math.PI / 180;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function atmosphere(
  at: number,
  location: WeatherLocation,
  kind: WeatherKind,
  cloudCover: number,
): Atmosphere {
  const date = new Date(at);
  const { latitude, longitude, timeZone } = location;
  const sun = getPosition(date, latitude, longitude);
  const moon = getMoonPosition(date, latitude, longitude);
  const illumination = clamp((sun.altitude + 10) / 32);
  const daylight = illumination * illumination * (3 - 2 * illumination);
  const clouds = clamp(cloudCover / 100);
  const hours = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
  });
  const hour = Number(hours.format(date));
  const overcast =
    kind === "rain" || kind === "snow" || kind === "storm" || kind === "fog";
  const dayColor = new Color(
    overcast ? (kind === "snow" ? "#d8e5ed" : "#9eb8c8") : "#cbdfe5",
  );
  const sky = new Color("#14243c").lerp(dayColor, daylight).getStyle();
  const elevation = Math.max(8, sun.altitude) * radians;
  const yaw = sun.azimuth * radians;
  return {
    at,
    hour,
    kind,
    clouds,
    daylight,
    sky,
    haze: new Color("#45566c")
      .lerp(new Color(kind === "fog" ? "#cbd7d4" : "#b5c9d5"), daylight)
      .getStyle(),
    ambient: 0.79 + daylight * (0.65 - clouds * 0.23),
    sunlight: Math.max(
      0,
      sun.altitude > 0 ? daylight * (1.78 - clouds * 0.9) : 0,
    ),
    direction: [
      Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      -Math.cos(yaw) * Math.cos(elevation),
    ],
    moonAzimuth: moon.azimuth,
    moonAltitude: moon.altitude,
    night: sun.altitude < -5,
  };
}
