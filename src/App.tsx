import { BrowserRouter, Route, Routes } from "react-router-dom"
import AppliancesPage from "@/components/AppliancesPage"
import ArchitecturePage from "@/components/ArchitecturePage"
import BatteryPage from "@/components/BatteryPage"
import DebugPage from "@/components/DebugPage"
import HeatPage from "@/components/HeatPage"
import SolarPage from "@/components/SolarPage"
import TodayPage from "@/components/TodayPage"
import UsagePage from "@/components/UsagePage"
import { ModeProvider } from "@/lib/mode"

// Hub-and-spoke shell: pure routing. Each page wraps its content in
// the shared PageLayout, which renders the page header, the tab row,
// the content area and the footer. ModeProvider carries the global
// Energy/Cost mode, URL-persisted so it survives navigation and
// reload.
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
            <Route path="/appliances" element={<AppliancesPage />} />
            <Route path="/heat" element={<HeatPage />} />
            <Route path="/debug" element={<DebugPage />} />
            <Route path="/architecture" element={<ArchitecturePage />} />
          </Routes>
        </div>
      </ModeProvider>
    </BrowserRouter>
  )
}

export default App
