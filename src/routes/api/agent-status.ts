import { createFileRoute } from "@tanstack/react-router";

/** Reports whether a real Python agent backend is wired up, and whether it answers. */
export const Route = createFileRoute("/api/agent-status")({
  server: {
    handlers: {
      GET: async () => {
        const agentApiUrl = process.env["AGENT_API_URL"];
        if (!agentApiUrl) {
          return Response.json({ configured: false, healthy: false, mode: "sandbox" });
        }

        const token = process.env["AGENT_API_TOKEN"];
        try {
          const response = await fetch(new URL("/health", agentApiUrl), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(4000),
          });
          const body = (await response.json().catch(() => ({}))) as { status?: string; version?: string };
          return Response.json({
            configured: true,
            healthy: response.ok,
            mode: response.ok ? "live" : "sandbox",
            version: body.version ?? null,
          });
        } catch (cause) {
          return Response.json({
            configured: true,
            healthy: false,
            mode: "sandbox",
            error: (cause as Error).message,
          });
        }
      },
    },
  },
});
