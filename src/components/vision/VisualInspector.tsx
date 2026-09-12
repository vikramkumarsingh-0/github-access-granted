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

function MockPage({
  page,
  running,
  elements,
}: {
  page: PageMock | null;
  running: boolean;
  elements: DetectedElement[];
}) {
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
    <div className="relative size-full bg-background/70">
      <div className="absolute inset-x-0 top-0 flex h-8 items-center gap-2 border-b border-border px-4">
        <span className="size-2 rounded-full bg-destructive/70" />
        <span className="size-2 rounded-full bg-chart-3/70" />
        <span className="size-2 rounded-full bg-primary/70" />
        <span className="ml-3 truncate font-mono text-[11px] text-muted-foreground">{page.host}</span>
      </div>

      {elements
        .filter((element) => element.label !== "nav")
        .map((element) => {
          const [x, y, w, h] = element.bbox;
          const isButton = element.label === "button" || element.label === "badge";
          return (
            <div
              key={`mock-${element.id}`}
              className={cn(
                "absolute flex items-center overflow-hidden rounded-md border px-3",
                isButton
                  ? "justify-center border-primary/30 bg-primary/20 text-xs font-medium"
                  : "border-border bg-secondary/60 text-xs text-muted-foreground",
              )}
              style={{
                left: `${(x / VIEW_W) * 100}%`,
                top: `${(y / VIEW_H) * 100}%`,
                width: `${(w / VIEW_W) * 100}%`,
                height: `${(h / VIEW_H) * 100}%`,
              }}
            >
              <span className="truncate">{element.text ?? ""}</span>
            </div>
          );
        })}
    </div>
  );
}
