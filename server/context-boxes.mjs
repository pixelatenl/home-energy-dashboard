// The context-box seam (contract section 11): one model call per widget
// id (usage_context, heat_context, solar_production), section-scoped
// prompts assembled from the single brief below, per-section guards with
// one retry then the deterministic fallback, per-widget caching over a
// bucketed signature plus the period and date anchor, a 30-minute floor,
// fail-soft stale serving, and the shared daily budget and journal from
// ai.mjs (force bypasses the interval, never the budget). The page facts
// come from context-box-facts.mjs; this module only formats, prompts,
// validates and caches. The model stub is a parameter, never a network
// call, so tests replay the whole seam.

import {
  callMistral,
  dailyLimitReached,
  eurFactText,
  hashString,
  logMistral,
  recordApiCall,
  shortError,
} from "./ai.mjs";
import {
  NIGHT_EXPORT_CAVEAT,
  ZONES_INFERENCE_NOTE,
} from "./context-box-facts.mjs";
import { validateContextBoxSection } from "./context-box-guards.mjs";

// At most one upstream call per 30 minutes per widget id; force bypasses
// this floor but never the shared daily cap.
const MIN_CALL_INTERVAL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// The single context-box brief document (contract section 11), embedded
// verbatim in every widget prompt. Self-contained: it carries no concrete
// figure, and each section's fact set is the only figure source.
// ---------------------------------------------------------------------------

export const CONTEXT_BOX_BRIEF =
  "You write the short insight boxes of a home energy dashboard in the Netherlands. You see one widget at a time, with its sections and their facts. Write 2 to 4 sentences per section, in plain household language, second person, interpretive voice. Every figure must be a verbatim copy of a served fact of that section, including the currency marker, the kWh or m3 unit, the percent sign and the time labels; never invent, compute, round or combine figures, and never state a difference or a total between amounts - place the served amounts side by side exactly as served. Energy figures are day or period totals, never live power; forecast figures are whole-period totals, never later or still to come. Describe the weather only when the section's facts carry a condition, and then only as that condition states it. Estimated figures must carry a hedging word (estimate, estimated, about); never hedge a measured figure as an estimate. Imperative sentences are banned: advice is declarative and comparative only, and only when the section's facts carry a verdict or opportunity field. Best-day claims only when the facts carry the marker. No flattery, no exclamation marks, no contractions, no internal vocabulary such as candidates, thresholds, payloads, signatures or budgets. English only. When a section's facts carry a served note, weave it word for word where it fits best.";

// Server-owned parity notes: appended verbatim to an accepted narrative
// that omits them, and carried by the fallback sentences.
export const SHORT_DAY_NOTE =
  "The day is not over yet; these figures are totals so far, not the full day.";
export const GAS_UNKNOWN_PRICE_NOTE =
  "The gas price for this period is not known yet, so no cost is shown.";

// ---------------------------------------------------------------------------
// Figure formatting: the served fact strings the model copies verbatim
// (figure-verbatim membership). Money reuses the one house format
// (eurFactText, euro sign flush); per-kWh-of-heat figures keep their
// sub-cent precision at up to four decimals.
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const kwhString = (v) => (isNum(v) ? `${v} kWh` : null);
const m3String = (v) => (isNum(v) ? `${v} m3` : null);
const pctString = (v) => (isNum(v) ? `${v}%` : null);
const numString = (v) => (isNum(v) ? `${v}` : null);
const eurString = (v) => (isNum(v) ? eurFactText(v) : null);
const eurPerKwhHeatString = (v) =>
  isNum(v)
    ? `€${v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`
    : null;
const compact = (list) => list.filter((entry) => entry !== null);

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// ---------------------------------------------------------------------------
// Section building: the page facts in, the section objects (pre-formatted
// fact strings, deterministic fallback sentences, parity notes, the
// logged-never-asserted sentence budget) out. A page fact section that is
// null (honest absence) yields no box section at all.
// ---------------------------------------------------------------------------

