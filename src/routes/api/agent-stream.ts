import { createFileRoute } from "@tanstack/react-router";

import { buildSandboxRun } from "@/lib/sandbox-run";

/**
 * Server-Sent Events bridge to the Python vision agent.
 *
 * When AGENT_API_URL is configured the request is proxied to the agent's
 * /automate/stream endpoint. Otherwise a deterministic sandbox run is
 * generated so the dashboard is fully explorable without a running backend.
 */
export const Route = createFileRoute("/api/agent-stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const url = params.get("url")?.trim() ?? "";
        const task = params.get("task")?.trim() ?? "";
        const browser = params.get("browser") ?? "chromium";
        const reasoner = params.get("reasoner") ?? "gateway-astra";
        const maxSteps = Number(params.get("maxSteps") ?? 12);

        if (!url || !task) {
          return Response.json({ error: "url and task are required" }, { status: 400 });
        }
        try {
          const parsed = new URL(url);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return Response.json({ error: "Only http/https URLs are allowed" }, { status: 400 });
          }
        } catch {
          return Response.json({ error: "That target address is not a valid URL" }, { status: 400 });
        }

        const agentApiUrl = process.env["AGENT_API_URL"];
        const agentToken = process.env["AGENT_API_TOKEN"];

        if (agentApiUrl) {
          const upstream = new URL("/automate/stream", agentApiUrl);
          upstream.searchParams.set("url", url);
          upstream.searchParams.set("task", task);
          upstream.searchParams.set("browser_type", browser);
          upstream.searchParams.set("max_steps", String(maxSteps));

          const response = await fetch(upstream, {
            headers: {
              Accept: "text/event-stream",
              ...(agentToken ? { Authorization: `Bearer ${agentToken}` } : {}),
            },
            signal: request.signal,
          });

          if (!response.ok || !response.body) {
            const body = await response.text().catch(() => "");
            console.error(`Agent stream failed [${response.status}]: ${body}`);
            return Response.json(
              { error: `Agent backend responded ${response.status}: ${body.slice(0, 400)}` },
              { status: 502 },
            );
          }

          // Tag proxied events as "live" so the UI can distinguish them
          // from sandbox runs.
          const encoder = new TextEncoder();
          const tagged = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                const text = new TextDecoder().decode(chunk);
                const out = text
                  .split("\n")
                  .map((line) => {
                    if (!line.startsWith("data: ")) return line;
                    try {
                      const parsed = JSON.parse(line.slice(6));
                      parsed.source = "live";
                      return `data: ${JSON.stringify(parsed)}`;
                    } catch {
                      return line;
                    }
                  })
                  .join("\n");
                controller.enqueue(encoder.encode(out));
              },
            }),
          );

          return new Response(tagged, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        // ---- sandbox mode ----
        const events = buildSandboxRun({ url, task, browser, reasoner, maxSteps });
        const encoder = new TextEncoder();
        let cancelled = false;

        const stream = new ReadableStream({
          async start(controller) {
            for (const { delayMs, event } of events) {
              if (cancelled) break;
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              if (cancelled) break;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            if (!cancelled) {
              controller.enqueue(encoder.encode(`event: end\ndata: {}\n\n`));
            }
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
