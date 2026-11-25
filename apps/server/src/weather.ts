import {
  forecastUrl,
  readForecast,
  seoul,
  type WeatherLocation,
  type WeatherReading,
} from "@herdr-office/core";

export const WEATHER_CACHE_MS = 10 * 60_000;

export function companyWeatherLocation(
  lat?: string,
  lon?: string,
  timeZone?: string,
): WeatherLocation {
  const latitude = lat?.trim() ? Number(lat) : seoul.latitude;
  const longitude = lon?.trim() ? Number(lon) : seoul.longitude;
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  ) {
    throw new RangeError(
      "OFFICE_LATITUDE/OFFICE_LONGITUDE require valid geographic coordinates",
    );
  }
  const zone = timeZone ?? seoul.timeZone;
  new Intl.DateTimeFormat("en", { timeZone: zone });
  return { latitude, longitude, timeZone: zone };
}

export class CompanyWeather {
  private cached: WeatherReading;
  private nextFetchAt = -Infinity;
  private pending?: Promise<WeatherReading>;

  constructor(
    location: WeatherLocation,
    private readonly request: typeof fetch = fetch,
    private readonly clock = Date.now,
  ) {
    this.cached = { location, current: null, at: null, stale: true };
  }

  setLocation(location: WeatherLocation): void {
    const before = this.cached.location;
    if (
      before.latitude === location.latitude &&
      before.longitude === location.longitude &&
      before.timeZone === location.timeZone
    )
      return;
    this.cached = { location, current: null, at: null, stale: true };
    this.nextFetchAt = -Infinity;
    this.pending = undefined;
  }

  read(): Promise<WeatherReading> {
    if (this.pending) return this.pending;
    if (this.clock() < this.nextFetchAt) return Promise.resolve(this.cached);
    this.pending = this.refresh();
    return this.pending;
  }

  private async refresh(): Promise<WeatherReading> {
    const { location } = this.cached;
    try {
      const response = await this.request(forecastUrl(location), {
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) throw new Error("Weather service unavailable");
      const current = readForecast(await response.json());
      if (this.cached.location !== location) return this.read();
      const at = this.clock();
      this.cached = { ...this.cached, current, at, stale: false };
      this.nextFetchAt = at + WEATHER_CACHE_MS;
    } catch {
      if (this.cached.location !== location) return this.read();
      this.cached = { ...this.cached, stale: true };
      this.nextFetchAt = this.clock() + 60_000;
    } finally {
      if (this.cached.location === location) this.pending = undefined;
    }
    return this.cached;
  }
}
