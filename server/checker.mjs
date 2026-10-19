// The advisory integrity checker: the safety net under the
// deterministic templates. Every generated advisory is checked before
// it is served: every price-plus-hour pair in the model's narrative
// is verified against the day's actual curve (the low and the peak,
// each with its own hour, and any price figure stated for those hours
// within the rounding tolerance), and every battery-state claim is
// verified against the context battery values. A mismatch rejects
// the advisory - the caller regenerates once and then serves the
// deterministic core facts alone; a mismatched advisory is never
// served. The comparison constants live here and nowhere else; no
// threshold from another module is reused for this purpose.

// Price figures must match the curve at the rounding tolerance of the
// served display precision: half a cent, so EUR 0.19 verifies
// against 0.19 and 0.194, never against 0.20.
export const PRICE_TOLERANCE_EUR = 0.005;
// Raw float subtraction can sit a hair past an exact boundary
// (0.195 - 0.19 reads as 0.005000000000000004), so the tolerance
// comparison carries a float guard - the same boundary problem the
// guidance gate solves by rounding first.
const FLOAT_GUARD = 1e-9;

// The throttled-warning interval, in the live module's style: a long
// run of rejections stays visible without flooding the terminal -
// one warning per reason per interval.
const CHECKER_WARN_INTERVAL_MS = 60_000;
const lastWarnAt = new Map(); // reason -> ms of the last throttled warning

// The grounding facts the claims are verified against: the lowPrice,
// peakPrice and battery objects from buildFacts (server/context.mjs),
// which carry the curve's actual low and peak and the context battery
// values verbatim. Any of them may be null - a claim against missing
// data is a mismatch, never a guess.

// "2:00" and "02:00" name the same hour; the facts carry zero-padded
// local hour labels.
function normalizeHour(hour) {
  const [hh, mm] = hour.split(":");
  return `${hh.padStart(2, "0")}:${mm}`;
}

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// Legitimate hours and figures are masked before claim extraction so
// they are never mistaken for price or battery claims: the window
// ranges ("between 12:00 and 15:00", "12:00-15:00") are the
// server-selected candidate window, and a saving ("to save EUR
// 0.16") is a difference, never the price at an hour.
function maskNonClaims(sentence) {
  return sentence
    .replace(
      /\b(?:between|from)\s+\d{1,2}:\d{2}\s+(?:and|to|-)\s+\d{1,2}:\d{2}/gi,
      "range"
    )
    .replace(/\b\d{1,2}:\d{2}\s*(?:-|to|until)\s*\d{1,2}:\d{2}/gi, "range")
    .replace(
      /\bsav(?:e|es|ing|ings)\b[^.;!?]{0,20}?(?:EUR|€)\s*[\d.]+/gi,
      "saving"
    );
}

// An hour the narrative names as the day's lowest or cheapest, either
// order: "lowest price around 02:00" / "02:00 is the cheapest hour".
const LOW_AFTER =
  /(?:lowest|cheapest)\s+(?:price|hours?)\b[^.;!?]{0,40}?(\d{1,2}:\d{2})/gi;
const LOW_BEFORE =
  /(\d{1,2}:\d{2})[^.;!?\d]{0,15}(?:lowest|cheapest)\s+(?:price|hours?)/gi;

// An hour the narrative names as the day's peak, either order:
// "peak around 08:00" / "the 08:00 peak".
const PEAK_AFTER = /\bpeak(?:s|ed|ing)?\b[^.;!?]{0,40}?(\d{1,2}:\d{2})/gi;
const PEAK_BEFORE =
  /(\d{1,2}:\d{2})[^.;!?\d]{0,15}\bpeak(?:s|ed|ing)?\b/gi;

// An attributed price-plus-hour pair, either order and always with a
// currency marker - a bare figure is never read as a price claim, so
// kWh loads and savings can never trip the checker: "02:00 (EUR
// 0.19)", "02:00 at EUR 0.19", "the 08:00 peak at EUR 0.51", "EUR
// 0.19 at 02:00", "EUR 0.19/kWh around 02:00".
const PAIR_HOUR_FIRST =
  /(\d{1,2}:\d{2})[^.;!?\d]{0,20}?(?:EUR|€)\s*([\d.]+)/gi;
const PAIR_PRICE_FIRST =
  /(?:EUR|€)\s*([\d.]+)(?:\s*\/\s*kWh)?\s*(?:at|around)\s*(\d{1,2}:\d{2})/gi;

// Battery-state claims in a sentence that names the battery: a stated
// SOC percentage, a charging/discharging/idle state word, and the
// full/empty SOC extremes.
const BATTERY_WORD = /batter/i;
const SOC_CLAIM = /(\d{1,3}(?:\.\d+)?)\s?(?:%|percent\b|pct\b)/i;

function batteryStateClaims(sentence) {
  const claims = [];
  if (/\bdischarg(?:e|es|ed|ing)\b/i.test(sentence)) {
    claims.push({ kind: "state", state: "discharging" });
  }
  if (/\b(?:fully\s+charged?|full)\b/i.test(sentence)) {
    claims.push({ kind: "soc", soc: 100 });
  } else if (/\b(?:charging|charged)\b/i.test(sentence)) {
    claims.push({ kind: "state", state: "charging" });
  }
  if (/\bidle\b/i.test(sentence)) {
    claims.push({ kind: "state", state: "idle" });
  }
  if (/\bempty\b/i.test(sentence)) {
    claims.push({ kind: "soc", soc: 0 });
  }
  return claims;
}

function hoursOf(text, pattern) {
  const hours = [];
  for (const match of text.matchAll(pattern)) {
    hours.push(normalizeHour(match[1]));
  }
  return hours;
}

