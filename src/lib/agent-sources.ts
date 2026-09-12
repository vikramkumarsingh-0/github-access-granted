export interface AgentSource {
  file: string;
  path: string;
  title: string;
  summary: string;
  destination: string;
}

export const AGENT_SOURCES: AgentSource[] = [
  {
    file: "automation_agent.py",
    path: "/visionbasellm/automation_agent.py",
    title: "Automation agent",
    summary:
      "The main loop: look at the page, plan, act, then check the result — with retries, recovery and a step budget.",
    destination: "automation_agent.py",
  },
  {
    file: "ai_reasoner.py",
    path: "/visionbasellm/ai_reasoner.py",
    title: "AI reasoner",
    summary:
      "Sends the screenshot straight to a multimodal model and gets back one strictly-formatted next action.",
    destination: "core/ai_reasoner.py",
  },
  {
    file: "intelligent_planner.py",
    path: "/visionbasellm/intelligent_planner.py",
    title: "Intelligent planner",
    summary:
      "Breaks a goal into ordered sub-goals, and rewrites the remaining ones when the agent gets stuck.",
    destination: "core/intelligent_planner.py",
  },
  {
    file: "api.py",
    path: "/visionbasellm/api.py",
    title: "FastAPI service",
    summary:
      "Health, blocking runs, live streaming runs and metrics — the service this dashboard talks to.",
    destination: "api.py",
  },
  {
    file: "flows.py",
    path: "/visionbasellm/flows.py",
    title: "Flow library",
    summary:
      "The ready-made recipes — sign in, fill a form, click a sequence — plus turning a recording into a reusable flow.",
    destination: "flows.py",
  },
  {
    file: "webapp.py",
    path: "/visionbasellm/webapp.py",
    title: "Standalone web app",
    summary:
      "One command, one process: its own console, live run feed and admin panel, with no separate frontend to build.",
    destination: "webapp.py",
  },
];
