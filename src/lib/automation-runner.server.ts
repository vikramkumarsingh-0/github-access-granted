import { decryptSecret } from "@/lib/bot-crypto.server";

export interface AutomationRecord {
  id: string;
  name: string;
  site_url: string;
  task: string;
  steps: string[];
  bot_account_id: string | null;
  browser: string;
  max_steps: number;
}

export interface BotCredentials {
  username: string;
  secret_ciphertext: string;
}

export interface ExecutionResult {
  outcome: "success" | "failure" | "skipped";
  summary: string;
  durationMs: number;
  events: unknown[];
}

/**
 * Sends one automation to the VisionBaseLLM agent backend. Bot credentials are
 * decrypted here, handed to the agent, and never returned to the caller.
 */
export async function executeAutomation(
  automation: AutomationRecord,
  bot?: BotCredentials | null,
): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const agentApiUrl = process.env["AGENT_API_URL"];

  if (!agentApiUrl) {
    return {
      outcome: "skipped",
      summary: "No automation engine is connected yet, so the run was skipped.",
      durationMs: 0,
      events: [],
    };
  }

  const credentials = bot
    ? { username: bot.username, password: decryptSecret(bot.secret_ciphertext) }
    : null;

  const token = process.env["AGENT_API_TOKEN"];
  try {
    const response = await fetch(new URL("/automate", agentApiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        url: automation.site_url,
        task: automation.task,
        browser: automation.browser,
        headless: true,
        max_steps: automation.max_steps,
        ...(credentials ? { credentials } : {}),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      events?: unknown[];
      steps?: unknown[];
    };

    return {
      outcome: response.ok && body.success !== false ? "success" : "failure",
      summary: body.message ?? (response.ok ? "Run finished." : `Agent returned ${response.status}.`),
      durationMs: Date.now() - startedAt,
      events: body.events ?? body.steps ?? [],
    };
  } catch (cause) {
    return {
      outcome: "failure",
      summary: (cause as Error).message,
      durationMs: Date.now() - startedAt,
      events: [],
    };
  }
}
