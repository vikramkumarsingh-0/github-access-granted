import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { MockSite } from "@/components/vision/MockSite";
import { TimelineFeed } from "@/components/vision/TimelineFeed";
import { VisualInspector } from "@/components/vision/VisualInspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCustomFlows } from "@/lib/admin-store";
import { buildMimicRun, describeAction, recordingToFlow, type RecordedAction } from "@/lib/recorder";
import { ELEMENT_BANK } from "@/lib/sandbox-run";
import type { StepEvent } from "@/lib/vision-types";

const TITLE = "Mimic sandbox — teach VisionBaseLLM by clicking";
const DESCRIPTION =
  "Click through a practice site yourself, then watch the VisionBaseLLM agent repeat your exact steps and save them as a reusable automation flow.";

export const Route = createFileRoute("/mimic")({
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
  component: MimicSandbox,
});

function MimicSandbox() {
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [flowName, setFlowName] = useState("My recorded flow");
  const [saved, setSaved] = useState<string | null>(null);
  const [customFlows, setCustomFlows] = useCustomFlows();
  const stopRef = useRef(false);

  const host = "practice.local";

  const addAction = useCallback((action: RecordedAction) => {
    setActions((prev) => [...prev, action]);
  }, []);

  const replay = useCallback(async () => {
    if (actions.length === 0) return;
    setEvents([]);
    setReplaying(true);
    stopRef.current = false;
    const timed = buildMimicRun(actions, host, ELEMENT_BANK);
    for (const frame of timed) {
      if (stopRef.current) break;
      await new Promise((resolve) => setTimeout(resolve, frame.delayMs));
      if (stopRef.current) break;
      setEvents((prev) => [...prev, frame.event]);
    }
    setReplaying(false);
  }, [actions]);

  const saveFlow = useCallback(() => {
    if (actions.length === 0) return;
    const flow = recordingToFlow(actions, flowName.trim() || "My recorded flow", `https://${host}`);
    setCustomFlows([...customFlows, flow]);
    setSaved(flow.name);
  }, [actions, flowName, customFlows, setCustomFlows]);

  const activeEvent = useMemo(() => {
    const withFrame = [...events].reverse().find((event) => event.elements?.length || event.page_mock);
    return withFrame ?? events[events.length - 1] ?? null;
  }, [events]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-4 py-5 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
            VisionBaseLLM · mimic sandbox
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Show it once, it does it forever
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Press record, click through the practice screens the way you want the work done, then hand it
            to the agent. It repeats your steps and you can save them as a reusable flow.
          </p>
        </div>
        <nav className="flex gap-2">
          <Link to="/" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Command center
          </Link>
          <Link to="/admin" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Admin
          </Link>
        </nav>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="panel flex flex-wrap items-center gap-2 p-3">
            <Button
              onClick={() => setRecording((prev) => !prev)}
              variant={recording ? "destructive" : "default"}
              className={recording ? "" : "glow-primary"}
            >
              {recording ? "Stop recording" : "Start recording"}
            </Button>
            <Button variant="outline" onClick={replay} disabled={replaying || actions.length === 0}>
              {replaying ? "Agent is mimicking…" : "Let the agent mimic me"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                stopRef.current = true;
                setActions([]);
                setEvents([]);
                setSaved(null);
              }}
            >
              Clear
            </Button>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {actions.length} step{actions.length === 1 ? "" : "s"} captured
            </span>
          </div>

          <MockSite host={host} recording={recording} onAction={addAction} />

          <VisualInspector event={activeEvent} showBoxes running={replaying} />
        </section>

        <section className="flex flex-col gap-4">
          <div className="panel p-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Your recording
            </h2>
            <ol className="mt-2 space-y-1.5">
              {actions.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  Nothing captured yet. Hit record and interact with the screens on the left.
                </li>
              )}
              {actions.map((action, index) => (
                <li key={action.id} className="rounded-md border border-border px-3 py-2 text-xs">
                  <span className="font-mono text-[11px] text-accent">{index + 1}.</span>{" "}
                  {describeAction(action)}
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {action.selector}
                  </span>
                </li>
              ))}
            </ol>

            {actions.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <Label htmlFor="flow-name" className="text-xs">
                  Save this as a flow
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="flow-name"
                    value={flowName}
                    onChange={(event) => setFlowName(event.target.value)}
                    className="text-xs"
                  />
                  <Button variant="outline" onClick={saveFlow}>
                    Save
                  </Button>
                </div>
                {saved && (
                  <p className="text-[11px] text-primary">
                    Saved “{saved}” — it now appears on the command center and in admin.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="min-h-[420px] flex-1">
            <TimelineFeed events={events} selectedIndex={null} onSelect={() => {}} />
          </div>
        </section>
      </div>
    </main>
  );
}