function pairsOf(text) {
  const pairs = [];
  for (const match of text.matchAll(PAIR_HOUR_FIRST)) {
    pairs.push({
      hour: normalizeHour(match[1]),
      price: Number(match[2]),
      raw: match[2],
    });
  }
  for (const match of text.matchAll(PAIR_PRICE_FIRST)) {
    pairs.push({
      hour: normalizeHour(match[2]),
      price: Number(match[1]),
      raw: match[1],
    });
  }
  return pairs;
}

// Verifies the model's narrative fields against the grounding facts.
// fields is a map of field name to text (what, when, warning,
// contextNote - nulls and empty strings are skipped); facts is the
// buildFacts result (lowPrice, peakPrice, battery), possibly null
// parts. Returns a verdict: ok, the first failing reason, all
// problems and the count of verified price and battery claims - so
// the accept log can state what was actually checked.
export function checkAdvisory(fields, facts) {
  const low = facts?.lowPrice ?? null;
  const peak = facts?.peakPrice ?? null;
  const battery = facts?.battery ?? null;
  const problems = [];
  let priceClaims = 0;
  let batteryClaims = 0;

  const fail = (reason) => {
    if (!problems.includes(reason)) {
      problems.push(reason);
    }
  };

  for (const [field, raw] of Object.entries(fields ?? {})) {
    if (typeof raw !== "string" || raw.trim() === "") {
      continue;
    }
    for (const sentence of splitSentences(raw)) {
      const masked = maskNonClaims(sentence);

      for (const hour of hoursOf(masked, LOW_AFTER).concat(
        hoursOf(masked, LOW_BEFORE)
      )) {
        if (low === null) {
          fail(`${field}: lowest price named at ${hour} but the day has no price curve`);
        } else if (hour !== low.timestamp) {
          fail(`${field}: lowest price named at ${hour} but the day's low is at ${low.timestamp}`);
        } else {
          priceClaims += 1;
        }
      }

      for (const hour of hoursOf(masked, PEAK_AFTER).concat(
        hoursOf(masked, PEAK_BEFORE)
      )) {
        if (peak === null) {
          fail(`${field}: peak named at ${hour} but the day has no price curve`);
        } else if (hour !== peak.timestamp) {
          fail(`${field}: peak named at ${hour} but the day's peak is at ${peak.timestamp}`);
        } else {
          priceClaims += 1;
        }
      }

      // A price figure stated for an hour must match the curve at
      // that hour: the low and the peak are the curve points the
      // context carries, so a pair naming any other hour - or any
      // other price at those hours - matches nothing on the curve.
      for (const pair of pairsOf(masked)) {
        const at = (point) => {
          if (
            Math.abs(pair.price - point.price) <=
            PRICE_TOLERANCE_EUR + FLOAT_GUARD
          ) {
            priceClaims += 1;
          } else {
            fail(
              `${field}: price EUR ${pair.raw} stated for ${pair.hour} does not match the curve (EUR ${point.price.toFixed(2)})`
            );
          }
        };
        if (low !== null && pair.hour === low.timestamp) {
          at(low);
        } else if (peak !== null && pair.hour === peak.timestamp) {
          at(peak);
        } else {
          fail(
            `${field}: price EUR ${pair.raw} stated for ${pair.hour} matches no point on the day's curve`
          );
        }
      }

      if (BATTERY_WORD.test(masked)) {
        const soc = SOC_CLAIM.exec(masked);
        if (soc !== null) {
          const claimed = Number(soc[1]);
          if (battery === null) {
            fail(`${field}: battery SOC of ${soc[1]}% claimed but the context has no battery data`);
          } else if (claimed !== battery.soc_pct) {
            fail(`${field}: battery SOC claimed at ${soc[1]}% but the context says ${battery.soc_pct}%`);
          } else {
            batteryClaims += 1;
          }
        }
        for (const claim of batteryStateClaims(masked)) {
          if (claim.kind === "soc") {
            if (battery === null) {
              fail(`${field}: battery SOC of ${claim.soc}% claimed but the context has no battery data`);
            } else if (claim.soc !== battery.soc_pct) {
              fail(`${field}: battery SOC claimed at ${claim.soc}% but the context says ${battery.soc_pct}%`);
            } else {
              batteryClaims += 1;
            }
          } else if (battery === null) {
            fail(`${field}: battery state "${claim.state}" claimed but the context has no battery data`);
          } else if (claim.state !== battery.state) {
            fail(`${field}: battery state "${claim.state}" claimed but the context says "${battery.state}"`);
          } else {
            batteryClaims += 1;
          }
        }
      }
    }
  }

  return {
    ok: problems.length === 0,
    reason: problems[0] ?? null,
    problems,
    priceClaims,
    batteryClaims,
  };
}

// Resets the throttled-warning state; exported so the test suite can
// exercise the throttle deterministically.
export function resetCheckerWarnState() {
  lastWarnAt.clear();
}

// Logs the checker verdict: every accept once per generation, and a
// reject as a throttled warning in the live module's style - visible
// in the terminal, never a flood.
export function logCheckerVerdict(verdict) {
  if (verdict.ok) {
    console.log(
      `[advisory-checker] accept: ${verdict.priceClaims} price and ` +
        `${verdict.batteryClaims} battery claims verified`
    );
    return;
  }
  const now = Date.now();
  if (now - (lastWarnAt.get(verdict.reason) ?? 0) < CHECKER_WARN_INTERVAL_MS) {
    return;
  }
  lastWarnAt.set(verdict.reason, now);
  console.warn(`[advisory-checker] reject: ${verdict.reason}`);
}