function baseFacts(pageFacts) {
  const facts = { day_status: pageFacts?.day_status ?? null };
  if (pageFacts?.so_far === true) {
    facts.short_day_note = SHORT_DAY_NOTE;
  }
  return facts;
}

function shortDayNotes(pageFacts) {
  return pageFacts?.so_far === true
    ? [{ required: SHORT_DAY_NOTE, append: SHORT_DAY_NOTE }]
    : [];
}

function usageSections(pageFacts) {
  const periodWord = pageFacts?.period ?? "period";
  const sections = [];

  const b = pageFacts?.breakdown ?? null;
  if (b !== null) {
    const facts = {
      ...baseFacts(pageFacts),
      total_kwh: kwhString(b.total_kwh),
      total_eur: eurString(b.total_eur),
      measured_share_pct: pctString(b.measured_share_pct),
      categories: b.categories.map((c) => ({
        name: c.name,
        kwh: kwhString(c.kwh),
        eur: eurString(c.eur),
        share_pct: pctString(c.share_pct),
        class: c.class,
      })),
      semantics: b.semantics ?? null,
    };
    const estimatedFigures = [];
    const measuredFigures = compact([
      kwhString(b.total_kwh),
      eurString(b.total_eur),
      pctString(b.measured_share_pct),
    ]);
    for (const c of b.categories) {
      const figures = compact([
        kwhString(c.kwh),
        eurString(c.eur),
        pctString(c.share_pct),
      ]);
      if (c.class === "estimated") {
        estimatedFigures.push(...figures);
      } else {
        measuredFigures.push(...figures);
      }
    }
    facts.estimated_figures = estimatedFigures;
    facts.measured_figures = measuredFigures;
    const fallbacks = [];
    const totalBit = compact([facts.total_kwh, facts.total_eur]).join(" for ");
    if (totalBit !== "") {
      fallbacks.push(
        pageFacts.so_far === true
          ? `So far this ${periodWord}, the home used ${totalBit}.`
          : `This ${periodWord}, the home used ${totalBit}.`
      );
    }
    const heatPump = b.categories.find((c) => c.class === "estimated");
    if (heatPump !== undefined && kwhString(heatPump.kwh) !== null) {
      fallbacks.push(
        `The heat pump accounts for an estimated ${kwhString(heatPump.kwh)} of that.`
      );
    }
    if (facts.measured_share_pct !== null) {
      fallbacks.push(
        `Measured appliances cover ${facts.measured_share_pct} of home usage.`
      );
    }
    if (fallbacks.length === 0) {
      fallbacks.push(`No usage data for this ${periodWord} yet.`);
    }
    sections.push({
      key: "breakdown",
      label: "Usage breakdown",
      facts,
      fallback_sentences: fallbacks,
      notes: shortDayNotes(pageFacts),
      budget: 4,
    });
  }

  const r = pageFacts?.rest_of_home ?? null;
  if (r !== null) {
    const entries = r.entries.map((e) => ({
      key: e.key,
      name: e.name,
      kwh: kwhString(e.kwh),
      eur: eurString(e.eur),
      class: e.class,
      basis: e.basis ?? null,
    }));
    const facts = {
      ...baseFacts(pageFacts),
      entries,
      unexplained_kwh: kwhString(r.unexplained_kwh),
      unexplained_eur: eurString(r.unexplained_eur),
      unexplained_framing: r.unexplained_framing ?? null,
      semantics: r.semantics ?? null,
    };
    const estimatedFigures = [];
    const measuredFigures = compact([
      kwhString(r.unexplained_kwh),
      eurString(r.unexplained_eur),
    ]);
    for (const e of entries) {
      if (e.class === "measured") {
        measuredFigures.push(...compact([e.kwh, e.eur]));
      } else {
        estimatedFigures.push(...compact([e.kwh, e.eur]));
      }
    }
    facts.estimated_figures = estimatedFigures;
    facts.measured_figures = measuredFigures;
    const parts = entries
      .filter((e) => e.kwh !== null)
      .map((e) => `${e.name.toLowerCase()} about ${e.kwh}`);
    const fallbacks = [];
    if (parts.length > 0 || facts.unexplained_kwh !== null) {
      const modeled = parts.length > 0 ? parts.join(" and ") : "nothing modeled";
      fallbacks.push(
        `Of the remaining usage, ${modeled}${
          facts.unexplained_kwh !== null
            ? `; ${facts.unexplained_kwh} is real usage of unnamed appliances, not an error.`
            : "."
        }`
      );
    } else {
      fallbacks.push(`Nothing left to explain for this ${periodWord}.`);
    }
    sections.push({
      key: "rest_of_home",
      label: "Rest of home",
      facts,
      fallback_sentences: fallbacks,
      notes: shortDayNotes(pageFacts),
      budget: 4,
    });
  }

  const o = pageFacts?.over_time ?? null;
  if (o !== null) {
    const peak = o.peak_slot ?? null;
    const priceStats = o.price_stats ?? null;
    const comparison = o.comparison ?? null;
    const facts = {
      ...baseFacts(pageFacts),
      unit: o.unit,
      slots: o.slots.map((s) => ({
        label: s.label,
        kwh: kwhString(s.kwh),
        eur: eurString(s.eur),
      })),
      peak_slot:
        peak !== null
          ? {
              label: peak.label,
              kwh: kwhString(peak.kwh),
              eur: eurString(peak.eur),
            }
          : null,
      most_expensive_hours_share_pct: pctString(o.most_expensive_hours_share_pct),
      price_stats:
        priceStats !== null
          ? {
              average_eur: eurString(priceStats.average_eur),
              min_eur: eurString(priceStats.min_eur),
              max_eur: eurString(priceStats.max_eur),
              peak_label: priceStats.peak_label ?? null,
            }
          : null,
      comparison:
        comparison !== null
          ? {
              previous_kwh: kwhString(comparison.previous_kwh),
              previous_eur: eurString(comparison.previous_eur),
            }
          : null,
      semantics: o.semantics ?? null,
    };
    const measuredFigures = [];
    for (const s of facts.slots) {
      measuredFigures.push(...compact([s.kwh, s.eur]));
    }
    if (facts.peak_slot !== null) {
      measuredFigures.push(
        ...compact([facts.peak_slot.kwh, facts.peak_slot.eur])
      );
    }
    measuredFigures.push(
      ...compact([
        facts.most_expensive_hours_share_pct,
        facts.price_stats?.average_eur ?? null,
        facts.price_stats?.min_eur ?? null,
        facts.price_stats?.max_eur ?? null,
        facts.comparison?.previous_kwh ?? null,
        facts.comparison?.previous_eur ?? null,
      ])
    );
    facts.measured_figures = measuredFigures;
    facts.estimated_figures = [];
    const fallbacks = [];
    if (facts.peak_slot !== null) {
      fallbacks.push(
        `The busiest slot is ${facts.peak_slot.label} with ${facts.peak_slot.kwh}.`
      );
    }
    if (facts.most_expensive_hours_share_pct !== null) {
      fallbacks.push(
        `The most expensive hours took ${facts.most_expensive_hours_share_pct} of the usage.`
      );
    }
    if (facts.price_stats !== null) {
      const stats = compact([
        facts.price_stats.min_eur,
        facts.price_stats.max_eur,
        facts.price_stats.average_eur,
      ]);
      if (stats.length > 0) {
        fallbacks.push(`Prices per kWh ranged ${stats.join(" to ")}.`);
      }
    }
    if (facts.comparison !== null) {
      const prev = compact([
        facts.comparison.previous_kwh,
        facts.comparison.previous_eur,
      ]).join(" for ");
      if (prev !== "") {
        fallbacks.push(`The previous ${periodWord} used ${prev}.`);
      }
    }
    if (fallbacks.length === 0) {
      fallbacks.push(`No usage slots for this ${periodWord} yet.`);
    }
    sections.push({
      key: "over_time",
      label: "Over time",
      facts,
      fallback_sentences: fallbacks,
      notes: shortDayNotes(pageFacts),
      budget: 4,
    });
  }

  return sections;
}

