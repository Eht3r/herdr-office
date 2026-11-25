import { expect, it, vi } from "vitest";
import {
  CompanyWeather,
  companyWeatherLocation,
  WEATHER_CACHE_MS,
} from "./weather.ts";

it("coalesces requests, caches observations for ten minutes and serves stale data on error", async () => {
  let clock = 0;
  const data = {
    current: {
      weather_code: 61,
      temperature_2m: 12,
      cloud_cover: 80,
      precipitation: 0.5,
      snowfall: 0,
    },
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(data))
    .mockRejectedValueOnce(new Error("offline"));
  const location = companyWeatherLocation(undefined, undefined);
  const weather = new CompanyWeather(location, fetcher, () => clock);
  const [a, b] = await Promise.all([weather.read(), weather.read()]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({
    location: { timeZone: "Asia/Seoul" },
    stale: false,
    current: { code: 61 },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = fetcher.mock.calls[0][0] as URL;
  expect(url.hostname).toBe("api.open-meteo.com");
  expect(url.searchParams.get("current")).toContain("weather_code");
  clock = WEATHER_CACHE_MS - 1;
  expect(await weather.read()).toBe(a);
  expect(fetcher).toHaveBeenCalledTimes(1);
  clock++;
  expect(await weather.read()).toMatchObject({
    stale: true,
    current: { code: 61 },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("accepts configured company coordinates and rejects invalid locations", () => {
  expect(companyWeatherLocation("40.7", "-74.0", "America/New_York")).toEqual({
    latitude: 40.7,
    longitude: -74,
    timeZone: "America/New_York",
  });
  expect(() => companyWeatherLocation("91", "0")).toThrow(RangeError);
});
