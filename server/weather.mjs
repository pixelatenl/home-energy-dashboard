// Weather forecast from Open-Meteo (free, no API key) with an in-memory
// cache, plus a PV yield estimate and a solar score defined as the share of
// the theoretical clear-sky production on the best day of the year. No SQL
// lives here; this module only talks to the upstream API and transforms its
// response.

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// Below this much annual reference production the score has no usable
// reference (location not configured); the score is 0.
const SCORE_REFERENCE_EPSILON_KWH = 0.01;

// PV array size (kWp) and performance ratio used for the estimated PV
// yield. These are initial calibration values derived from measured
// production (about 15 kWh on a good October day); a later calibration
// step will compare the estimates against the actual daily yield.
const PV_ARRAY_KWP = 8.16;
const PV_PERFORMANCE_RATIO = 0.6;

const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "sunrise",
  "sunset",
  "shortwave_radiation_sum",
].join(",");
const HOURLY_FIELDS = [
  "temperature_2m",
  "weather_code",
  "cloud_cover",
  "precipitation_probability",
  "shortwave_radiation",
  "is_day",
].join(",");
// Present conditions from the "current" analysis of the generic endpoint.
const CURRENT_FIELDS = ["temperature_2m", "weather_code", "cloud_cover"].join(
  ","
);
// KNMI HARMONIE AROME: 2 km inset for the Netherlands, continued by the
// Europe model via the models parameter on the same endpoint. Empirically
// it supplies all five override variables for the full 6-day horizon; the
// merge handles shorter horizons and missing variables gracefully.
const KNMI_MODEL = "knmi_seamless";
const KNMI_OVERRIDE_FIELDS = [
  "temperature_2m",
  "weather_code",
  "cloud_cover",
  "precipitation_probability",
  "shortwave_radiation",
];

// Raised when Open-Meteo cannot be reached or returns a bad response and no
// cached forecast is available. The HTTP layer maps this to a 502.
export class WeatherUpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = "WeatherUpstreamError";
  }
}

let cache = null; // { fetchedAt: number, forecast: object }

