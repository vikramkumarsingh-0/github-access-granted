import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, type FlowDefinition } from "@/lib/flows";

export function FlowPicker({
  flows,
  activeId,
  values,
  onSelect,
  onValueChange,
}: {
  flows: FlowDefinition[];
  activeId: string | null;
  values: Record<string, string>;
  onSelect: (flow: FlowDefinition | null) => void;
  onValueChange: (key: string, value: string) => void;
}) {
  const active = flows.find((flow) => flow.id === activeId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={chip(activeId === null)}
        >
          Free-form
        </button>
        {flows.map((flow) => (
          <button key={flow.id} type="button" onClick={() => onSelect(flow)} className={chip(activeId === flow.id)}>
            {flow.name}
          </button>
        ))}
      </div>

      {active && (
        <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
              {CATEGORY_LABEL[active.category]}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>
          </div>

          {active.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`flow-${field.key}`} className="text-xs">
                {field.label}
              </Label>
              {field.key === "fields" ? (
                <Textarea
                  id={`flow-${field.key}`}
                  rows={3}
                  value={values[field.key] ?? ""}
                  onChange={(event) => onValueChange(field.key, event.target.value)}
                  className="font-mono text-xs"
                />
              ) : (
                <Input
                  id={`flow-${field.key}`}
                  type={field.type ?? "text"}
                  value={values[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onValueChange(field.key, event.target.value)}
                  className="font-mono text-xs"
                />
              )}
            </div>
          ))}

          <ol className="space-y-1 border-t border-border pt-2">
            {active.steps.map((step, index) => (
              <li key={step} className="font-mono text-[11px] text-muted-foreground">
                {index + 1}. {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function chip(activeState: boolean) {
  return activeState
    ? "rounded-full border border-primary/60 bg-primary/15 px-3 py-1 text-xs text-primary"
    : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary";
}
