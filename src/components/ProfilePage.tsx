import type { LucideIcon } from "lucide-react"
import { FileText, Settings, SlidersHorizontal } from "lucide-react"
import EstimatedBillCard from "@/components/EstimatedBillCard"
import PageLayout from "@/components/PageLayout"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"

// One placeholder section of the profile page.
interface ProfileSection {
  icon: LucideIcon
  title: string
  description: string
  note?: string
}

const CONTRACT_SECTION: ProfileSection = {
  icon: FileText,
  title: "My energy contract",
  description:
    "Provider, contract type (dynamic), current tariff basis, feed-in conditions.",
  note: "No contract data connected yet",
}

const CALIBRATION_SECTION: ProfileSection = {
  icon: SlidersHorizontal,
  title: "Calibration",
  description:
    "Compare the estimated bill against the real Zonneplan bill and calibrate the model.",
  note: "First full calendar month of data is November 2026",
}

const SETTINGS_SECTION: ProfileSection = {
  icon: Settings,
  title: "Settings",
  description: "Preferences and assumptions.",
}

// One stub card: the shared panel header (icon, title, muted
// description of the intended content) over the placeholder body -
// the "Coming soon" line in the usual subtle placeholder style, plus
// an optional muted note on what is still missing.
function PlaceholderCard({ section }: { section: ProfileSection }) {
  return (
    <Card>
      <PanelHeader
        icon={section.icon}
        title={section.title}
        description={section.description}
      />
      <CardContent>
        <p className="text-sm text-subtle-foreground">Coming soon</p>
        {section.note != null && (
          <p className="mt-1 text-xs text-muted-foreground">{section.note}</p>
        )}
      </CardContent>
    </Card>
  )
}

// The profile spoke: the household's energy contract, the estimated
// bill, the bill calibration and the settings. The bill card is live
// (one month at a time, current month to date by default); the other
// three are placeholder cards for now. The data availability note
// leads the page, in the same stub-card idiom as the other pages'
// data-start notes. No period navigator: the bill card carries its
// own month selector.
function ProfilePage() {
  return (
    <PageLayout
      title="Profile"
      subtitle="Your contract, estimated bill and settings"
    >
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          Data collection started on 10 October 2026.
        </CardContent>
      </Card>
      <PlaceholderCard section={CONTRACT_SECTION} />
      <EstimatedBillCard />
      <PlaceholderCard section={CALIBRATION_SECTION} />
      <PlaceholderCard section={SETTINGS_SECTION} />
    </PageLayout>
  )
}

export default ProfilePage
