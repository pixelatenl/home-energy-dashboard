import NavBar from "@/components/NavBar"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the solar spoke of the hub-and-spoke restructure.
function SolarPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="px-6 py-4">
          <h1 className="text-xl font-semibold">Solar</h1>
        </div>
      </header>
      <div className="px-6 pt-4">
        <NavBar />
      </div>
      <main className="px-6 pt-4 pb-8">
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            This page arrives in the next build pass.
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

export default SolarPage