function heatSections(pageFacts) {
  const periodWord = pageFacts?.period ?? "period";
  const sections = [];

  const g = pageFacts?.gas ?? null;
  if (g !== null) {
    const facts = {
      ...baseFacts(pageFacts),
      m3: m3String(g.m3),
      eur: eurString(g.eur),
      price_eur_per_m3: eurString(g.price_eur_per_m3),
      unknown_price: g.unknown_price === true,
      midnight_coverage_note: g.midnight_coverage_note ?? null,
    };
    const notes = shortDayNotes(pageFacts);
    if (g.unknown_price === true) {
      facts.unknown_price_note = GAS_UNKNOWN_PRICE_NOTE;
      notes.push({ required: GAS_UNKNOWN_PRICE_NOTE, append: GAS_UNKNOWN_PRICE_NOTE });
    }
    facts.measured_figures = compact([facts.m3, facts.eur, facts.price_eur_per_m3]);
    facts.estimated_figures = [];
    const fallbacks = [];
    if (facts.m3 !== null) {
      if (facts.eur !== null && facts.price_eur_per_m3 !== null) {
        fallbacks.push(
          pageFacts.so_far === true
            ? `So far this ${periodWord}, the home used ${facts.m3} of gas for ${facts.eur} at ${facts.price_eur_per_m3} per m3.`
            : `This ${periodWord}, the home used ${facts.m3} of gas for ${facts.eur} at ${facts.price_eur_per_m3} per m3.`
        );
      } else if (facts.unknown_price === true) {
        fallbacks.push(
          pageFacts.so_far === true
            ? `So far this ${periodWord}, the home used ${facts.m3} of gas; ${GAS_UNKNOWN_PRICE_NOTE}`
            : `This ${periodWord}, the home used ${facts.m3} of gas; ${GAS_UNKNOWN_PRICE_NOTE}`
        );
      } else {
        fallbacks.push(
          pageFacts.so_far === true
            ? `So far this ${periodWord}, the home used ${facts.m3} of gas.`
            : `This ${periodWord}, the home used ${facts.m3} of gas.`
        );
      }
    } else {
      fallbacks.push(`No gas data for this ${periodWord} yet.`);
    }
    sections.push({
      key: "gas",
      label: "Gas",
      facts,
      fallback_sentences: fallbacks,
      notes,
      budget: 4,
    });
  }

  const z = pageFacts?.zones ?? null;
  if (z !== null) {
    const zones = z.zones.map((zone) => ({
      name: zone.name,
      avg_temp_c: numString(zone.avg_temp_c),
      current_temp_c: numString(zone.current_temp_c),
      setpoint_avg_c: numString(zone.setpoint_avg_c),
      heating: {
        count: numString(zone.heating?.count),
        total_hours: numString(zone.heating?.total_hours),
        inferred: true,
        inference_note: zone.heating?.inference_note ?? ZONES_INFERENCE_NOTE,
      },
    }));
    const facts = {
      ...baseFacts(pageFacts),
      zones,
      outdoor_avg_c: numString(z.outdoor_avg_c),
      warmest_zone:
        z.warmest_zone !== null
          ? { name: z.warmest_zone.name, avg_temp_c: numString(z.warmest_zone.avg_temp_c) }
          : null,
      coolest_zone:
        z.coolest_zone !== null
          ? { name: z.coolest_zone.name, avg_temp_c: numString(z.coolest_zone.avg_temp_c) }
          : null,
    };
    const measuredFigures = [];
    for (const zone of zones) {
      measuredFigures.push(
        ...compact([
          zone.avg_temp_c,
          zone.current_temp_c,
          zone.setpoint_avg_c,
          zone.heating.count,
          zone.heating.total_hours,
        ])
      );
    }
    measuredFigures.push(...compact([facts.outdoor_avg_c, facts.warmest_zone?.avg_temp_c ?? null, facts.coolest_zone?.avg_temp_c ?? null]));
    facts.measured_figures = measuredFigures;
    facts.estimated_figures = [];
    const fallbacks = [];
    if (facts.warmest_zone !== null && facts.coolest_zone !== null) {
      fallbacks.push(
        `${facts.warmest_zone.name} was the warmest zone at ${facts.warmest_zone.avg_temp_c}, ${facts.coolest_zone.name} the coolest at ${facts.coolest_zone.avg_temp_c}.`
      );
    }
    const heatingParts = zones
      .filter((zone) => zone.heating.count > 0)
      .map(
        (zone) =>
          `${zone.name} heated for ${zone.heating.total_hours} across ${zone.heating.count} intervals`
      );
    if (heatingParts.length > 0) {
      fallbacks.push(`${heatingParts.join("; ")}.`);
    }
    fallbacks.push(ZONES_INFERENCE_NOTE);
    sections.push({
      key: "zones",
      label: "Zones",
      facts,
      fallback_sentences: fallbacks,
      notes: [
        ...shortDayNotes(pageFacts),
        { required: ZONES_INFERENCE_NOTE, append: ZONES_INFERENCE_NOTE },
      ],
      budget: 4,
    });
  }

  const h = pageFacts?.heating_cost ?? null;
  if (h !== null) {
    const facts = {
      ...baseFacts(pageFacts),
      gas_eur_per_kwh_heat: eurPerKwhHeatString(h.gas_eur_per_kwh_heat),
      heat_pump_eur_per_kwh_heat: eurPerKwhHeatString(h.heat_pump_eur_per_kwh_heat),
      heat_pump_class: h.heat_pump_class ?? null,
      assumptions: {
        calorific_kwh_per_m3: numString(h.assumptions?.calorific_kwh_per_m3),
        boiler_efficiency: numString(h.assumptions?.boiler_efficiency),
        cop_at_avg_outdoor_temp: numString(h.assumptions?.cop_at_avg_outdoor_temp),
        avg_electricity_price_eur_per_kwh: eurString(
          h.assumptions?.avg_electricity_price_eur_per_kwh
        ),
        avg_outdoor_temp_c: numString(h.assumptions?.avg_outdoor_temp_c),
      },
      verdict: h.verdict ?? null,
    };
    facts.estimated_figures = compact([facts.heat_pump_eur_per_kwh_heat]);
    facts.measured_figures = compact([
      facts.gas_eur_per_kwh_heat,
      facts.assumptions.avg_electricity_price_eur_per_kwh,
    ]);
    const fallbacks = [];
    if (facts.gas_eur_per_kwh_heat !== null && facts.heat_pump_eur_per_kwh_heat !== null) {
      fallbacks.push(
        `Gas costs ${facts.gas_eur_per_kwh_heat} per kWh of heat; the heat pump estimate is ${facts.heat_pump_eur_per_kwh_heat}.`
      );
      if (facts.verdict === "gas_cheaper") {
        fallbacks.push("The gas route is currently the cheaper one.");
      } else if (facts.verdict === "hp_cheaper") {
        fallbacks.push("The heat pump estimate is currently the cheaper route.");
      }
    } else {
      fallbacks.push(
        `The heating cost comparison is not computable for this ${periodWord}.`
      );
    }
    sections.push({
      key: "heating_cost",
      label: "Heating cost",
      facts,
      fallback_sentences: fallbacks,
      notes: shortDayNotes(pageFacts),
      budget: 4,
    });
  }

  return sections;
}

