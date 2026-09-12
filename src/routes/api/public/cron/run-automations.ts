import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeAutomation } from "@/lib/automation-runner.server";
import { nextRunAt, type Cadence } from "@/lib/schedule";

/** Scheduler entry point: runs every automation whose next slot has arrived. */
export const Route = createFileRoute("/api/public/cron/run-automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const now = new Date();
        const { data: due, error } = await supabaseAdmin
          .from("automations")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", now.toISOString())
          .limit(20);

        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }

        let ran = 0;
        for (const automation of due ?? []) {
          let bot: { username: string; secret_ciphertext: string } | null = null;
          if (automation.bot_account_id) {
            const { data: botRow } = await supabaseAdmin
              .from("bot_accounts")
              .select("username,secret_ciphertext")
              .eq("id", automation.bot_account_id)
              .single();
            bot = botRow ?? null;
          }

          const result = await executeAutomation(automation as never, bot);
          ran += 1;

          await supabaseAdmin.from("automation_runs").insert({
            user_id: automation.user_id,
            automation_id: automation.id,
            outcome: result.outcome,
            summary: result.summary,
            duration_ms: result.durationMs,
            trigger: "schedule",
            events: result.events as never,
          });

          await supabaseAdmin
            .from("automations")
            .update({
              last_run_at: now.toISOString(),
              next_run_at: nextRunAt(
                {
                  cadence: automation.cadence as Cadence,
                  run_hour_utc: automation.run_hour_utc,
                  run_weekday: automation.run_weekday,
                },
                now,
              ).toISOString(),
            })
            .eq("id", automation.id);
        }

        return Response.json({ ok: true, ran });
      },
    },
  },
});
