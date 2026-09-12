import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { FlowBuilder } from "@/components/vision/FlowBuilder";
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
import { supabase } from "@/integrations/supabase/client";
import {
  deleteAutomation,
  deleteBotAccount,
  listWorkspace,
  runAutomationNow,
  saveAutomation,
  saveBotAccount,
  setAutomationEnabled,
  type AutomationRow,
  type BotAccountRow,
  type RunRow,
} from "@/lib/saas.functions";
import { CADENCES, WEEKDAYS, describeSchedule, type Cadence } from "@/lib/schedule";

const TITLE = "Scheduled automations — VisionBaseLLM";
const DESCRIPTION =
  "Schedule recurring browser automations for your own sites, run them with a bot account and review every run in one place.";

export const Route = createFileRoute("/automations")({
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
  component: AutomationsPage,
});

const EMPTY_DRAFT = {
  id: undefined as string | undefined,
  name: "",
  site_url: "",
  steps: [] as string[],
  bot_account_id: "",
  cadence: "daily" as Cadence,
  run_hour_utc: 6,
  run_weekday: 1,
};

function AutomationsPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [bots, setBots] = useState<BotAccountRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [bot, setBot] = useState({ label: "", site_url: "", username: "", password: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const data = await listWorkspace();
    setAutomations(data.automations);
    setBots(data.botAccounts);
    setRuns(data.runs);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      refresh()
        .catch(() => undefined)
        .finally(() => setReady(true));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your workspace…
      </main>
    );
  }

  const submitAutomation = async () => {
    setBusy("automation");
    try {
      await saveAutomation({
        data: {
          ...(draft.id ? { id: draft.id } : {}),
          name: draft.name,
          site_url: draft.site_url,
          steps: draft.steps,
          bot_account_id: draft.bot_account_id || null,
          cadence: draft.cadence,
          run_hour_utc: draft.run_hour_utc,
          run_weekday: draft.run_weekday,
        },
      });
      setDraft({ ...EMPTY_DRAFT });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const submitBot = async () => {
    setBusy("bot");
    try {
      await saveBotAccount({ data: bot });
      setBot({ label: "", site_url: "", username: "", password: "" });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-4 px-4 py-5 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
            VisionBaseLLM · scheduled work
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Your automations
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Design a flow by dragging blocks, point it at your own site, pick how often it should
            repeat, and let the bot account handle the sign-in.
          </p>
        </div>
        <nav className="flex gap-2">
          <Link to="/" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Command center
          </Link>
          <Link to="/admin" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Admin
          </Link>
          <button
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            Sign out
          </button>
        </nav>
      </header>

      <section className="panel space-y-4 p-4">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {draft.id ? "Edit automation" : "New automation"}
        </h2>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="auto-name">Name</Label>
            <Input
              id="auto-name"
              placeholder="Morning order export"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auto-url">Site address</Label>
            <Input
              id="auto-url"
              placeholder="https://yourcompany.com/admin"
              value={draft.site_url}
              onChange={(event) => setDraft({ ...draft, site_url: event.target.value })}
            />
          </div>
        </div>

        <FlowBuilder steps={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} />

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Repeats</Label>
            <Select
              value={draft.cadence}
              onValueChange={(value) => setDraft({ ...draft, cadence: value as Cadence })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CADENCES.map((cadence) => (
                  <SelectItem key={cadence} value={cadence}>{cadence}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auto-hour">Hour (UTC)</Label>
            <Input
              id="auto-hour"
              type="number"
              min={0}
              max={23}
              value={draft.run_hour_utc}
              onChange={(event) =>
                setDraft({ ...draft, run_hour_utc: Number(event.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Day (weekly only)</Label>
            <Select
              value={String(draft.run_weekday)}
              onValueChange={(value) => setDraft({ ...draft, run_weekday: Number(value) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Sign in as</Label>
            <Select
              value={draft.bot_account_id || "none"}
              onValueChange={(value) =>
                setDraft({ ...draft, bot_account_id: value === "none" ? "" : value })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No sign-in needed</SelectItem>
                {bots.map((account) => (
                  <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={submitAutomation}
            disabled={busy === "automation" || !draft.name || !draft.site_url || draft.steps.length === 0}
          >
            {draft.id ? "Save changes" : "Create automation"}
          </Button>
          {draft.id && (
            <Button variant="ghost" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              Cancel
            </Button>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="panel p-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Scheduled
          </h2>
          <ul className="mt-3 space-y-2">
            {automations.length === 0 && (
              <li className="text-xs text-muted-foreground">Nothing scheduled yet.</li>
            )}
            {automations.map((automation) => (
              <li key={automation.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{automation.name}</p>
                  <Switch
                    checked={automation.enabled}
                    onCheckedChange={async (enabled) => {
                      await setAutomationEnabled({ data: { id: automation.id, enabled } });
                      await refresh();
                    }}
                  />
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {automation.site_url} · {describeSchedule(automation)} ·{" "}
                  {automation.steps?.length ?? 0} steps
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  next {automation.next_run_at ? new Date(automation.next_run_at).toLocaleString() : "—"}
                  {automation.last_run_at
                    ? ` · last ${new Date(automation.last_run_at).toLocaleString()}`
                    : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === automation.id}
                    onClick={async () => {
                      setBusy(automation.id);
                      try {
                        await runAutomationNow({ data: { id: automation.id } });
                        await refresh();
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === automation.id ? "Running…" : "Run now"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        id: automation.id,
                        name: automation.name,
                        site_url: automation.site_url,
                        steps: automation.steps ?? [],
                        bot_account_id: automation.bot_account_id ?? "",
                        cadence: automation.cadence,
                        run_hour_utc: automation.run_hour_utc,
                        run_weekday: automation.run_weekday,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await deleteAutomation({ data: { id: automation.id } });
                      await refresh();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-4">
          <section className="panel space-y-3 p-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Bot accounts
            </h2>
            <p className="text-xs text-muted-foreground">
              Use a separate login made for the robot. The password is scrambled before it is saved
              and is never shown again.
            </p>
            <Input
              placeholder="Nickname, e.g. Orders bot"
              value={bot.label}
              onChange={(event) => setBot({ ...bot, label: event.target.value })}
            />
            <Input
              placeholder="Site address"
              value={bot.site_url}
              onChange={(event) => setBot({ ...bot, site_url: event.target.value })}
            />
            <Input
              placeholder="Bot username or email"
              value={bot.username}
              onChange={(event) => setBot({ ...bot, username: event.target.value })}
            />
            <Input
              type="password"
              placeholder="Bot password"
              value={bot.password}
              onChange={(event) => setBot({ ...bot, password: event.target.value })}
            />
            <Button onClick={submitBot} disabled={busy === "bot" || !bot.label}>
              Add bot account
            </Button>

            <ul className="space-y-2">
              {bots.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{account.label}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {account.username || "no username"} ·{" "}
                      {account.has_secret ? "password stored" : "no password"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await deleteBotAccount({ data: { id: account.id } });
                      await refresh();
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel p-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Recent runs
            </h2>
            <ul className="mt-3 space-y-2">
              {runs.length === 0 && (
                <li className="text-xs text-muted-foreground">No runs recorded yet.</li>
              )}
              {runs.map((run) => (
                <li key={run.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs">{run.summary || run.trigger}</span>
                    <span
                      className={
                        run.outcome === "success"
                          ? "font-mono text-[11px] text-primary"
                          : "font-mono text-[11px] text-destructive"
                      }
                    >
                      {run.outcome}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()} · {run.trigger} ·{" "}
                    {(run.duration_ms / 1000).toFixed(1)}s
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
