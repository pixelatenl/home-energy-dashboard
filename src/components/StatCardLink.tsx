import { Link } from "react-router-dom"
import { useModeSearch } from "@/lib/mode"

// The stats cards' navigation: a link stretched inset over the card,
// the card-link pattern, so the whole card is one hover, click and
// keyboard target without wrapping interactive children in an
// anchor. The z-10 layer sits above the card's own positioned
// content (the spinning circle, chart markers) while the corner info
// tooltip's z-20 stays on top and usable. The card itself carries
// the hover state; this layer adds the pointer cursor and the focus
// ring. The global mode param rides along so the Energy/Cost choice
// survives navigation.
function StatCardLink({ to, label }: { to: string; label: string }) {
  const modeSearch = useModeSearch()
  // The mode param joins the target's query string: "&" when the
  // target carries one already (the "?period=day" cards), "?" when
  // it does not (the live card's bare "/live") - a "&" there would
  // read as a path segment and match no route.
  const mode = modeSearch
    ? `${to.includes("?") ? "&" : "?"}${modeSearch.slice(1)}`
    : ""
  return (
    <Link
      to={`${to}${mode}`}
      aria-label={label}
      className="absolute inset-0 z-10 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
  )
}

export default StatCardLink
