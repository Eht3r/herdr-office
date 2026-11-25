import {
  forecastUrl,
  readForecast,
  seoul,
  type WeatherKind,
  type WeatherLocation,
  type WeatherReading,
  weatherKind,
} from "@herdr-office/core";
import { useCallback, useEffect, useState } from "react";

const weatherPreview = new Set([
  "clear",
  "rain",
  "snow",
  "fog",
  "storm",
  "cloudy",
]);
const interval = 10 * 60_000;
const initial: WeatherReading = {
  location: seoul,
  current: null,
  stale: true,
  at: null,
};

export function previewWeather(search: string): {
  time: number | null;
  kind: WeatherKind | null;
} {
  const params = new URLSearchParams(search);
  const input = params.get("time");
  const time = input ? Date.parse(input) : NaN;
  const weather = params.get("weather");
  return {
    time: Number.isFinite(time) ? time : null,
    kind:
      weather && weatherPreview.has(weather) ? (weather as WeatherKind) : null,
  };
}

/** Server time minus local time, assuming the reply arrived halfway. */
export function serverSkew(
  serverNow: number,
  sentAt: number,
  receivedAt: number,
): number {
  return Math.round(serverNow - (sentAt + receivedAt) / 2);
}

export function useWeather() {
  const [company, setCompany] = useState(initial);
  const [visitor, setVisitor] = useState<WeatherReading | null>(null);
  const [location, setLocation] = useState<WeatherLocation | null>(null);
  const [mode, setMode] = useState<"company" | "visitor" | "locating">(
    "company",
  );
  const [updated, setUpdated] = useState(Date.now);
  const [preview] = useState(() => previewWeather(window.location.search));

  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/weather", {
          signal: controller.signal,
        });
        if (response.ok) setCompany((await response.json()) as WeatherReading);
      } catch {
        // The last known reading is still useful if the proxy is temporarily offline.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, interval);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  // The viewer's clock may be off; follow the server's real time instead.
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const sync = async () => {
      try {
        const sent = Date.now();
        const response = await fetch("/api/me");
        const received = Date.now();
        const { now } = (await response.json()) as { now?: number };
        if (typeof now === "number") setSkew(serverSkew(now, sent, received));
      } catch {
        // Keep the last known correction.
      }
    };
    void sync();
    const timer = window.setInterval(sync, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (preview.time !== null) return;
    const timer = window.setInterval(() => setUpdated(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview.time]);

  useEffect(() => {
    if (!location || mode !== "visitor") return;
    let cancelled = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(forecastUrl(location), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Weather service unavailable");
        const current = readForecast(await response.json());
        if (!cancelled)
          setVisitor({ location, current, at: Date.now(), stale: false });
      } catch {
        if (!cancelled)
          setVisitor((reading) => ({
            location,
            current: reading?.current ?? null,
            at: reading?.at ?? null,
            stale: true,
          }));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, interval);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [location, mode]);

  const useVisitor = useCallback(() => {
    if (location) {
      setMode("visitor");
      return;
    }
    if (!navigator.geolocation) {
      setMode("company");
      return;
    }
    setMode("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        setMode((current) => (current === "locating" ? "visitor" : current));
      },
      () =>
        setMode((current) => (current === "locating" ? "company" : current)),
      { timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, [location]);
  const useCompany = useCallback(() => setMode("company"), []);
  const reading =
    mode === "visitor" && location
      ? (visitor ?? { ...initial, location })
      : company;
  return {
    reading,
    previewing: preview.time !== null || preview.kind !== null,
    mode,
    useCompany,
    useVisitor,
    at: preview.time ?? updated + skew,
    kind:
      preview.kind ??
      (reading.current ? weatherKind(reading.current.code) : "clear"),
    cloudCover: preview.kind
      ? { clear: 0, cloudy: 75, rain: 86, snow: 80, fog: 78, storm: 98 }[
          preview.kind
        ]
      : (reading.current?.cloudCover ?? 0),
  };
}
