import { BrowserRouter, Route, Routes } from "react-router-dom"
import AppliancesPage from "@/components/AppliancesPage"
import ArchitecturePage from "@/components/ArchitecturePage"
import BatteryPage from "@/components/BatteryPage"
import DebugPage from "@/components/DebugPage"
import HeatPage from "@/components/HeatPage"
import NavBar from "@/components/NavBar"
import SolarPage from "@/components/SolarPage"
import TodayPage from "@/components/TodayPage"
import UsagePage from "@/components/UsagePage"

// Hub-and-spoke shell: the NavBar renders once above the routed page,
// inside the app's px-6 padding rhythm. Each page owns its own header
// and content below it.
function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background">
        <div className="px-6 pt-4">
          <NavBar />
        </div>
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
    </BrowserRouter>
  )
}

export default App
