import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SETTINGS,
  allFlows,
  useCustomFlows,
  useRunHistory,
  useSettings,
} from "@/lib/admin-store";
import { CATEGORY_LABEL } from "@/lib/flows";
import { BROWSERS, REASONERS, type RunConfig } from "@/lib/vision-types";

const TITLE = "VisionBaseLLM admin — control every run, flow and backend";
const DESCRIPTION =
  "Admin control panel for VisionBaseLLM: backend health, default run settings, the automation flow library, and the full run audit log.";

export const Route = createFileRoute("/admin")({
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
  component: AdminPanel,
});

interface AgentStatus {
  configured: boolean;
  healthy: boolean;
  mode: string;
  version?: string | null;
  error?: string;
}

function AdminPanel() {
  const [settings, setSettings] = useSettings();
  const [customFlows, setCustomFlows] = useCustomFlows();
  const { history, clear } = useRunHistory();
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent-status")
      .then((response) => response.json() as Promise<AgentStatus>)
      .then((payload) => {
        if (!cancelled) setStatus(payload);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, healthy: false, mode: "sandbox" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flows = useMemo(() => allFlows(customFlows), [customFlows]);

  const totals = useMemo(() => {
    const success = history.filter((record) => record.outcome === "success").length;
    const duration = history.reduce((sum, record) => sum + record.durationMs, 0);
    return {
      runs: history.length,
      success,
      rate: history.length ? Math.round((success / history.length) * 100) : 0,
      avg: history.length ? duration / history.length / 1000 : 0,
    };
  }, [history]);

  const toggleFlow = (id: string) => {
    const disabled = settings.disabledFlowIds.includes(id)
      ? settings.disabledFlowIds.filter((item) => item !== id)
      : [...settings.disabledFlowIds, id];
    setSettings({ ...settings, disabledFlowIds: disabled });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-4 px-4 py-5 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
            VisionBaseLLM · admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Control panel</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everything that decides how a run behaves — the connection, the defaults, the flow library
            and the audit log — lives here.
          </p>
        </div>
        <nav className="flex gap-2">
          <Link to="/" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Command center
          </Link>
          <Link to="/automations" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Scheduled runs
          </Link>
          <Link to="/mimic" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Mimic sandbox
          </Link>
          <Link to="/agent-code" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Agent source
          </Link>
        </nav>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Stat label="Runs recorded" value={totals.runs} />
        <Stat label="Successful" value={`${totals.rate}%`} accent />
        <Stat label="Average length" value={`${totals.avg.toFixed(1)}s`} />
        <div className="panel px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Automation engine
          </p>
          <p className="mt-1 text-lg font-semibold">
            {status === null
              ? "checking…"
              : status.healthy
                ? "live backend"
                : status.configured
                  ? "unreachable"
                  : "built-in demo"}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {status?.version ? `agent v${status.version}` : status?.error ?? "no external agent connected"}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="panel flex flex-col gap-4 p-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Run defaults
          </h2>

          <div className="space-y-1.5">
            <Label>Browser</Label>
            <Select
              value={settings.defaultBrowser}
              onValueChange={(value) =>
                setSettings({ ...settings, defaultBrowser: value as RunConfig["browser"] })
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
            <Label>Reasoning model</Label>
            <Select
              value={settings.defaultReasoner}
              onValueChange={(value) => setSettings({ ...settings, defaultReasoner: value })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONERS.map((reasoner) => (
                  <SelectItem key={reasoner.id} value={reasoner.id}>{reasoner.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-steps">Step budget</Label>
              <Input
                id="admin-steps"
                type="number"
                min={1}
                max={25}
                value={settings.maxSteps}
                onChange={(event) =>
                  setSettings({ ...settings, maxSteps: Number(event.target.value) || 1 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-history">History kept</Label>
              <Input
                id="admin-history"
                type="number"
                min={1}
                max={100}
                value={settings.historyLimit}
                onChange={(event) =>
                  setSettings({ ...settings, historyLimit: Number(event.target.value) || 1 })
                }
              />
            </div>
          </div>

          <Toggle
            id="admin-headless"
            label="Headless browser"
            checked={settings.headless}
            onChange={(checked) => setSettings({ ...settings, headless: checked })}
          />
          <Toggle
            id="admin-boxes"
            label="Show detection boxes"
            checked={settings.showBoxes}
            onChange={(checked) => setSettings({ ...settings, showBoxes: checked })}
          />
          <Toggle
            id="admin-stop"
            label="Stop a run on the first error"
            checked={settings.stopOnFirstError}
            onChange={(checked) => setSettings({ ...settings, stopOnFirstError: checked })}
          />
          <Toggle
            id="admin-live"
            label="Allow live backend runs"
            checked={settings.allowLiveRuns}
            onChange={(checked) => setSettings({ ...settings, allowLiveRuns: checked })}
          />

          <Button variant="outline" onClick={() => setSettings(DEFAULT_SETTINGS)}>
            Reset to defaults
          </Button>
        </section>

        <div className="flex flex-col gap-4">
          <section className="panel p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Flow library
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {flows.length - settings.disabledFlowIds.length}/{flows.length} enabled
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {flows.map((flow) => {
                const disabled = settings.disabledFlowIds.includes(flow.id);
                return (
                  <li
                    key={flow.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {flow.name}{" "}
                        <span className="font-mono text-[11px] text-accent">
                          {CATEGORY_LABEL[flow.category]}
                        </span>
                        {!flow.builtIn && (
                          <span className="ml-2 font-mono text-[11px] text-primary">recorded</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{flow.description}</p>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {flow.steps.length} steps
                    </span>
                    <Switch checked={!disabled} onCheckedChange={() => toggleFlow(flow.id)} />
                    {!flow.builtIn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCustomFlows(customFlows.filter((item) => item.id !== flow.id))}
                      >
                        Delete
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Audit log
              </h2>
              <Button variant="ghost" size="sm" onClick={clear} disabled={history.length === 0}>
                Clear
              </Button>
            </div>
            <ul className="mt-3 space-y-2">
              {history.length === 0 && (
                <li className="text-xs text-muted-foreground">No runs recorded yet.</li>
              )}
              {history.map((record) => (
                <li key={`${record.runId}-${record.startedAt}`} className="rounded-md border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="truncate text-xs">{record.config.task}</span>
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
                    {new Date(record.startedAt).toLocaleString()} · {record.events.length} events ·{" "}
                    {(record.durationMs / 1000).toFixed(1)}s · {record.config.browser} · {record.source}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="panel px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={accent ? "mt-1 text-2xl font-semibold text-primary" : "mt-1 text-2xl font-semibold"}>
        {value}
      </p>
    </div>
  );
}