function solarSections(pageFacts) {
  if (pageFacts === null || pageFacts === undefined) return [];
  const facts = {
    date: pageFacts.date ?? null,
    day_status: pageFacts.day_status ?? null,
    actual_kwh: kwhString(pageFacts.actual_kwh),
    forecast_kwh: kwhString(pageFacts.forecast_kwh),
    solar_score: numString(pageFacts.solar_score),
    condition:
      typeof pageFacts.condition === "string" && pageFacts.condition !== ""
        ? pageFacts.condition
        : null,
    export_kwh: kwhString(pageFacts.export_kwh),
    export_eur: eurString(pageFacts.export_eur),
    self_consumption_pct: pctString(pageFacts.self_consumption_pct),
    night_export_caveat: pageFacts.night_export_caveat ?? NIGHT_EXPORT_CAVEAT,
    semantics: pageFacts.semantics ?? null,
    short_day_note: SHORT_DAY_NOTE,
  };
  facts.measured_figures = compact([
    facts.actual_kwh,
    facts.export_kwh,
    facts.export_eur,
    facts.self_consumption_pct,
  ]);
  facts.estimated_figures = [];
  const fallbacks = [];
  if (facts.actual_kwh !== null && facts.forecast_kwh !== null) {
    fallbacks.push(
      `So far today the panels produced ${facts.actual_kwh} of a forecast ${facts.forecast_kwh}.`
    );
  } else if (facts.actual_kwh !== null) {
    fallbacks.push(`So far today the panels produced ${facts.actual_kwh}.`);
  }
  if (facts.condition !== null) {
    fallbacks.push(`Today's condition is ${facts.condition}.`);
  }
  if (facts.export_kwh !== null) {
    fallbacks.push(`Export so far today is ${facts.export_kwh}.`);
  }
  fallbacks.push(NIGHT_EXPORT_CAVEAT);
  if (fallbacks.length === 1) {
    fallbacks.unshift("No solar production data for today yet.");
  }
  return [
    {
      key: "production",
      label: "Solar production",
      facts,
      fallback_sentences: fallbacks,
      notes: [
        { required: NIGHT_EXPORT_CAVEAT, append: NIGHT_EXPORT_CAVEAT },
        { required: SHORT_DAY_NOTE, append: SHORT_DAY_NOTE },
      ],
      budget: 4,
    },
  ];
}

