import type { ContextBoxResponse } from "@/lib/api"

// The context-box view model (contract section 11): maps one page
// endpoint's payload to the boxes that page renders. Pure, so the DOM
// check (box count and the absence path) is a plain unit test.

export interface ContextBoxItem {
  key: string
  label: string
  text: string
  fallback: boolean
}

// The boxes of a page payload, in payload order. Honest absence: a
// section without a narrative (no facts for the anchored period)
// renders no box at all, and a payload without sections renders none.
// The Energy/Cost mode is deliberately not an input: the facts carry
// both dimensions, so the toggle never alters or refetches a box.
export function contextBoxItems(
  response: ContextBoxResponse | null | undefined
): ContextBoxItem[] {
  if (response == null || !Array.isArray(response.sections)) return []
  return response.sections
    .filter(
      (section) =>
        section != null &&
        typeof section === "object" &&
        typeof section.narrative === "string" &&
        section.narrative.trim() !== ""
    )
    .map((section) => ({
      key: String(section.key),
      label: String(section.label),
      text: section.narrative as string,
      fallback: section.fallback === true,
    }))
}

// The box for one section key (the page's wiring maps each section to
// its position); null when that section is absent.
export function contextBoxByKey(
  items: ContextBoxItem[],
  key: string
): ContextBoxItem | null {
  return items.find((item) => item.key === key) ?? null
}
