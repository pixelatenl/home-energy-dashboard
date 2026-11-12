import { useEffect, useState } from "react";
import type { AiContextValue } from "@/lib/useAiContext";
import type { ContextBoxItem } from "@/lib/contextBoxes";
import { humanizeEurInText } from "@/lib/advisoryText";
import { isDataStale, localTimeOf, snapshotAgeMs } from "@/lib/time";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";

// The insight metadata furniture every AI box shares: the
// insight-from timestamp ("Insight from HH:MM", rendered from the
// server's stamp at local time) and the stale marker once the stamp
// passes DATA_STALE_AFTER_MS. The age re-evaluates on a 30-second tick
// without any refetch. There is deliberately no per-box refresh
// control: the header's shared refresh button regenerates every
// insight at once.
function InsightMeta({ generatedAt }: { generatedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (generatedAt === null) return null;
  const ageMs = snapshotAgeMs(generatedAt, now);
  if (ageMs === null) return null;
  const stale = isDataStale(ageMs);
  return (
    <p
      className={`mt-2 text-xs ${
        stale ? "text-amber-300 dark:text-amber-200" : "text-subtle-foreground"
      }`}
    >
      {`Insight from ${localTimeOf(generatedAt)}${stale ? " (stale)" : ""}`}
    </p>
  );
}

// Insight box shared by the weather and battery widgets:
// the advisory panel's own surface in miniature - the dark-to-warm
// AI gradient under the app's glass pane (blur, saturation, top
// seam), the nested inset rounding and the card elevation, no
// border - so the quiet text sits on the same dark backing the
// advisory panel gives its rows. When no text is available (API
// failure or daily limit reached) the box renders nothing at all -
// except when the daily AI limit is the reason, which is explained
// in a quiet note; the placeholder reserves roughly the final height
// so loading causes no layout shift.
function AIContextBox({ text, error, loading, generatedAt }: AiContextValue) {
  // The glass shell with the shared Skeleton lines inside - the
  // shell itself does not pulse - reserving the loaded box's height.
  // The reveal sits in the same tree position for every branch, so
  // the skeleton cross-fades into the text (or the honest empty
  // states) instead of swapping in one frame.
  const skeleton = (
    <div
      className="glass-card glass-inset h-24 rounded-inset bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 shadow-card"
      aria-busy="true"
    >
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="mt-2 h-3.5 w-3/4" />
    </div>
  );

  const limitReached = error === "daily_limit_reached";

  // No text: the honest empty states (nothing at all, or the daily
  // limit note) fade in like content once the loading ends.
  if (!text) {
    return (
      <SkeletonReveal loading={loading} skeleton={skeleton}>
        {limitReached ? (
          <p className="text-xs text-muted-foreground">
            Insights paused (daily AI limit reached); it resumes after
            midnight UTC
          </p>
        ) : null}
      </SkeletonReveal>
    );
  }

  return (
    <SkeletonReveal loading={false} skeleton={skeleton}>
      <div className="glass-card glass-inset min-h-24 rounded-inset bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-muted-foreground shadow-card">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Insights
        </span>
        <p className="mt-2 text-sm leading-relaxed">
          {/* The server may compose prices at payload precision (EUR
            0.267/kWh); every displayed price reads at two decimals,
            the human register. */}
          {humanizeEurInText(text)}
        </p>
        <InsightMeta generatedAt={generatedAt} />
        {limitReached && (
          <p className="mt-2 text-xs text-subtle-foreground">
            Live updates paused (daily AI limit reached); the insight may lag
          </p>
        )}
      </div>
    </SkeletonReveal>
  );
}

export default AIContextBox;

// One section's context box, wired to the page's single payload fetch:
// the page passes the section's item from contextBoxItems and the box
// renders the shared furniture. An absent section (no facts for the
// anchored period) renders nothing at all - honest absence, never an
// empty box.
export function AIContextSectionBox({
  item,
  loading,
  generatedAt,
  error,
}: {
  item: ContextBoxItem | null
  loading: boolean
  generatedAt: string | null
  error: string | null
}) {
  if (item === null) return null;
  return (
    <AIContextBox
      text={item.text}
      error={error}
      loading={loading}
      generatedAt={generatedAt}
    />
  );
}
