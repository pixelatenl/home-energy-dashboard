import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the heat spoke of the hub-and-spoke restructure.
function HeatPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="px-6 py-4">
          <h1 className="text-xl font-semibold">Heat</h1>
        </div>
      </header>
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

export default HeatPage
