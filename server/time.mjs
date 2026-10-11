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

// UTC milliseconds of local midnight for a "YYYY-MM-DD" date key, measured
// via the timezone offset at noon so DST transitions are handled.
export function localDayStartUtcMs(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const noon = Date.UTC(year, month - 1, day, 12);
  const parts = partsIn(new Date(noon), {
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
  const offsetMs = wallClockMs - noon;
  return Date.UTC(year, month - 1, day) - offsetMs;
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