// buildContextBoxSections(widgetId, pageFacts): the widget's section
// boxes from the page facts. A null page-fact section is honest absence:
// no box, never an empty narrative.
export function buildContextBoxSections(widgetId, pageFacts) {
  if (widgetId === "usage_context") return usageSections(pageFacts ?? {});
  if (widgetId === "heat_context") return heatSections(pageFacts ?? {});
  if (widgetId === "solar_production") return solarSections(pageFacts ?? null);
  return [];
}

// ---------------------------------------------------------------------------
// The widget prompt: the brief, one section block per box with its own
// facts only, and on the single retry the previous attempt's per-section
// rejection reasons verbatim as feedback.
// ---------------------------------------------------------------------------

export function buildWidgetPrompt(widgetId, sections, rejections = null) {
  const lines = [
    CONTEXT_BOX_BRIEF,
    "",
    `Widget: ${widgetId}. Answer with one JSON object, {"narratives": {"<section key>": "<2 to 4 sentences>", ...}}, with exactly one entry per section below, keyed by its exact section key.`,
  ];
  for (const section of sections) {
    lines.push(
      "",
      `Section "${section.key}" (${section.label}):`,
      `Facts: ${JSON.stringify(section.facts)}`
    );
  }
  if (rejections !== null) {
    const parts = Object.entries(rejections).map(
      ([key, reasons]) => `${key}: ${[...new Set(reasons)].join("; ")}`
    );
    lines.push(
      "",
      `Your previous attempt was rejected for these sections and reasons: ${parts.join(" | ")}. Answer again with corrected narratives; every figure must be a verbatim copy of a served fact of its own section.`
    );
  }
  return lines.join("\n");
}

