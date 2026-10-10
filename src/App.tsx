import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const consumption = [
  { period: "Today", kwh: "12.4" },
  { period: "This week", kwh: "89.1" },
  { period: "This month", kwh: "362.7" },
]

const recent = [
  { time: "08:12", appliance: "Heat pump", kwh: "2.1" },
  { time: "09:40", appliance: "Dishwasher", kwh: "1.3" },
  { time: "12:05", appliance: "EV charger", kwh: "8.6" },
  { time: "17:22", appliance: "Oven", kwh: "1.9" },
]

function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Home Energy Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Monitor your household energy use
            </p>
          </div>
          <Button>Refresh</Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {consumption.map((item) => (
            <Card key={item.period}>
              <CardHeader>
                <CardDescription>{item.period}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {item.kwh} kWh
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="recent">
          <TabsList>
            <TabsTrigger value="recent">Recent usage</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>
          <TabsContent value="recent" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent consumption</CardTitle>
                <CardDescription>
                  Latest appliance activity recorded today
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Appliance</TableHead>
                      <TableHead className="text-right">Energy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((row) => (
                      <TableRow key={row.time}>
                        <TableCell className="tabular-nums">{row.time}</TableCell>
                        <TableCell>{row.appliance}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.kwh} kWh
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="summary" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>
                  Replace this placeholder with real data sources
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge>Grid connected</Badge>
                  <Badge variant="secondary">Solar: inactive</Badge>
                </div>
                <Separator />
                <p className="text-sm text-muted-foreground">
                  The app is bootstrapped with Vite, React, TypeScript and
                  shadcn/ui. Edit <code>src/App.tsx</code> to get started.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default App
