import { cn } from "@/lib/utils";

/**
 * Vertical hairlines with a radial fade, drawn as real geometry so they line up
 * with the section's content grid instead of tiling behind it.
 */
export function ColumnLines({
  className,
  columnWidth = 88,
}: {
  className?: string;
  columnWidth?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{
        maskImage: "radial-gradient(ellipse 62% 68% at 50% 42%, black 20%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 62% 68% at 50% 42%, black 20%, transparent 100%)",
      }}
    >
      <div className="flex h-full w-full justify-center">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="h-full shrink-0 border-l border-docid-border/70"
            style={{ width: columnWidth }}
          />
        ))}
      </div>
    </div>
  );
}

export default ColumnLines;
