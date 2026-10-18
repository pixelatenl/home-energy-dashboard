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

// The appliances spoke lives on the Usage page now: any saved
// /appliances URL lands there, the history entry replaced, with the
// mode param carried over.
function AppliancesRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/usage${search}`} replace />
}

function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <div className="min-h-screen">
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/solar" element={<SolarPage />} />
            <Route path="/battery" element={<BatteryPage />} />
            <Route path="/appliances" element={<AppliancesRedirect />} />
            <Route path="/heat" element={<HeatPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/debug" element={<DebugPage />} />
            <Route path="/architecture" element={<ArchitecturePage />} />
          </Routes>
        </div>
      </ModeProvider>
    </BrowserRouter>
  )
}

export default App
