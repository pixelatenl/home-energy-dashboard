import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import BrandLogo from "@/components/BrandLogo"
import LiveEnergyFlow from "@/components/LiveEnergyFlow"
import { useModeSearch } from "@/lib/mode"

// The dedicated live energy flow page: the flow hero alone, no tab
// row - the page is a placeholder for its own redesign pass. The
// header keeps the shell's logo and title idiom, and the bottom
// carries the single way back.
function LivePage() {
  const modeSearch = useModeSearch()
  return (
    <div className="min-h-screen">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-4 px-3 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-10 w-10" />
            <div>
              <h1 className="text-xl font-semibold">Live energy flow</h1>
              <p className="text-sm text-muted-foreground">
                Power between solar, home, grid and battery
              </p>
            </div>
          </div>
        </div>
      </header>
      <main className="space-y-6 px-3 pb-8 sm:px-6">
        <LiveEnergyFlow />
        <Link
          to={`/${modeSearch}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to today
        </Link>
      </main>
    </div>
  )
}

export default LivePage
