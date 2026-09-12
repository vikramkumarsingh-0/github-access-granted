import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AGENT_SOURCES } from "@/lib/agent-sources";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TITLE = "Agent Source — VisionBaseLLM Python Core";
const DESCRIPTION =
  "Read and download the completed VisionBaseLLM Python files: the perceive-plan-act-verify agent loop, the multimodal reasoner, the task planner and the streaming FastAPI service.";

export const Route = createFileRoute("/agent-code")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentCodePage,
});

function AgentCodePage() {
  const [active, setActive] = useState(AGENT_SOURCES[0]!);

  const { data, isPending, isError } = useQuery({
    queryKey: ["agent-source", active.file],
    queryFn: async () => {
      const response = await fetch(active.path);
      if (!response.ok) throw new Error("Could not load that file");
      return response.text();
    },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-5 px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
            Python core
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Agent source files</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            These four files complete the automation engine. Copy each one into your repository at
            the path shown, then run the service and switch this dashboard to live mode.
          </p>
        </div>
        <Link to="/" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
          Back to command center
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-2">
          {AGENT_SOURCES.map((source) => (
            <button
              key={source.file}
              type="button"
              onClick={() => setActive(source)}
              className={cn(
                "panel px-4 py-3 text-left transition-colors hover:bg-secondary/60",
                active.file === source.file && "glow-primary",
              )}
            >
              <span className="block text-sm font-medium">{source.title}</span>
              <span className="mt-0.5 block font-mono text-[11px] text-accent">
                {source.destination}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{source.summary}</span>
            </button>
          ))}
        </nav>

        <section className="panel flex min-h-[60vh] flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="font-mono text-xs text-muted-foreground">{active.destination}</p>
            <Button asChild size="sm" variant="outline">
              <a href={active.path} download={active.file}>
                Download file
              </a>
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            {isPending && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {isError && <p className="p-4 text-sm text-destructive">That file could not be loaded.</p>}
            {data && (
              <pre className="p-4 font-mono text-xs leading-relaxed text-foreground/85">
                <code>{data}</code>
              </pre>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
