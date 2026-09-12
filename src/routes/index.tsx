import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FlowPicker } from "@/components/vision/FlowPicker";
import { TimelineFeed } from "@/components/vision/TimelineFeed";
import { VisualInspector } from "@/components/vision/VisualInspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveFlows, useCustomFlows, useRunHistory, useSettings } from "@/lib/admin-store";
import { compileFlow, defaultValues, type FlowDefinition } from "@/lib/flows";
import { BROWSERS, REASONERS, type RunConfig, type StepEvent } from "@/lib/vision-types";

const TITLE = "VisionBaseLLM — Visual Browser Automation Command Center";
const DESCRIPTION =
  "Run, watch and audit a vision-driven browser agent: ready-made flows for sign-in, forms and clicks, live bounding boxes and a full execution timeline.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommandCenter,
});

function CommandCenter() {
  const [settings] = useSettings();
  const [customFlows] = useCustomFlows();
  const { history, append } = useRunHistory();

  const flows = useMemo(() => resolveFlows(customFlows, settings), [customFlows, settings]);

  const [flowId, setFlowId] = useState<string | null>("login");
  const [flowValues, setFlowValues] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<RunConfig>({
    url: "https://practice.expandtesting.com/login",
    task: "Log in with the demo account and confirm the session banner",
    browser: "chromium",
    reasoner: "gateway-astra",
    headless: true,
    maxSteps: 12,
  });

  const [events, setEvents] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [followLive, setFollowLive] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);

  // Adopt admin defaults once they are read from storage.
  useEffect(() => {
    setConfig((prev) => ({
      ...prev,
      browser: settings.defaultBrowser,
      reasoner: settings.defaultReasoner,
      headless: settings.headless,
      maxSteps: settings.maxSteps,
    }));
    setShowBoxes(settings.showBoxes);
  }, [settings]);

  // Keep the task text in sync with the selected flow.
  useEffect(() => {
    const flow = flows.find((item) => item.id === flowId);
    if (!flow) return;
    const values = Object.keys(flowValues).length ? flowValues : defaultValues(flow);
    const compiled = compileFlow(flow, values);
    setConfig((prev) => ({ ...prev, task: compiled.task, maxSteps: compiled.maxSteps }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, flowValues]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectFlow = useCallback((flow: FlowDefinition | null) => {
    if (!flow) {
      setFlowId(null);
      setFlowValues({});
      return;
    }
    setFlowId(flow.id);
    setFlowValues(defaultValues(flow));
    setConfig((prev) => ({ ...prev, url: flow.defaultUrl }));
  }, []);

  const activeEvent = useMemo(() => {
    if (events.length === 0) return null;
    if (!followLive && selected !== null) return events[selected] ?? null;
    const withFrame = [...events].reverse().find((event) => event.elements?.length || event.page_mock);
    return withFrame ?? events[events.length - 1]!;
  }, [events, followLive, selected]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setEvents([]);
    setSelected(null);
    setFollowLive(true);

    if (!config.url.trim() || !config.task.trim()) {
      setError("Add a target address and describe what the agent should do.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    startedAtRef.current = Date.now();

    const params = new URLSearchParams({
      url: config.url.trim(),
      task: config.task.trim(),
      browser: config.browser,
      reasoner: config.reasoner,
      maxSteps: String(config.maxSteps),
      ...(flowId ? { flow: flowId } : {}),
      ...(settings.allowLiveRuns ? {} : { sandbox: "1" }),
    });

    const collected: StepEvent[] = [];

    try {
      const response = await fetch(`/api/agent-stream?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `The agent service replied ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((part) => part.startsWith("data:"));
          if (!line) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "{}") continue;
          try {
            const event = JSON.parse(raw) as StepEvent;
            collected.push(event);
            setEvents((prev) => [...prev, event]);
            if (settings.stopOnFirstError && event.phase === "error") {
              controller.abort();
            }
          } catch {
            // ignore malformed frames
          }
        }
      }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setError((cause as Error).message);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      if (collected.length > 0) {
        const last = collected[collected.length - 1]!;
        append(
          {
            runId: last.run_id,
            startedAt: startedAtRef.current,
            config,
            events: collected,
            outcome: last.phase === "error" ? "failure" : "success",
            durationMs: Date.now() - startedAtRef.current,
            source: last.source ?? "sandbox",
          },
          settings.historyLimit,
        );
      }
    }
  }, [config, flowId, settings, append]);

  const stats = useMemo(() => {
    const actions = events.filter((event) => event.phase === "act").length;
    const detections = events.reduce((sum, event) => sum + (event.elements?.length ?? 0), 0);
    const verified = events.filter((event) => event.phase === "verify" && event.status === "success").length;
    const elapsed = events.reduce((sum, event) => sum + (event.duration_ms ?? 0), 0);
    return { actions, detections, verified, elapsed };
  }, [events]);

  const mode = events[0]?.source === "live" ? "live backend" : "sandbox";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-4 py-5 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
            VisionBaseLLM · v3
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Visual browser automation command center
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The agent looks at the page, decides the next move, clicks it, then checks whether it
            worked — and you see every one of those moments as it happens.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
            mode: <span className="text-accent">{mode}</span>
          </span>
          <Link to="/mimic" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Mimic sandbox
          </Link>
          <Link to="/admin" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Admin
          </Link>
          <Link to="/agent-code" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Agent source
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)_380px]">
        {/* config */}
        <section className="panel flex flex-col gap-4 p-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Automation flow
          </h2>

          <FlowPicker
            flows={flows}
            activeId={flowId}
            values={flowValues}
            onSelect={selectFlow}
            onValueChange={(key, value) => setFlowValues((prev) => ({ ...prev, [key]: value }))}
          />

          <div className="space-y-1.5">
            <Label htmlFor="target-url">Target address</Label>
            <Input
              id="target-url"
              value={config.url}
              onChange={(event) => setConfig((prev) => ({ ...prev, url: event.target.value }))}
              placeholder="https://example.com"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal">Instructions sent to the agent</Label>
            <Textarea
              id="goal"
              rows={4}
              value={config.task}
              onChange={(event) => setConfig((prev) => ({ ...prev, task: event.target.value }))}
              placeholder="Search for wireless headphones, then open the cheapest result"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Browser</Label>
              <Select
                value={config.browser}
                onValueChange={(value) =>
                  setConfig((prev) => ({ ...prev, browser: value as RunConfig["browser"] }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BROWSERS.map((browser) => (
                    <SelectItem key={browser} value={browser}>{browser}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-steps">Step budget</Label>
              <Input
                id="max-steps"
                type="number"
                min={1}
                max={25}
                value={config.maxSteps}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, maxSteps: Number(event.target.value) || 1 }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reasoning model</Label>
            <Select
              value={config.reasoner}
              onValueChange={(value) => setConfig((prev) => ({ ...prev, reasoner: value }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONERS.map((reasoner) => (
                  <SelectItem key={reasoner.id} value={reasoner.id}>{reasoner.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="headless" className="text-sm font-normal">Headless browser</Label>
            <Switch
              id="headless"
              checked={config.headless}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, headless: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="boxes" className="text-sm font-normal">Show detection boxes</Label>
            <Switch id="boxes" checked={showBoxes} onCheckedChange={setShowBoxes} />
          </div>

          <div className="flex gap-2">
            <Button onClick={start} disabled={running} className="flex-1 glow-primary">
              {running ? "Running…" : "Start run"}
            </Button>
            <Button variant="outline" onClick={stop} disabled={!running}>
              Stop
            </Button>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </section>

        {/* inspector + metrics */}
        <section className="flex min-w-0 flex-col gap-4">
          <VisualInspector event={activeEvent} showBoxes={showBoxes} running={running} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Actions taken" value={stats.actions} />
            <Metric label="Elements seen" value={stats.detections} />
            <Metric label="Checks passed" value={stats.verified} accent />
            <Metric label="Agent time" value={`${(stats.elapsed / 1000).toFixed(1)}s`} />
          </div>

          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Current reasoning
              </h2>
              {selected !== null && (
                <button
                  type="button"
                  className="font-mono text-[11px] text-accent hover:underline"
                  onClick={() => { setFollowLive(true); setSelected(null); }}
                >
                  follow live
                </button>
              )}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/85">
              {activeEvent?.reasoning ??
                "Once a run starts, the agent's own explanation for each move appears here in plain language."}
            </p>
            {activeEvent?.action?.selector && (
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs text-accent">
{JSON.stringify(activeEvent.action, null, 2)}
              </pre>
            )}
          </div>
        </section>

        {/* timeline + history */}
        <section className="flex min-h-[560px] flex-col gap-4">
          <div className="min-h-0 flex-1">
            <TimelineFeed
              events={events}
              selectedIndex={selected}
              onSelect={(index) => { setSelected(index); setFollowLive(false); }}
            />
          </div>

          <div className="panel p-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Run history
            </h2>
            <ul className="mt-2 space-y-2">
              {history.length === 0 && (
                <li className="text-xs text-muted-foreground">No completed runs yet.</li>
              )}
              {history.slice(0, 8).map((record) => (
                <li
                  key={`${record.runId}-${record.startedAt}`}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-foreground">{record.config.task}</span>
                    <span
                      className={
                        record.outcome === "success"
                          ? "font-mono text-[11px] text-primary"
                          : "font-mono text-[11px] text-destructive"
                      }
                    >
                      {record.outcome}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {record.events.length} events · {(record.durationMs / 1000).toFixed(1)}s ·{" "}
                    {record.config.browser}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="panel px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className={accent ? "mt-1 text-2xl font-semibold text-primary" : "mt-1 text-2xl font-semibold"}>
        {value}
      </p>
    </div>
  );
}
