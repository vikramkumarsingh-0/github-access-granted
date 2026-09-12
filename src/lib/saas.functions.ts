import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { nextRunAt, type Cadence } from "@/lib/schedule";

export interface BotAccountRow {
  id: string;
  label: string;
  site_url: string;
  username: string;
  notes: string;
  has_secret: boolean;
}

export interface AutomationRow {
  id: string;
  name: string;
  site_url: string;
  task: string;
  steps: string[];
  bot_account_id: string | null;
  cadence: Cadence;
  run_hour_utc: number;
  run_weekday: number;
  browser: string;
  max_steps: number;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface RunRow {
  id: string;
  automation_id: string | null;
  outcome: string;
  summary: string;
  duration_ms: number;
  trigger: string;
  created_at: string;
}

export const listWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [bots, automations, runs] = await Promise.all([
      context.supabase
        .from("bot_accounts")
        .select("id,label,site_url,username,notes,secret_ciphertext")
        .order("created_at", { ascending: true }),
      context.supabase.from("automations").select("*").order("created_at", { ascending: true }),
      context.supabase
        .from("automation_runs")
        .select("id,automation_id,outcome,summary,duration_ms,trigger,created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    return {
      botAccounts: (bots.data ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        site_url: row.site_url,
        username: row.username,
        notes: row.notes,
        has_secret: Boolean(row.secret_ciphertext),
      })) as BotAccountRow[],
      automations: (automations.data ?? []) as unknown as AutomationRow[],
      runs: (runs.data ?? []) as RunRow[],
    };
  });

export const saveBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      label: string;
      site_url: string;
      username: string;
      password?: string;
      notes?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { encryptSecret } = await import("@/lib/bot-crypto.server");
    const base = {
      user_id: context.userId,
      label: data.label.trim() || "Bot account",
      site_url: data.site_url.trim(),
      username: data.username.trim(),
      notes: data.notes?.trim() ?? "",
    };
    const secret = data.password ? { secret_ciphertext: encryptSecret(data.password) } : {};

    if (data.id) {
      const { error } = await context.supabase
        .from("bot_accounts")
        .update({ ...base, ...secret })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: row, error } = await context.supabase
      .from("bot_accounts")
      .insert({ ...base, secret_ciphertext: "", ...secret })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("bot_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      name: string;
      site_url: string;
      steps: string[];
      bot_account_id?: string | null;
      cadence: Cadence;
      run_hour_utc: number;
      run_weekday: number;
      browser?: string;
      max_steps?: number;
      enabled?: boolean;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const steps = data.steps.map((step) => step.trim()).filter(Boolean);
    const row = {
      user_id: context.userId,
      name: data.name.trim() || "Untitled automation",
      site_url: data.site_url.trim(),
      task: steps.join(", then "),
      steps,
      bot_account_id: data.bot_account_id || null,
      cadence: data.cadence,
      run_hour_utc: data.run_hour_utc,
      run_weekday: data.run_weekday,
      browser: data.browser ?? "chromium",
      max_steps: data.max_steps ?? 12,
      enabled: data.enabled ?? true,
      next_run_at: nextRunAt({
        cadence: data.cadence,
        run_hour_utc: data.run_hour_utc,
        run_weekday: data.run_weekday,
      }).toISOString(),
    };

    if (data.id) {
      const { error } = await context.supabase.from("automations").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await context.supabase
      .from("automations")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const setAutomationEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; enabled: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("automations")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("automations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Runs one automation immediately through the agent backend (or records a skip). */
export const runAutomationNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: automation, error } = await context.supabase
      .from("automations")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !automation) throw new Error(error?.message ?? "Automation not found");

    let bot: { username: string; secret_ciphertext: string } | null = null;
    if (automation.bot_account_id) {
      const { data: botRow } = await context.supabase
        .from("bot_accounts")
        .select("username,secret_ciphertext")
        .eq("id", automation.bot_account_id)
        .single();
      bot = botRow ?? null;
    }

    const { executeAutomation } = await import("@/lib/automation-runner.server");
    const result = await executeAutomation(automation as never, bot);

    await context.supabase.from("automation_runs").insert({
      user_id: context.userId,
      automation_id: automation.id,
      outcome: result.outcome,
      summary: result.summary,
      duration_ms: result.durationMs,
      trigger: "manual",
      events: result.events as never,
    });
    await context.supabase
      .from("automations")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", automation.id);

    return {
      outcome: result.outcome,
      summary: result.summary,
      durationMs: result.durationMs,
    };
  });
