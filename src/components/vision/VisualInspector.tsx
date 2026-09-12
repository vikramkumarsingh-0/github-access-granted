import { useMemo } from "react";

import type { DetectedElement, PageMock, StepEvent } from "@/lib/vision-types";
import { cn } from "@/lib/utils";

const VIEW_W = 1280;
const VIEW_H = 800;

interface Props {
  event: StepEvent | null;
  showBoxes: boolean;
  running: boolean;
}

export function VisualInspector({ event, showBoxes, running }: Props) {
  const elements = event?.elements ?? [];
  const page = event?.page_mock ?? null;
  const screenshot = event?.screenshot_b64 ?? null;

  const target = useMemo(() => elements.find((element) => element.target), [elements]);

  return (
    <div className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Live visual inspector
          </h2>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {event?.url ?? "awaiting target"}
        </p>
      </header>

      <div className="relative aspect-[16/10] w-full bg-secondary/40">
        {screenshot ? (
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt={`Captured page frame at step ${event?.step ?? 0}`}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <MockPage page={page} running={running} />
        )}

        {showBoxes && (
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="absolute inset-0 size-full"
            role="img"
            aria-label="Detected interactive elements overlay"
          >
            {elements.map((element) => (
              <BoundingBox key={element.id} element={element} />
            ))}
          </svg>
        )}

        {running && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/70 glow-primary scanning" />
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border px-4 py-2.5 font-mono text-xs">
        <span className="text-muted-foreground">
          detected <span className="text-foreground">{elements.length}</span>
        </span>
        <span className="text-muted-foreground">
          target{" "}
          <span className="text-primary">{target ? target.selector : "—"}</span>
        </span>
        {event?.action?.action && (
          <span className="text-muted-foreground">
            action <span className="text-accent">{event.action.action}</span>
          </span>
        )}
      </footer>
    </div>
  );
}

function BoundingBox({ element }: { element: DetectedElement }) {
  const [x, y, w, h] = element.bbox;
  const stroke = element.target ? "var(--color-primary)" : "var(--color-accent)";

  return (
    <g opacity={element.target ? 1 : 0.55}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={element.target ? "var(--color-primary)" : "transparent"}
        fillOpacity={element.target ? 0.08 : 0}
        stroke={stroke}
        strokeWidth={element.target ? 3 : 1.5}
        strokeDasharray={element.target ? undefined : "6 4"}
        rx={4}
      />
      <rect x={x} y={Math.max(0, y - 22)} width={Math.min(w, 260)} height={20} fill={stroke} rx={3} />
      <text
        x={x + 6}
        y={Math.max(0, y - 22) + 14}
        fontSize={12}
        fontFamily="var(--font-mono)"
        fill="var(--color-background)"
      >
        {element.label} · {(element.confidence * 100).toFixed(0)}%
      </text>
    </g>
  );
}

function MockPage({ page, running }: { page: PageMock | null; running: boolean }) {
  if (!page) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 text-center">
        <div className={cn("size-10 rounded-full border-2 border-dashed border-border", running && "scanning")} />
        <p className="max-w-xs text-sm text-muted-foreground">
          Set a target address and a goal, then start a run to watch the agent work.
        </p>
      </div>
    );
  }

  return (
    <div className="size-full bg-background/70 p-0">
      <div className="flex h-[8%] items-center gap-2 border-b border-border px-4">
        <span className="size-2 rounded-full bg-destructive/70" />
        <span className="size-2 rounded-full bg-chart-3/70" />
        <span className="size-2 rounded-full bg-primary/70" />
        <span className="ml-3 truncate font-mono text-[11px] text-muted-foreground">{page.host}</span>
      </div>
      <div className="flex h-[92%] flex-col items-center justify-center gap-3 px-10">
        <div className="h-3 w-40 rounded bg-muted" />
        <div className="h-3 w-64 rounded bg-muted/70" />
        <div className="mt-4 h-12 w-[55%] rounded-md border border-border bg-secondary/60" />
        <div className="h-12 w-[55%] rounded-md border border-border bg-secondary/60" />
        <div className="mt-2 h-11 w-[55%] rounded-md bg-primary/25" />
      </div>
    </div>
  );
}
