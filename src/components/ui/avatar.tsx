import { cn } from "@/lib/utils"

/**
 * A deliberately small avatar: initials in a circle. The recovered design used
 * a full Radix avatar with an image slot, but nothing in the app loads member
 * photos yet and the member portal is milestone M3.
 */
export function Avatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  )
}
