import PageLayout from "@/components/PageLayout"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the heat spoke of the hub-and-spoke restructure.
function HeatPage() {
  return (
    <PageLayout title="Heat" subtitle="Heating energy at a glance">
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          This page arrives in the next build pass.
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default HeatPage
