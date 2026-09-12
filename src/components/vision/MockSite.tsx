import { useState } from "react";

import { ELEMENT_BANK } from "@/lib/sandbox-run";
import type { RecordedAction } from "@/lib/recorder";
import type { DetectedElement, PageMock } from "@/lib/vision-types";

const PAGES: { kind: PageMock["kind"]; label: string }[] = [
  { kind: "login", label: "Sign in" },
  { kind: "search", label: "Search" },
  { kind: "results", label: "Results" },
  { kind: "cart", label: "Product" },
  { kind: "confirmation", label: "Confirmation" },
];

const VIEWPORT_W = 1280;
const VIEWPORT_H = 620;

export function MockSite({
  host,
  recording,
  onAction,
}: {
  host: string;
  recording: boolean;
  onAction: (action: RecordedAction) => void;
}) {
  const [page, setPage] = useState<PageMock["kind"]>("login");
  const [values, setValues] = useState<Record<string, string>>({});

  const elements = ELEMENT_BANK[page];

  const record = (element: DetectedElement, kind: RecordedAction["kind"], value?: string) => {
    if (!recording) return;
    onAction({
      id: `${Date.now()}-${element.id}`,
      at: Date.now(),
      kind,
      label: element.text ?? element.selector,
      selector: element.selector,
      value,
      pageKind: page,
      bbox: element.bbox,
    });
  };

  const isField = (element: DetectedElement) => element.label === "input";
  const isSelect = (element: DetectedElement) => element.label === "select";

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="rounded bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {host}/{page}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          {PAGES.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => {
                setPage(item.kind);
                if (recording) {
                  onAction({
                    id: `${Date.now()}-nav-${item.kind}`,
                    at: Date.now(),
                    kind: "navigate",
                    label: `the ${item.label.toLowerCase()} screen`,
                    selector: `page:${item.kind}`,
                    pageKind: item.kind,
                    bbox: [0, 0, 0, 0],
                  });
                }
              }}
              className={
                page === item.kind
                  ? "rounded border border-primary/60 bg-primary/15 px-2 py-1 font-mono text-[11px] text-primary"
                  : "rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-secondary"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full bg-secondary/30" style={{ aspectRatio: `${VIEWPORT_W} / ${VIEWPORT_H}` }}>
        {elements.map((element) => {
          const [x, y, w, h] = element.bbox;
          const style = {
            left: `${(x / VIEWPORT_W) * 100}%`,
            top: `${(y / VIEWPORT_H) * 100}%`,
            width: `${(w / VIEWPORT_W) * 100}%`,
            height: `${(h / VIEWPORT_H) * 100}%`,
          } as const;
          const key = `${page}:${element.selector}`;

          if (isField(element)) {
            return (
              <input
                key={element.id}
                style={style}
                className="absolute rounded-md border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary"
                placeholder={element.text ?? "Type here"}
                value={values[key] ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
                onBlur={(event) => {
                  if (event.target.value) record(element, "type", event.target.value);
                }}
              />
            );
          }

          if (isSelect(element)) {
            return (
              <select
                key={element.id}
                style={style}
                className="absolute rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary"
                value={values[key] ?? ""}
                onChange={(event) => {
                  setValues((prev) => ({ ...prev, [key]: event.target.value }));
                  record(element, "select", event.target.value);
                }}
              >
                <option value="">{element.text ?? "Choose"}</option>
                <option value="Option A">Option A</option>
                <option value="Option B">Option B</option>
              </select>
            );
          }

          return (
            <button
              key={element.id}
              type="button"
              style={style}
              onClick={() => record(element, "click")}
              className="absolute rounded-md border border-border/80 bg-card/80 px-2 text-left text-xs text-foreground/90 transition-colors hover:border-primary hover:bg-primary/10"
            >
              <span className="line-clamp-1 font-mono text-[11px]">
                {element.text ?? element.selector}
              </span>
            </button>
          );
        })}

        {recording && (
          <span className="absolute right-3 top-3 flex items-center gap-2 rounded-full border border-destructive/60 bg-destructive/15 px-3 py-1 font-mono text-[11px] text-destructive">
            <span className="size-2 animate-pulse rounded-full bg-destructive" /> recording
          </span>
        )}
      </div>
    </div>
  );
}
