import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface BlockKind {
  id: string;
  label: string;
  template: string;
  hint: string;
}

/** The building blocks a person can drag into a flow. */
export const BLOCK_KINDS: BlockKind[] = [
  { id: "open", label: "Open", template: "Open the sign-in form", hint: "Open a page or panel" },
  { id: "type", label: "Type", template: "Type {{value}} into the email field", hint: "Fill a field" },
  { id: "click", label: "Click", template: "Click the Submit button", hint: "Press a button or link" },
  { id: "choose", label: "Choose", template: "Choose Large from the size options", hint: "Pick an option" },
  { id: "wait", label: "Wait", template: "Wait for the page to settle", hint: "Pause until loaded" },
  { id: "read", label: "Read", template: "Read the order total and report it back", hint: "Collect data" },
  { id: "check", label: "Check", template: "Confirm the page shows Welcome back", hint: "Verify the result" },
];

interface FlowBuilderProps {
  steps: string[];
  onChange: (steps: string[]) => void;
}

/** Drag blocks from the palette into the canvas, then drag them around to reorder. */
export function FlowBuilder({ steps, onChange }: FlowBuilderProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const insertAt = (index: number, text: string) => {
    const next = [...steps];
    next.splice(index, 0, text);
    onChange(next);
  };

  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, item!);
    onChange(next);
  };

  const handleDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    setOverIndex(null);
    const blockId = event.dataTransfer.getData("application/x-block");
    if (blockId) {
      const block = BLOCK_KINDS.find((item) => item.id === blockId);
      if (block) insertAt(index, block.template);
      return;
    }
    if (dragFrom !== null) moveTo(dragFrom, index);
    setDragFrom(null);
  };

  const allowDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    setOverIndex(index);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Blocks
        </p>
        {BLOCK_KINDS.map((block) => (
          <div
            key={block.id}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("application/x-block", block.id)}
            onDoubleClick={() => insertAt(steps.length, block.template)}
            className="cursor-grab rounded-md border border-border bg-secondary/40 px-3 py-2 active:cursor-grabbing"
          >
            <p className="text-sm font-medium">{block.label}</p>
            <p className="text-[11px] text-muted-foreground">{block.hint}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Flow · {steps.length} steps
        </p>

        <div
          onDragOver={allowDrop(0)}
          onDrop={handleDrop(0)}
          className={
            overIndex === 0
              ? "h-2 rounded bg-primary/60"
              : "h-2 rounded bg-transparent"
          }
        />

        {steps.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Drag a block here (or double-click one) to start building.
          </p>
        )}

        {steps.map((step, index) => (
          <div key={index}>
            <div
              draggable
              onDragStart={() => setDragFrom(index)}
              onDragEnd={() => setDragFrom(null)}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="cursor-grab font-mono text-[11px] text-muted-foreground active:cursor-grabbing">
                ⠿ {index + 1}
              </span>
              <Input
                value={step}
                onChange={(event) => {
                  const next = [...steps];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                className="h-8 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(steps.filter((_, item) => item !== index))}
              >
                Remove
              </Button>
            </div>
            <div
              onDragOver={allowDrop(index + 1)}
              onDrop={handleDrop(index + 1)}
              className={
                overIndex === index + 1
                  ? "mt-1 h-2 rounded bg-primary/60"
                  : "mt-1 h-2 rounded bg-transparent"
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
