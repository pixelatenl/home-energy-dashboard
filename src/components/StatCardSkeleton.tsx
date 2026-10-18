import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The hub stat cards' shared loading skeleton: the real card chrome
// with muted placeholder lines that mirror the loaded geometry
// exactly, so nothing shifts when the data lands - at every
// breakpoint, including the two-column tablet band where the
// headline takes its smaller step.
//
// The sizes are the loaded card's real line heights, not thin bars:
// the title row is the CardTitle's 28 px text-lg line, the headline
// block is the responsive headline scale's line height (55 px for
// the 2.5 rem step, 44 px for the tablet band's 2 rem step), and
// the sub-lines are the 16 px text-xs lines.
//
// Two flows mirror the two card layouts:
// - spread (default): the metric cards' justify-between split -
//   title and headline at the top, the sub-lines at the bottom
// - stack: the chart cards' natural flow - the header block, then
//   the content block one Card gap (16 px) below
//
// `headline={false}` fits the cards whose figure lives inside a
// visual (the Live power circle, the battery gauge).
function StatCardSkeleton({
  headline = true,
  stack = false,
  belowHeadline,
  children,
}: {
  headline?: boolean;
  stack?: boolean;
  belowHeadline?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="h-full min-h-24" aria-busy="true">
      <div
        className={`flex flex-1 flex-col items-stretch px-4 ${
          stack ? "" : "justify-between gap-1"
        }`}
      >
        <div className="flex flex-col gap-1">
          {/* The title row's exact height: the CardTitle's text-lg
              (18 px) at leading-snug (1.375) = 24.75 px - not the
              default text-lg line height. The headline block below
              mirrors the responsive headline scale's leading-snug
              line heights (55 px for the 2.5 rem step, 44 px for the
              tablet band's 2 rem step). */}
          <Skeleton className="h-[24.75px] w-24" />
          {headline && (
            <Skeleton className="h-[55px] w-28 md:h-[44px] lg:h-[55px]" />
          )}
          {belowHeadline}
        </div>
        <div className={`flex flex-col gap-1 ${stack ? "mt-4" : ""}`}>
          {children ?? (
            <>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export default StatCardSkeleton;
