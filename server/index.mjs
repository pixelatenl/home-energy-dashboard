import "dotenv/config";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { shutdown } from "./db.mjs";
import {
  getBatteryContext,
  getPriceContext,
  getSummaryInsight,
  getWeatherContext,
  topProductionHours,
} from "./ai.mjs";
import {
  getCheapestBlock,
  getPriceContextData,
  getPriceSummary,
} from "./prices.mjs";
import {
  WeatherUpstreamError,
  weatherHourly,
} from "./weather.mjs";
import { dailyForecast } from "./solar.mjs";
import {
  currentMeasurements,
  dailyTotals,
  getSummary,
  hourlySeries,
  hourlyTotals,
  listEntities,
} from "./queries.mjs";
import { localDateKey } from "./time.mjs";

// Dedicated port for the API server, distinct from the Vite dev server
// (5173) so the two never race for the same port regardless of start order.
const DEFAULT_PORT = Number(process.env.API_PORT ?? 5273);
const MAX_PORT = DEFAULT_PORT + 10;

// Build identifier set at server start: the short git hash of the checkout
// plus the process start time. The debug panel shows it so a stale process
// (started before the latest code changes) is recognizable on screen.
const SERVER_START = new Date().toISOString();
let gitHash = "unknown";
try {
  gitHash = execSync("git rev-parse --short HEAD", {
    cwd: import.meta.dirname,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  gitHash = "unknown";
}
const SERVER_VERSION = `${gitHash} @ ${SERVER_START}`;

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Minimal CORS for the Vite dev server (any localhost origin), so the
// frontend can also call the API directly instead of only via the proxy.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Parse a positive integer query parameter with a default and an upper bound.
function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res)).catch(next);
};

app.get(
  "/api/entities",
  asyncHandler(async (_req, res) => {
    res.json(await listEntities());
  })
);

app.get(
  "/api/totals/daily",
  asyncHandler(async (req, res) => {
    const days = positiveInt(req.query.days, 7, 365);
    res.json(await dailyTotals(days));
  })
);

app.get(
  "/api/totals/hourly",
  asyncHandler(async (req, res) => {
    const hours = positiveInt(req.query.hours, 24, 24 * 31);
    res.json(await hourlyTotals(hours));
  })
);

app.get(
  "/api/series/hourly",
  asyncHandler(async (req, res) => {
    const hours = positiveInt(req.query.hours, 24, 24 * 31);
    res.json(await hourlySeries(hours));
  })
);

app.get(
  "/api/current",
  asyncHandler(async (_req, res) => {
    res.json(await currentMeasurements());
  })
);

app.get(
  "/api/prices",
  asyncHandler(async (req, res) => {
    let days = 2;
    if (req.query.days !== undefined) {
      const raw = req.query.days;
      const parsed =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
        return res
          .status(400)
          .json({ error: "days must be an integer between 1 and 7" });
      }
      days = parsed;
    }
    res.json(await getPriceSummary(days));
  })
);

app.get(
  "/api/prices/cheapest",
  asyncHandler(async (req, res) => {
    let hours = 3;
    if (req.query.hours !== undefined) {
      const raw = req.query.hours;
      const parsed =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
        return res
          .status(400)
          .json({ error: "hours must be an integer between 1 and 12" });
      }
      hours = parsed;
    }
    res.json(await getCheapestBlock(hours));
  })
);

app.get(
  "/api/prices/context",
  asyncHandler(async (_req, res) => {
    const { priceData, cheapestBlock } = await getPriceContextData();
    // Optional solar summary from the weather module; omitted when the
    // weather data is unavailable rather than failing the request.
    let solarDaily = null;
    try {
      const daily = await dailyForecast(5);
      const todayKey = localDateKey(new Date());
      const todayEntry = daily.find((day) => day.date === todayKey) ?? null;
      const hourlyResult = await weatherHourly(todayKey);
      if (todayEntry && hourlyResult?.hours?.length) {
        solarDaily = {
          estimated_kwh: todayEntry.estimated_kwh,
          top_production_hours: topProductionHours(hourlyResult.hours),
        };
      }
    } catch {
      solarDaily = null;
    }
    const result = await getPriceContext(priceData, cheapestBlock, solarDaily);
    res.json({
      text: result.text,
      generated_at: result.generatedAt,
      error: result.error,
    });
  })
);