// Parses the model's JSON answer, stripping markdown fences; null on any
// failure (a null answer serves the fallbacks, never a crash).
function parseModelJson(text) {
  if (typeof text !== "string") return null;
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) candidate = fence[1];
  try {
    const parsed = JSON.parse(candidate);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Content parity: every server-owned note a section serves must appear
// verbatim in the final narrative; what the model did not weave is
// appended verbatim.
function narrativeWithNotes(narrative, notes) {
  let text = narrative;
  for (const note of notes ?? []) {
    if (note.append !== null && !text.includes(note.required)) {
      text = `${text}${text.endsWith(" ") ? "" : " "}${note.append}`;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// The generator: one model call per widget id (plus at most one retry of
// the whole call with the rejection feedback). Each section's narrative is
// validated against its own fact set; after the retry, sections that
// still fail serve their deterministic fallback sentences. Sentence
// budgets are logged in the report, never asserted.
// ---------------------------------------------------------------------------

export async function generateContextBoxNarratives(widgetId, sections, seam) {
  const list = Array.isArray(sections) ? sections : [];
  const report = [];
  let accepted = {};
  const rejectedAttempts = [];
  let modelOk = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = buildWidgetPrompt(
      widgetId,
      list,
      attempt === 0 ? null : Object.fromEntries(rejectedAttempts.map((r) => [r.key, r.reasons]))
    );
    let raw = null;
    try {
      raw = await seam(prompt);
    } catch {
      raw = null; // a seam failure serves the fallback, never a crash
    }
    const parsed = parseModelJson(raw);
    if (parsed !== null) modelOk = true;
    const offered =
      parsed !== null && parsed.narratives !== null && typeof parsed.narratives === "object"
        ? parsed.narratives
        : {};
    const nextAccepted = {};
    const rejections = {};
    for (const section of list) {
      const offeredText =
        typeof offered[section.key] === "string"
          ? offered[section.key].replace(/\s+/g, " ").trim()
          : null;
      if (offeredText === null || offeredText === "") {
        rejections[section.key] = ["offered no narrative for this section"];
        continue;
      }
      const verdict = validateContextBoxSection(offeredText, section);
      if (verdict.ok) {
        nextAccepted[section.key] = offeredText;
      } else {
        rejections[section.key] = verdict.reasons;
      }
    }
    for (const [key, reasons] of Object.entries(rejections)) {
      rejectedAttempts.push({ attempt: attempt + 1, key, reasons });
    }
    accepted = nextAccepted;
    if (Object.keys(rejections).length === 0) break;
  }
  for (const section of list) {
    const narrative = accepted[section.key] ?? null;
    const finalNarrative =
      narrative !== null ? narrativeWithNotes(narrative, section.notes) : null;
    const servedText =
      finalNarrative ?? section.fallback_sentences.join(" ");
    report.push({
      key: section.key,
      label: section.label,
      narrative: servedText,
      fallback: finalNarrative === null,
      budget: section.budget,
      sentenceCount: splitSentences(servedText).length,
      rejected_attempts: rejectedAttempts.filter((r) => r.key === section.key),
      retried: rejectedAttempts.some((r) => r.key === section.key),
    });
  }
  return { sections: report, modelOk };
}

// ---------------------------------------------------------------------------
// The bucketed signature over the page facts plus the period and date
// anchor: numbers bucket (0.5, or 5 for percentages and scores) so a
// snapshot refresh with trivial drift never changes the signature and
// never triggers a regeneration; the anchor pins the box to its period.
// ---------------------------------------------------------------------------

function bucketize(value, key) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "na";
    const size = /pct|score/i.test(key) ? 5 : 0.5;
    return Math.floor(value / size);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => bucketize(entry, `${key}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, bucketize(value[k], k)])
    );
  }
  return value;
}

export function contextBoxSignature(widgetId, pageFacts, anchor = {}) {
  const anchors = [
    `w:${widgetId}`,
    anchor.period !== undefined && anchor.period !== null ? `p:${anchor.period}` : null,
    anchor.date !== undefined && anchor.date !== null ? `d:${anchor.date}` : null,
  ]
    .filter((part) => part !== null)
    .join("|");
  return hashString(`${anchors}|${JSON.stringify(bucketize(pageFacts ?? {}, ""))}`);
}

// ---------------------------------------------------------------------------
// The runner: per-widget cache, 30-minute floor, shared budget, journal
// parity with the existing widgets ([mistral] widget=... lines plus one
// line per section and per rejected attempt), fail-soft stale serving.
// ---------------------------------------------------------------------------

const insightCaches = new Map(); // widgetId -> { signature, result }
const lastCallAt = new Map(); // widgetId -> timestamp of the last upstream call

function fallbackPayload(widgetId, sections, signature, error) {
  return {
    signature,
    generatedAt: null,
    state: "error",
    error,
    sections: sections.map((section) => ({
      key: section.key,
      label: section.label,
      narrative: section.fallback_sentences.join(" "),
      fallback: true,
    })),
  };
}

export async function getContextBoxInsight(widgetId, pageFacts, anchor = {}, options = {}) {
  const force = options.force === true;
  const signature = contextBoxSignature(widgetId, pageFacts, anchor);
  const cached = insightCaches.get(widgetId);
  // Cache hit: no model call, no journal line - a snapshot refresh with
  // an unchanged bucketed signature never regenerates.
  if (!force && cached && cached.signature === signature) {
    return { ...cached.result, signature, state: "fresh", error: null };
  }
  const reason = force ? "force" : "signature_change";
  const sections = buildContextBoxSections(widgetId, pageFacts);

  // The shared daily cap gates every path, force included.
  if (dailyLimitReached()) {
    logMistral(widgetId, signature, reason, "skipped_daily_limit");
    return cached
      ? { ...cached.result, signature, state: "stale", error: "daily_limit_reached" }
      : fallbackPayload(widgetId, sections, signature, "daily_limit_reached");
  }
  // The 30-minute floor per widget id; force bypasses it. A stale cached
  // insight is preferable to skipping the box entirely.
  if (!force && Date.now() - (lastCallAt.get(widgetId) ?? 0) < MIN_CALL_INTERVAL_MS) {
    logMistral(widgetId, signature, reason, "skipped_throttle");
    return cached
      ? { ...cached.result, signature, state: "stale", error: null }
      : fallbackPayload(widgetId, sections, signature, "ai_unavailable");
  }

  const seam = async (prompt) => {
    if (dailyLimitReached()) {
      logMistral(widgetId, signature, reason, "skipped_daily_limit");
      return null;
    }
    recordApiCall();
    lastCallAt.set(widgetId, Date.now());
    if (options.stub !== undefined && options.stub !== null) {
      return options.stub(prompt);
    }
    try {
      return await callMistral(CONTEXT_BOX_BRIEF, prompt);
    } catch (err) {
      logMistral(widgetId, signature, reason, `error:${shortError(err)}`);
      return null;
    }
  };

  const generated = await generateContextBoxNarratives(widgetId, sections, seam);
  for (const line of generated.sections) {
    console.log(
      `context-box ${widgetId} ${line.key}: ${
        line.fallback ? "fallback" : "accepted"
      }, sentences ${line.sentenceCount}/${line.budget}`
    );
    for (const rejection of line.rejected_attempts) {
      console.log(
        `context-box ${widgetId} ${line.key} attempt ${rejection.attempt} rejected: ${rejection.reasons.join("; ")}`
      );
    }
  }
  if (!generated.modelOk) {
    logMistral(widgetId, signature, reason, "error:ai_unavailable");
    return cached
      ? { ...cached.result, signature, state: "stale", error: "ai_unavailable" }
      : fallbackPayload(widgetId, sections, signature, "ai_unavailable");
  }
  logMistral(widgetId, signature, reason, "ok");
  const result = {
    signature,
    generatedAt: new Date().toISOString(),
    sections: generated.sections.map((line) => ({
      key: line.key,
      label: line.label,
      narrative: line.narrative,
      fallback: line.fallback,
    })),
  };
  insightCaches.set(widgetId, { signature, result });
  return { ...result, signature, state: "fresh", error: null };
}
