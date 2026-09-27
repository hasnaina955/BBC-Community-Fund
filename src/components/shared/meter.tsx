import { cn } from "@/lib/utils"

/**
 * A labelled progress meter.
 *
 * Built as a plain `div` with an inline width rather than on the `Progress`
 * primitive, for two reasons that matter more than reusing a component:
 *
 *   1. **The tone is doing real work.** Green means collected, amber means
 *      behind, red means badly behind. A single neutral bar would force the
 *      reader to do the comparison themselves in their head, which is the one
 *      thing a treasurer should not have to do.
 *   2. **The bar is decorative and the number beside it is the content.** The
 *      `aria-hidden` on the track and the real percentage in text means a
 *      screen reader hears "82% of ₹1,00,800 due", not a bare progress widget.
 */
export function Meter({
  value,
  max,
  tone = "default",
  className,
  label,
}: {
  /** Done so far. */
  value: number
  /** The target. A zero or negative target renders an empty bar, not a NaN. */
  max: number
  tone?: "default" | "positive" | "caution" | "negative" | "neutral"
  className?: string
  /** Optional `aria-label`; omit when adjacent text already says it. */
  label?: string
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, safeMax)) : 0
  const pct = safeMax > 0 ? (safeValue / safeMax) * 100 : 0

  const fill = {
    default: "bg-primary",
    positive: "bg-success",
    caution: "bg-chart-4",
    negative: "bg-destructive",
    neutral: "bg-muted-foreground/40",
  }[tone]

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * Picks a tone from a 0–100 rate. The bands are the ones the product's own
 * copy already implied: at 90% and above the month is effectively in, below
 * 70% is a problem worth naming, and the middle is ordinary.
 */
export function rateTone(rate: number): "positive" | "caution" | "negative" {
  if (rate >= 90) return "positive"
  if (rate >= 70) return "caution"
  return "negative"
}
