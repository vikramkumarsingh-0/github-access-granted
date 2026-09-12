export type StepPhase =
  | "plan"
  | "perceive"
  | "reason"
  | "act"
  | "verify"
  | "done"
  | "error";

export type StepStatus = "running" | "success" | "failure";

export interface DetectedElement {
  id: string;
  label: string;
  selector: string;
  confidence: number;
  /** [x, y, width, height] in absolute pixels on a 1280x800 viewport. */
  bbox: [number, number, number, number];
  text?: string;
  target?: boolean;
}

export interface AgentAction {
  action: string;
  selector?: string | null;
  value?: string | null;
  confidence?: number;
  reasoning?: string;
}

export interface StepEvent {
  run_id: string;
  step: number;
  phase: StepPhase;
  status: StepStatus;
  sub_goal?: string | null;
  action?: AgentAction | null;
  reasoning?: string | null;
  url?: string | null;
  elements?: DetectedElement[];
  screenshot_b64?: string | null;
  duration_ms?: number;
  error?: string | null;
  /** Set by the sandbox so the UI can render a mock page frame. */
  page_mock?: PageMock | null;
  source?: "live" | "sandbox";
}

export interface PageMock {
  title: string;
  kind: "login" | "search" | "results" | "cart" | "confirmation";
  host: string;
}

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserType = (typeof BROWSERS)[number];

export const REASONERS = [
  { id: "groq-vision", label: "Groq Llama 4 Scout (vision)" },
  { id: "gateway-astra", label: "Lovable AI Gateway (multimodal)" },
  { id: "ollama-local", label: "Ollama llama3.2-vision (local)" },
] as const;

export interface RunConfig {
  url: string;
  task: string;
  browser: BrowserType;
  reasoner: string;
  headless: boolean;
  maxSteps: number;
}

export interface RunRecord {
  runId: string;
  startedAt: number;
  config: RunConfig;
  events: StepEvent[];
  outcome: "success" | "failure" | "running";
  durationMs: number;
  source: "live" | "sandbox";
}
