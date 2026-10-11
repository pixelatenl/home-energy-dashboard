// Daily forecast enrichment and persistence. The forecast itself comes from
// weather.mjs; this layer adds today's actual production and writes today's
// forecast value into solar_forecast_daily so forecast history accumulates
// for the future solar page. All SQL stays in queries.mjs.

import { getPvTodayKwh, upsertSolarForecastDaily } from "./queries.mjs";
import { localDateKey } from "./time.mjs";
import { weatherDaily } from "./weather.mjs";

// Upsert dedupe: the forecast value only changes when the 30-minute weather
// cache refreshes, so writes happen when the value actually changes (plus
// once after each server start).
let lastUpsert = null; // { date, kwh }

// The daily forecast rows, with today's row carrying actual_today_kwh: the
// PV energy counter's energy_delta sum for today, null before any
// production today. Database failures must never break the forecast.
export async function dailyForecast(days) {
  const rows = await weatherDaily(days);
  const todayKey = localDateKey(new Date());
  const todayRow = rows.find((row) => row.date === todayKey) ?? null;
  if (todayRow) {
    try {
      todayRow.actual_today_kwh = await getPvTodayKwh();
    } catch {
      todayRow.actual_today_kwh = null;
    }
    const kwh = todayRow.estimated_kwh;
    if (
      lastUpsert === null ||
      lastUpsert.date !== todayKey ||
      lastUpsert.kwh !== kwh
    ) {
      try {
        await upsertSolarForecastDaily(todayKey, kwh);
        lastUpsert = { date: todayKey, kwh };
      } catch (err) {
        console.warn(`Could not persist the solar forecast: ${err.message}`);
      }
    }
  }
  return rows;
}