async function fetchModel(params) {
  let response;
  try {
    response = await fetch(`${OPEN_METEO_URL}?${new URLSearchParams(params)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new WeatherUpstreamError(`Open-Meteo request failed: ${err.message}`);
  }
  if (!response.ok) {
    throw new WeatherUpstreamError(
      `Open-Meteo returned HTTP ${response.status}`
    );
  }
  try {
    return await response.json();
  } catch (err) {
    throw new WeatherUpstreamError(
      `Open-Meteo returned invalid JSON: ${err.message}`
    );
  }
}

function fetchGeneric(latitude, longitude) {
  return fetchModel({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: "Europe/Amsterdam",
    forecast_days: "6",
    daily: DAILY_FIELDS,
    hourly: HOURLY_FIELDS,
    current: CURRENT_FIELDS,
  });
}

function fetchKnmi(latitude, longitude) {
  return fetchModel({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: "Europe/Amsterdam",
    forecast_days: "6",
    hourly: KNMI_OVERRIDE_FIELDS.join(","),
    models: KNMI_MODEL,
  });
}

// Merges the KNMI model into the generic blended forecast: within the KNMI
// horizon the override fields replace the generic hourly values; hours
// beyond the horizon and variables missing from the KNMI response keep the
// generic values. Both models use the same timezone, so hour timestamps
// align.
function mergeForecasts(generic, knmi) {
  const knmiHourly = knmi?.hourly;
  if (!Array.isArray(knmiHourly?.time) || knmiHourly.time.length === 0) {
    return { ...generic, knmiAvailable: false };
  }
  const knmiIndexByTime = new Map();
  knmiHourly.time.forEach((time, index) => knmiIndexByTime.set(time, index));
  const hourly = {};
  for (const [field, values] of Object.entries(generic.hourly)) {
    hourly[field] = Array.isArray(values) ? [...values] : values;
  }
  for (let i = 0; i < hourly.time.length; i++) {
    const knmiIndex = knmiIndexByTime.get(hourly.time[i]);
    if (knmiIndex === undefined) {
      continue; // beyond the KNMI horizon
    }
    for (const field of KNMI_OVERRIDE_FIELDS) {
      const value = knmiHourly[field]?.[knmiIndex];
      if (value !== undefined && value !== null) {
        if (!Array.isArray(hourly[field])) {
          hourly[field] = new Array(hourly.time.length).fill(null);
        }
        hourly[field][i] = value;
      }
    }
  }
  return { ...generic, hourly, knmiAvailable: true };
}

// Returns the cached forecast while it is fresh; refreshes it otherwise.
// The generic and KNMI models share one cache entry and are fetched in
// parallel; a KNMI failure degrades to the generic forecast. If the
// refresh fails, the stale cache is served; with no cache at all the
// WeatherUpstreamError propagates (rendered as a 502 by the HTTP layer).
export async function fetchWeatherForecast() {
  const latitude = Number.parseFloat(process.env.EMS_LAT);
  const longitude = Number.parseFloat(process.env.EMS_LON);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Weather location not configured (EMS_LAT/EMS_LON)");
  }
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.forecast;
  }
  const [genericResult, knmiResult] = await Promise.allSettled([
    fetchGeneric(latitude, longitude),
    fetchKnmi(latitude, longitude),
  ]);
  if (genericResult.status === "rejected") {
    if (cache) {
      console.warn(
        `Weather refresh failed, serving stale cache: ${genericResult.reason?.message}`
      );
      return cache.forecast;
    }
    throw genericResult.reason;
  }
  if (knmiResult.status === "rejected") {
    console.warn(
      `KNMI model unavailable, using the generic forecast only: ${knmiResult.reason?.message}`
    );
  }
  const forecast = mergeForecasts(
    genericResult.value,
    knmiResult.status === "fulfilled" ? knmiResult.value : null
  );
  cache = { fetchedAt: Date.now(), forecast };
  return forecast;
}

// Estimated PV energy for one hour of radiation (W/m2), in Wh:
// kWp * (G / 1000 W/m2) * performance ratio * 1 hour.
function estimatedPvWh(radiation) {
  return radiation * PV_ARRAY_KWP * PV_PERFORMANCE_RATIO;
}

// --- Solar position and clear-sky model (standard formulas, no dependency) ---

// Solar elevation in degrees for a UTC timestamp (milliseconds), using the
// standard NOAA general solar position calculations: fractional year,
// equation of time, solar declination and hour angle.
function solarElevation(latitude, longitude, utcMs) {
  const date = new Date(utcMs);
  const yearStartMs = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((utcMs - yearStartMs) / 86_400_000) + 1;
  const hourFraction =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma =
    ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourFraction - 12) / 24);
  const equationOfTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma); // radians
  const trueSolarTimeMinutes =
    hourFraction * 60 + equationOfTimeMinutes + 4 * longitude;
  const hourAngleDegrees = trueSolarTimeMinutes / 4 - 180;
  const latitudeRad = (latitude * Math.PI) / 180;
  const cosZenith =
    Math.sin(latitudeRad) * Math.sin(declination) +
    Math.cos(latitudeRad) *
      Math.cos(declination) *
      Math.cos((hourAngleDegrees * Math.PI) / 180);
  const clamped = Math.min(1, Math.max(-1, cosZenith));
  return 90 - (Math.acos(clamped) * 180) / Math.PI;
}

// Clear-sky global horizontal irradiance in W/m2, using the standard
// Haurwitz (1945) formulation: 1098 * sin(elevation) * exp(-0.057 / sin(elevation)).
// Chosen because it stays physically bounded (below extraterrestrial
// radiation, unlike cruder solar-constant power laws) while matching
// observed clear-sky values closely enough for a relative daily score.
function clearSkyIrradiance(elevationDegrees) {
  if (elevationDegrees <= 0) {
    return 0;
  }
  const sinElevation = Math.sin((elevationDegrees * Math.PI) / 180);
  return 1098 * sinElevation * Math.exp(-0.057 / sinElevation);
}

// Theoretical clear-sky PV production for one calendar day at the given
// location, using the same scaling path as the daily estimate. Hour steps
// are local Europe/Amsterdam; utcOffsetHours is the UTC offset of that
// date (June 21 falls in CEST, UTC+2).
function clearSkyDayKwh(
  year,
  monthIndex,
  day,
  utcOffsetHours,
  latitude,
  longitude
) {
  let kwh = 0;
  for (let hour = 0; hour < 24; hour++) {
    const hourMidpointUtcMs =
      Date.UTC(year, monthIndex, day, hour, 30) -
      utcOffsetHours * 3_600_000;
    const elevation = solarElevation(latitude, longitude, hourMidpointUtcMs);
    if (elevation > 0) {
      kwh += estimatedPvWh(clearSkyIrradiance(elevation)) / 1000;
    }
  }
  return kwh;
}

// Absolute annual reference for the score: the theoretical clear-sky
// production on the summer solstice (June 21) at the configured location,
// computed once at server start with the same scaling path, capacity and
// performance ratio as the daily estimate. Exported for verification.
export const ANNUAL_PEAK_KWH = (() => {
  const latitude = Number.parseFloat(process.env.EMS_LAT);
  const longitude = Number.parseFloat(process.env.EMS_LON);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return 0;
  }
  return clearSkyDayKwh(
    new Date().getUTCFullYear(),
    5, // June (0-based month index)
    21,
    2, // CEST
    latitude,
    longitude
  );
})();

// Per-day solar score (0-100): the expected PV production of the day as a
// percentage of the theoretical clear-sky production on the best day of
// the year (ANNUAL_PEAK_KWH). The score reflects absolute production
// potential: a sunny July day scores near 100, a good October day near 35.
export function computeSolarScore(forecast) {
  const hourly = forecast.hourly;
  const days = new Map(); // date -> raw kWh sum
  for (let i = 0; i < hourly.time.length; i++) {
    const date = hourly.time[i].slice(0, 10);
    const radiation = hourly.shortwave_radiation[i] ?? 0;
    days.set(date, (days.get(date) ?? 0) + estimatedPvWh(radiation) / 1000);
  }
  const scores = new Map(); // date -> { solarScore, estimatedKwh }
  for (const [date, kwh] of days) {
    const estimatedKwh = Math.round(kwh * 100) / 100;
    // Guard: a missing estimate or an unusable annual reference scores 0,
    // never NaN or null.
    const solarScore =
      !Number.isFinite(kwh) ||
      !Number.isFinite(ANNUAL_PEAK_KWH) ||
      ANNUAL_PEAK_KWH < SCORE_REFERENCE_EPSILON_KWH
        ? 0
        : Math.min(
            100,
            Math.max(0, Math.round((100 * kwh) / ANNUAL_PEAK_KWH))
          );
    scores.set(date, { solarScore, estimatedKwh });
  }
  return scores;
}

// GET /api/weather/daily rows: N days starting today.
export async function weatherDaily(days) {
  const forecast = await fetchWeatherForecast();
  const scores = computeSolarScore(forecast);
  const daily = forecast.daily;
  const rows = [];
  for (let i = 0; i < days && i < daily.time.length; i++) {
    const date = daily.time[i];
    const score = scores.get(date) ?? { solarScore: 0, estimatedKwh: 0 };
    rows.push({
      date,
      weather_code: daily.weather_code[i],
      temp_min: daily.temperature_2m_min[i],
      temp_max: daily.temperature_2m_max[i],
      solar_score: score.solarScore,
      estimated_kwh: score.estimatedKwh,
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
    });
  }
  return rows;
}

// GET /api/weather/hourly response: the hours for one date plus the
// "current" analysis from Open-Meteo. Returns null when the date is
// outside the available forecast range.
export async function weatherHourly(date) {
  const forecast = await fetchWeatherForecast();
  const hourly = forecast.hourly;
  const current = forecast.current
    ? {
        temperature: forecast.current.temperature_2m ?? null,
        weather_code: forecast.current.weather_code ?? null,
        cloud_cover: forecast.current.cloud_cover ?? null,
      }
    : null;
  const rows = [];
  let found = false;
  for (let i = 0; i < hourly.time.length; i++) {
    if (hourly.time[i].slice(0, 10) !== date) {
      continue;
    }
    found = true;
    rows.push({
      hour: hourly.time[i],
      temperature: hourly.temperature_2m[i] ?? 0,
      weather_code: hourly.weather_code[i] ?? 0,
      cloud_cover: hourly.cloud_cover[i] ?? 0,
      precipitation_probability: hourly.precipitation_probability[i] ?? 0,
      estimated_pv_wh: Math.round(estimatedPvWh(hourly.shortwave_radiation[i] ?? 0)),
    });
  }
  return found ? { current, hours: rows } : null;
}
