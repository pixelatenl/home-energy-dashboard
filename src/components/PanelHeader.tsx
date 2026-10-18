import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface PanelHeaderProps {
  icon: LucideIcon
  title: string
  description: ReactNode
}

// The shared panel header, the idiom the price widget established: a
// muted icon + title row over the muted description. Extracted so
// the treemap and the panels after it render their headers
// pixel-identically to the price widget's.
function PanelHeader({ icon: Icon, title, description }: PanelHeaderProps) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-title-foreground">
        <Icon className="size-6" aria-hidden="true" />
        {title}
      </CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  )
}

export default PanelHeader