app.get(
  "/api/summary",
  asyncHandler(async (_req, res) => {
    res.json({ ...(await getSummary()), server_version: SERVER_VERSION });
  })
);

app.get(
  "/api/insight/daily",
  asyncHandler(async (req, res) => {
    // force regenerates once regardless of the context signature.
    const force = req.query.force === "1" || req.query.force === "true";
    const summary = await getSummary();
    // Optional sources; omitted from the context when unavailable.
    let daily = null;
    try {
      daily = await dailyForecast(5);
    } catch {
      daily = null;
    }
    let priceParts = null;
    try {
      priceParts = await getPriceContextData();
    } catch {
      priceParts = null;
    }
    const result = await getSummaryInsight(summary, daily, priceParts, {
      force,
    });
    res.json({
      one_liner: result.oneLiner,
      summary: result.summary,
      actions: result.actions,
      generated_at: result.generatedAt,
      as_of: result.asOf,
      stale: result.stale,
      error: result.error,
    });
  })
);

app.get(
  "/api/battery/context",
  asyncHandler(async (_req, res) => {
    const summary = await getSummary();
    // Optional solar forecast and price context; omitted when the source
    // is unavailable rather than failing the request.
    let daily = null;
    try {
      daily = await dailyForecast(5);
    } catch {
      daily = null;
    }
    let priceParts = null;
    try {
      priceParts = await getPriceContextData();
    } catch {
      priceParts = null;
    }
    const result = await getBatteryContext(summary, daily, priceParts);
    res.json({
      text: result.text,
      generated_at: result.generatedAt,
      error: result.error,
    });
  })
);

app.get(
  "/api/weather/daily",
  asyncHandler(async (req, res) => {
    let days = 5;
    if (req.query.days !== undefined) {
      const raw = req.query.days;
      const parsed =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
        return res
          .status(400)
          .json({ error: "days must be an integer between 1 and 6" });
      }
      days = parsed;
    }
    res.json(await dailyForecast(days));
  })
);

app.get(
  "/api/weather/hourly",
  asyncHandler(async (req, res) => {
    const raw = req.query.date;
    const date = raw === undefined ? localDateKey(new Date()) : raw;
    if (typeof date !== "string" || !isValidIsoDate(date)) {
      return res
        .status(400)
        .json({ error: "date must be a valid YYYY-MM-DD value" });
    }
    const rows = await weatherHourly(date);
    if (rows === null) {
      return res
        .status(400)
        .json({ error: `no forecast data available for ${date}` });
    }
    res.json(rows);
  })
);

app.get(
  "/api/weather/context",
  asyncHandler(async (_req, res) => {
    const daily = await dailyForecast(5);
    const hourlyResult =
      (await weatherHourly(localDateKey(new Date()))) ??
      { current: null, hours: [] };
    const result = await getWeatherContext(daily, hourlyResult);
    res.json({
      text: result.text,
      generated_at: result.generatedAt,
      error: result.error,
    });
  })
);

// Serve the production build of the frontend. Express matches in
// registration order, so this must come before the catch-all 404 handler
// below, which would otherwise intercept every page request.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

app.use(express.static(distDir));

// SPA fallback: any non-API GET request returns index.html, so client-side
// routing keeps working on refresh.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  if (err instanceof WeatherUpstreamError) {
    res.status(502).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Bind to the network instead of localhost only; the dashboard is meant
// to be reachable from other devices on the home network. Not reachable
// from the internet as long as the router does not forward the port.
const HOST = process.env.HOST ?? "0.0.0.0";

function listen(port) {
  const server = app.listen(port, HOST, () => {
    console.log(`API server listening on http://${HOST}:${port}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && port < MAX_PORT) {
      console.warn(`Port ${port} in use, trying ${port + 1}`);
      listen(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

// Development keeps the default 5273 via API_PORT; production overrides
// the start port via PORT (see deploy/ems-dashboard.service).
listen(Number(process.env.PORT ?? DEFAULT_PORT));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}
