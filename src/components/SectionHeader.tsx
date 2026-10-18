import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  description: ReactNode
}

// A panel header for a section inside an already-padded card: the
// same look as PanelHeader - the muted icon and title row over the
// muted description - without the CardHeader padding, so two
// sections can share one glass card side by side.
function SectionHeader({ icon: Icon, title, description }: SectionHeaderProps) {
  return (
    <div className="grid auto-rows-min items-start gap-1">
      <p className="flex items-center gap-2 font-heading text-lg leading-snug font-medium text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export default SectionHeader
