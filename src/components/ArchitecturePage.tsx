import { Fragment } from "react"
import {
  ArrowDownToLine,
  ArrowRight,
  Database,
  Home,
  Monitor,
  Plug,
  Server,
} from "lucide-react"
import PageLayout from "@/components/PageLayout"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// One node of the data-flow chain.
const FLOW_NODES = [
  { label: "Devices", icon: Plug },
  { label: "Home Assistant", icon: Home },
  { label: "Ingest worker", icon: ArrowDownToLine },
  { label: "TimescaleDB", icon: Database },
  { label: "API server", icon: Server },
  { label: "Frontend", icon: Monitor },
]

// One layer of the system: its role and the facts under it.
const LAYERS = [
  {
    name: "Home Assistant",
    role: "Data collection layer",
    points: [
      "Docker container on the minipc; collects all device data (Zonneplan, Anker battery and plugs, weather) via local Modbus and cloud integrations.",
      "Exposes state changes via its WebSocket and REST APIs; the Recorder serves only as a short-term buffer.",
    ],
  },
  {
    name: "Backend",
    role: "Storage and intelligence",
    points: [
      "Ingest worker (Node, systemd service ems-ingest): subscribes to HA state changes and writes 5-minute samples and energy deltas to TimescaleDB.",
      "TimescaleDB (PostgreSQL 16): hypertables for measurements and energy deltas, hourly/daily aggregates, and the Zonneplan price history, with nightly backups.",
      "Express API server (systemd service ems-dashboard, port 8080): reads the database, combines it with weather, PV and price forecasts, and uses the Mistral API only for advice text; all forecasting itself is a computational model.",
    ],
  },
  {
    name: "Frontend",
    role: "Own dashboard",
    points: [
      "React app (Vite, pnpm) served by the API server; consumes only the own API and shows live energy flow, forecasts, prices, and AI insights.",
    ],
  },
]

// The architecture page: the system's three logical layers and the
// one-directional data flow between them, in the dashboard's card
// styling.
function ArchitecturePage() {
  return (
    <PageLayout
      title="Architecture"
      subtitle="How the system fits together"
    >
        <Card>
          <CardHeader>
            <CardTitle>Architecture at a glance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">
              The system runs on a single minipc with three logical
              layers: Home Assistant as the data collection layer, an own
              backend for storage and intelligence, and an own frontend
              dashboard. All data flows in one direction: devices to Home
              Assistant, Home Assistant to the backend, and the backend to
              the frontend. The frontend never communicates with Home
              Assistant directly.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {LAYERS.map((layer) => (
            <Card key={layer.name}>
              <CardHeader>
                <CardTitle>{layer.name}</CardTitle>
                <CardDescription>{layer.role}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">
                  {layer.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Data flow</CardTitle>
            <CardDescription>
              Every hop is one-directional; nothing talks back
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {FLOW_NODES.map((node, index) => (
                <Fragment key={node.label}>
                  {index > 0 && (
                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium">
                    <node.icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {node.label}
                  </span>
                </Fragment>
              ))}
            </div>
          </CardContent>
        </Card>
    </PageLayout>
  )
}

export default ArchitecturePage
