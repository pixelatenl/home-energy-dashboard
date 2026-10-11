// Europe/Amsterdam timezone helpers shared across the server modules. The
// forecast, prices and statistics all use local Amsterdam time.

const AMSTERDAM = "Europe/Amsterdam";

function partsIn(date, options) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AMSTERDAM,
    ...options,
  }).formatToParts(date);
}

function getPart(parts, type) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

// Local hour key "YYYY-MM-DDTHH" for a Date.
export function localHourKey(date) {
  const parts = partsIn(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(
    parts,
    "day"
  )}T${getPart(parts, "hour")}`;
}

// Local date key "YYYY-MM-DD" for a Date.
export function localDateKey(date) {
  const parts = partsIn(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(
    parts,
    "day"
  )}`;
}

// UTC milliseconds of local midnight for a "YYYY-MM-DD" date key. The
// timezone offset is probed at 00:30 UTC of the date: Amsterdam's DST
// transitions (always at 01:00/02:00 UTC) never fall between local
// midnight and that probe, so the offset matches the one in effect at
// local midnight on every day of the year, including both transition
// days. No configuration change is needed across a DST transition.
export function localDayStartUtcMs(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const early = Date.UTC(year, month - 1, day, 0, 30);
  const parts = partsIn(new Date(early), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const wallClockMs = Date.UTC(
    Number(getPart(parts, "year")),
    Number(getPart(parts, "month")) - 1,
    Number(getPart(parts, "day")),
    Number(getPart(parts, "hour")),
    Number(getPart(parts, "minute"))
  );
  const offsetMs = wallClockMs - early;
  return Date.UTC(year, month - 1, day) - offsetMs;
}

// Calendar-safe date key N days after another local date key. Unlike
// adding 24 hours to a Date, this is correct across DST transitions, where
// a local day is 23 or 25 hours long.
export function nextDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

// The local hour index (0-23) in Amsterdam.
export function localHourIndex(date) {
  return Number(localHourKey(date).slice(11, 13));
}

// The timezone the server process actually runs in (resolved by Intl,
// independent of the TZ variable).
export function resolvedTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Local ISO string including the Amsterdam offset, e.g.
// "2026-10-11T20:05:00+02:00", for diagnostics.
export function localIsoWithOffset(date) {
  const parts = partsIn(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wallClockMs = Date.UTC(
    Number(getPart(parts, "year")),
    Number(getPart(parts, "month")) - 1,
    Number(getPart(parts, "day")),
    Number(getPart(parts, "hour")),
    Number(getPart(parts, "minute")),
    Number(getPart(parts, "second"))
  );
  const offsetMinutes = Math.round((wallClockMs - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (value) => String(value).padStart(2, "0");
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(
    parts,
    "day"
  )}T${getPart(parts, "hour")}:${getPart(parts, "minute")}:${getPart(
    parts,
    "second"
  )}${offset}`;
}

// Date key of the Monday of the current local week.
export function mondayDateKey(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: AMSTERDAM,
    weekday: "short",
  }).format(now);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    weekday
  );
  const key = localDateKey(now);
  const [year, month, day] = key.split("-").map(Number);
  return localDateKey(
    new Date(Date.UTC(year, month - 1, day, 12) - index * 86_400_000)
  );
}

// Hour label "HH:00" for an ISO timestamp.
export function localHourLabel(iso) {
  return `${localHourKey(new Date(iso)).slice(11, 13)}:00`;
}
