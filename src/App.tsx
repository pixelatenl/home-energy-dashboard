import type { ReactNode } from "react"
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import ArchitecturePage from "@/components/ArchitecturePage"
import BatteryPage from "@/components/BatteryPage"
import DebugPage from "@/components/DebugPage"
import ErrorBoundary from "@/components/ErrorBoundary"
import HeatPage from "@/components/HeatPage"
import LivePage from "@/components/LivePage"
import SolarPage from "@/components/SolarPage"
import TodayPage from "@/components/TodayPage"
import UsagePage from "@/components/UsagePage"
import { ModeProvider } from "@/lib/mode"

// Hub-and-spoke shell: pure routing. Each page wraps its content in
// the shared PageLayout, which renders the page header, the tab row,
// the content area and the footer. ModeProvider carries the global
// Energy/Cost mode, URL-persisted so it survives navigation and
// reload.
// Each route sits inside its own ErrorBoundary, so a render crash on
// one page stays local to that page instead of unmounting the whole
// kiosk.

// The appliances spoke lives on the Usage page now: any saved
// /appliances URL lands there, the history entry replaced, with the
// mode param carried over.
function AppliancesRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/usage${search}`} replace />
}

// One boundary per route: the page that throws shows the recovery
// card, everything else keeps rendering.
const bounded = (page: ReactNode) => <ErrorBoundary>{page}</ErrorBoundary>

function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <div className="min-h-screen">
          <Routes>
            <Route path="/" element={bounded(<TodayPage />)} />
            <Route path="/usage" element={bounded(<UsagePage />)} />
            <Route path="/solar" element={bounded(<SolarPage />)} />
            <Route path="/battery" element={bounded(<BatteryPage />)} />
            <Route path="/appliances" element={<AppliancesRedirect />} />
            <Route path="/heat" element={bounded(<HeatPage />)} />
            <Route path="/live" element={bounded(<LivePage />)} />
            <Route path="/debug" element={bounded(<DebugPage />)} />
            <Route
              path="/architecture"
              element={bounded(<ArchitecturePage />)}
            />
          </Routes>
        </div>
      </ModeProvider>
    </BrowserRouter>
  )
}

export default App
