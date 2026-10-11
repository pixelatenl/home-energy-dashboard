import ApplianceUsageWidget from "@/components/ApplianceUsageWidget"
import { useAppliances } from "@/lib/useAppliances"
import { useSummary } from "@/lib/useSummary"

// Compact appliance widget for the main dashboard: today's smart-plug
// usage beneath the battery panel. Renders nothing until the plugs have
// data, so the dashboard degrades silently when none exist.
function ApplianceUsageToday() {
  const { data, status } = useAppliances("today")
  const { summary } = useSummary()

  if (status !== "ok" || data === null) {
    return null
  }
  if (data.appliances.length === 0 && data.totals.plug_kwh === 0) {
    return null
  }
  // Home usage comes from the summary the dashboard already fetches
  // (import + PV - export - net battery), not from a second calculation.
  const homeUsage = summary?.today.total_usage_kwh ?? null
  const plugKwh = data.totals.plug_kwh
  const restOfHomeKwh =
    homeUsage === null ? null : Math.max(0, homeUsage - plugKwh)

  return (
    <ApplianceUsageWidget
      appliances={data.appliances}
      plugKwh={plugKwh}
      restOfHomeKwh={restOfHomeKwh}
      compact
    />
  )
}

export default ApplianceUsageToday
