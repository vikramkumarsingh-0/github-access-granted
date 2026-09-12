import type { DetectedElement, PageMock, StepEvent } from "./vision-types";
import type { FlowDefinition } from "./flows";

export interface RecordedAction {
  id: string;
  at: number;
  kind: "click" | "type" | "select" | "navigate";
  label: string;
  selector: string;
  value?: string;
  pageKind: PageMock["kind"];
  bbox: [number, number, number, number];
}

export function describeAction(action: RecordedAction): string {
  switch (action.kind) {
    case "type":
      return `Type "${action.value ?? ""}" into ${action.label}`;
    case "select":
      return `Choose "${action.value ?? ""}" in ${action.label}`;
    case "navigate":
      return `Go to ${action.label}`;
    default:
      return `Click ${action.label}`;
  }
}

/** Turn a manual recording into a replayable agent run (the "mimic" stream). */
export function buildMimicRun(
  actions: RecordedAction[],
  host: string,
  elementsByPage: Record<string, DetectedElement[]>,
): { delayMs: number; event: StepEvent }[] {
  const runId = `mimic-${Math.random().toString(16).slice(2, 10)}`;
  const base = { run_id: runId, source: "sandbox" as const, url: `https://${host}` };
  const timed: { delayMs: number; event: StepEvent }[] = [];

  timed.push({
    delayMs: 350,
    event: {
      ...base,
      step: 0,
      phase: "plan",
      status: "success",
      reasoning: `Learned ${actions.length} step${actions.length === 1 ? "" : "s"} from your recording: ${actions
        .map(describeAction)
        .join(" → ")}`,
      duration_ms: 300,
    },
  });

  actions.forEach((action, index) => {
    const step = index + 1;
    const page: PageMock = { title: `${host} — ${action.pageKind}`, kind: action.pageKind, host };
    const elements = (elementsByPage[action.pageKind] ?? []).map((element) => ({
      ...element,
      target: element.selector === action.selector,
    }));
    const goal = describeAction(action);

    timed.push({
      delayMs: 520,
      event: {
        ...base,
        step,
        phase: "perceive",
        status: "success",
        sub_goal: goal,
        elements,
        page_mock: page,
        reasoning: `Looking at the ${action.pageKind} screen and matching your recorded target against ${elements.length} detected regions.`,
        duration_ms: 420,
      },
    });

    timed.push({
      delayMs: 620,
      event: {
        ...base,
        step,
        phase: "reason",
        status: "success",
        sub_goal: goal,
        elements,
        page_mock: page,
        action: { action: action.kind, selector: action.selector, value: action.value ?? null, confidence: 0.97 },
        reasoning: `You used ${action.label} here, and the same control is present with a high match score — repeating it.`,
        duration_ms: 560,
      },
    });

    timed.push({
      delayMs: 480,
      event: {
        ...base,
        step,
        phase: "act",
        status: "success",
        sub_goal: goal,
        elements,
        page_mock: page,
        action: { action: action.kind, selector: action.selector, value: action.value ?? null },
        reasoning: `Performed ${action.kind} on ${action.selector}.`,
        duration_ms: 260,
      },
    });

    timed.push({
      delayMs: 420,
      event: {
        ...base,
        step,
        phase: "verify",
        status: "success",
        sub_goal: goal,
        elements,
        page_mock: page,
        reasoning: "Screen changed the same way it did during your recording — step confirmed.",
        duration_ms: 240,
      },
    });
  });

  timed.push({
    delayMs: 400,
    event: {
      ...base,
      step: actions.length,
      phase: "done",
      status: "success",
      reasoning: `Reproduced all ${actions.length} of your steps.`,
      duration_ms: actions.length * 1800,
    },
  });

  return timed;
}

/** Save a recording as a reusable flow definition. */
export function recordingToFlow(actions: RecordedAction[], name: string, url: string): FlowDefinition {
  return {
    id: `rec-${Date.now().toString(36)}`,
    name,
    description: `Recorded from a manual walkthrough: ${actions.length} steps.`,
    category: "navigation",
    defaultUrl: url,
    maxSteps: Math.max(4, actions.length + 3),
    fields: [],
    steps: actions.map(describeAction),
  };
}
