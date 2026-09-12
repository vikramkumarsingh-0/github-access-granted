import { useEffect, useRef } from "react";

import type { StepEvent, StepPhase } from "@/lib/vision-types";
import { cn } from "@/lib/utils";

const PHASE_STYLE: Record<StepPhase, { label: string; className: string }> = {
  plan: { label: "PLAN", className: "text-chart-4 border-chart-4/40 bg-chart-4/10" },
  perceive: { label: "SEE", className: "text-accent border-accent/40 bg-accent/10" },
  reason: { label: "THINK", className: "text-chart-3 border-chart-3/40 bg-chart-3/10" },
  act: { label: "ACT", className: "text-primary border-primary/40 bg-primary/10" },
  verify: { label: "CHECK", className: "text-chart-2 border-chart-2/40 bg-chart-2/10" },
  done: { label: "DONE", className: "text-primary border-primary/50 bg-primary/15" },
  error: { label: "FAIL", className: "text-destructive border-destructive/50 bg-destructive/10" },
};

export function TimelineFeed({
  events,
  selectedIndex,
  onSelect,
}: {
  events: StepEvent[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Execution timeline
        </h2>
        <span className="font-mono text-xs text-muted-foreground">{events.length} events</span>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto p-2">
        {events.length === 0 && (
          <li className="px-3 py-6 text-sm text-muted-foreground">
            Nothing yet. Every thing the agent sees, thinks and does will appear here.
          </li>
        )}
        {events.map((event, index) => {
          // A live backend can send a phase this UI doesn't know yet — show it plainly
          // instead of crashing the feed.
          const style = PHASE_STYLE[event.phase] ?? {
            label: String(event.phase ?? "step").toUpperCase().slice(0, 8),
            className: "text-muted-foreground border-border bg-secondary/60",
          };
          return (
            <li key={`${event.step}-${event.phase}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                className={cn(
                  "w-full rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:bg-secondary/60",
                  selectedIndex === index && "border-border bg-secondary/80",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider",
                      style.className,
                    )}
                  >
                    {style.label}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    step {event.step}
                  </span>
                  {typeof event.duration_ms === "number" && (
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {event.duration_ms} ms
                    </span>
                  )}
                </div>
                {event.sub_goal && (
                  <p className="mt-1 truncate text-xs text-foreground/80">{event.sub_goal}</p>
                )}
                {event.reasoning && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{event.reasoning}</p>
                )}
                {event.action?.selector && (
                  <p className="mt-1 truncate font-mono text-[11px] text-accent">
                    {event.action.action} → {event.action.selector}
                    {event.action.value ? ` "${event.action.value}"` : ""}
                  </p>
                )}
                {event.error && (
                  <p className="mt-1 text-xs text-destructive">{event.error}</p>
                )}
              </button>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>
    </div>
  );
}
