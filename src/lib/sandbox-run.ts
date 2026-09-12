import type { DetectedElement, PageMock, StepEvent } from "./vision-types";

interface SandboxInput {
  url: string;
  task: string;
  browser: string;
  reasoner: string;
  maxSteps: number;
}

interface TimedEvent {
  delayMs: number;
  event: StepEvent;
}

const CONJUNCTIONS = /\s*(?:,\s*then\s+|\s+then\s+|\s+and then\s+|\s+and\s+|;\s*)/i;

function decompose(task: string): string[] {
  const parts = task
    .split(CONJUNCTIONS)
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 6);

  const lower = task.toLowerCase();
  if (lower.includes("log") && lower.includes("in")) {
    return ["Locate the sign-in entry point", "Fill the credentials form", "Submit and confirm the session"];
  }
  if (lower.includes("search")) {
    return ["Find the search field", "Enter the search terms", "Confirm results rendered"];
  }
  if (lower.includes("cart") || lower.includes("buy") || lower.includes("checkout")) {
    return ["Open the product listing", "Select the matching product", "Add it to the cart", "Verify the cart badge"];
  }
  return ["Load and read the page", task];
}

function pageKind(subGoal: string, index: number): PageMock["kind"] {
  const lower = subGoal.toLowerCase();
  if (lower.includes("credential") || lower.includes("sign-in") || lower.includes("login")) return "login";
  if (lower.includes("search") || lower.includes("field")) return "search";
  if (lower.includes("cart")) return "cart";
  if (lower.includes("confirm") || lower.includes("verify") || lower.includes("submit")) return "confirmation";
  return index === 0 ? "search" : "results";
}

export const ELEMENT_BANK: Record<PageMock["kind"], DetectedElement[]> = {
  login: [
    { id: "el-01", label: "input", selector: "input#email", confidence: 0.97, bbox: [430, 268, 420, 46], text: "Email address" },
    { id: "el-02", label: "input", selector: "input#password", confidence: 0.96, bbox: [430, 336, 420, 46], text: "Password" },
    { id: "el-03", label: "button", selector: "button[type=submit]", confidence: 0.99, bbox: [430, 408, 420, 48], text: "Sign in" },
    { id: "el-04", label: "link", selector: "a.forgot", confidence: 0.82, bbox: [430, 474, 148, 22], text: "Forgot password?" },
    { id: "el-05", label: "nav", selector: "header nav", confidence: 0.74, bbox: [0, 0, 1280, 64] },
  ],
  search: [
    { id: "el-01", label: "input", selector: "input[name=q]", confidence: 0.98, bbox: [320, 240, 560, 52], text: "Search…" },
    { id: "el-02", label: "button", selector: "button.search-submit", confidence: 0.95, bbox: [896, 240, 112, 52], text: "Search" },
    { id: "el-03", label: "nav", selector: "header nav", confidence: 0.79, bbox: [0, 0, 1280, 64] },
    { id: "el-04", label: "link", selector: "a.logo", confidence: 0.88, bbox: [32, 16, 132, 32], text: "Home" },
  ],
  results: [
    { id: "el-01", label: "card", selector: "li.result:nth-child(1)", confidence: 0.93, bbox: [96, 168, 520, 132], text: "Result one" },
    { id: "el-02", label: "card", selector: "li.result:nth-child(2)", confidence: 0.91, bbox: [96, 320, 520, 132], text: "Result two" },
    { id: "el-03", label: "card", selector: "li.result:nth-child(3)", confidence: 0.89, bbox: [96, 472, 520, 132], text: "Result three" },
    { id: "el-04", label: "select", selector: "select#sort", confidence: 0.86, bbox: [700, 168, 220, 44], text: "Sort by price" },
    { id: "el-05", label: "button", selector: "button.filter-apply", confidence: 0.84, bbox: [700, 236, 220, 44], text: "Apply filters" },
  ],
  cart: [
    { id: "el-01", label: "button", selector: "button.add-to-cart", confidence: 0.97, bbox: [742, 396, 268, 52], text: "Add to cart" },
    { id: "el-02", label: "image", selector: "img.product-hero", confidence: 0.92, bbox: [96, 152, 560, 400] },
    { id: "el-03", label: "badge", selector: "span.cart-count", confidence: 0.9, bbox: [1188, 18, 36, 28], text: "1" },
    { id: "el-04", label: "select", selector: "select#qty", confidence: 0.83, bbox: [742, 320, 132, 44], text: "Qty" },
  ],
  confirmation: [
    { id: "el-01", label: "banner", selector: "div.alert-success", confidence: 0.96, bbox: [96, 140, 1088, 88], text: "Success" },
    { id: "el-02", label: "button", selector: "button.continue", confidence: 0.92, bbox: [96, 268, 200, 48], text: "Continue" },
    { id: "el-03", label: "nav", selector: "header nav", confidence: 0.77, bbox: [0, 0, 1280, 64] },
  ],
};

function actionFor(kind: PageMock["kind"], subGoal: string, elements: DetectedElement[]) {
  const pick = (label: string) => elements.find((element) => element.label === label) ?? elements[0]!;

  if (kind === "login" && /credential|fill|enter/i.test(subGoal)) {
    const input = pick("input");
    return {
      action: "type",
      selector: input.selector,
      value: "demo@example.com",
      confidence: 0.94,
      targetId: input.id,
      reasoning: `The highest-confidence text field (${input.selector}) sits directly under the "Email address" label, which matches this sub-goal.`,
    };
  }
  if (kind === "search" && /enter|terms|field/i.test(subGoal)) {
    const input = pick("input");
    return {
      action: "type",
      selector: input.selector,
      value: subGoal.replace(/.*?(for|enter)\s+/i, "").slice(0, 48) || "query",
      confidence: 0.92,
      targetId: input.id,
      reasoning: `Vision found one wide input at the visual centre of the page; DOM matching resolved it to ${input.selector}.`,
    };
  }
  if (kind === "results") {
    const card = pick("card");
    return {
      action: "click",
      selector: card.selector,
      value: null,
      confidence: 0.88,
      targetId: card.id,
      reasoning: `Three result cards share a layout signature; the first is the closest semantic match for the sub-goal.`,
    };
  }
  if (kind === "cart") {
    const button = pick("button");
    return {
      action: "click",
      selector: button.selector,
      value: null,
      confidence: 0.95,
      targetId: button.id,
      reasoning: `The primary call-to-action is the only high-contrast button inside the product panel bounding box.`,
    };
  }
  const button = pick("button");
  return {
    action: "click",
    selector: button.selector,
    value: null,
    confidence: 0.93,
    targetId: button.id,
    reasoning: `Submitting through ${button.selector} is the single interactive control that advances this sub-goal.`,
  };
}

export function buildSandboxRun(input: SandboxInput): TimedEvent[] {
  const runId = Math.random().toString(16).slice(2, 14);
  const host = safeHost(input.url);
  const subGoals = decompose(input.task).slice(0, Math.max(1, input.maxSteps));
  const timed: TimedEvent[] = [];

  const base = { run_id: runId, source: "sandbox" as const, url: input.url };

  timed.push({
    delayMs: 420,
    event: {
      ...base,
      step: 0,
      phase: "plan",
      status: "success",
      reasoning: subGoals.join(" → "),
      duration_ms: 380,
    },
  });

  subGoals.forEach((subGoal, index) => {
    const step = index + 1;
    const kind = pageKind(subGoal, index);
    const elements = ELEMENT_BANK[kind];
    const decision = actionFor(kind, subGoal, elements);
    const page: PageMock = { title: `${host} — ${kind}`, kind, host };
    const marked = elements.map((element) => ({
      ...element,
      target: element.id === decision.targetId,
    }));

    timed.push({
      delayMs: 780,
      event: {
        ...base,
        step,
        phase: "perceive",
        status: "success",
        sub_goal: subGoal,
        elements: marked,
        page_mock: page,
        reasoning: `Captured frame, ran YOLOv8 detection → ${elements.length} interactive regions, matched against ${elements.length + 9} DOM candidates.`,
        duration_ms: 640,
      },
    });

    timed.push({
      delayMs: 900,
      event: {
        ...base,
        step,
        phase: "reason",
        status: "success",
        sub_goal: subGoal,
        elements: marked,
        page_mock: page,
        action: {
          action: decision.action,
          selector: decision.selector,
          value: decision.value,
          confidence: decision.confidence,
        },
        reasoning: decision.reasoning,
        duration_ms: 1120,
      },
    });

    timed.push({
      delayMs: 620,
      event: {
        ...base,
        step,
        phase: "act",
        status: "success",
        sub_goal: subGoal,
        elements: marked,
        page_mock: page,
        action: {
          action: decision.action,
          selector: decision.selector,
          value: decision.value,
        },
        reasoning: `Dispatched ${decision.action} on ${decision.selector} in ${input.browser}, then waited for network idle.`,
        duration_ms: 410,
      },
    });

    timed.push({
      delayMs: 700,
      event: {
        ...base,
        step,
        phase: "verify",
        status: "success",
        sub_goal: subGoal,
        elements: marked,
        page_mock: page,
        reasoning: `DOM fingerprint changed and the evaluator scored the transition 0.9 — sub-goal satisfied.`,
        duration_ms: 520,
      },
    });
  });

  timed.push({
    delayMs: 540,
    event: {
      ...base,
      step: subGoals.length,
      phase: "done",
      status: "success",
      reasoning: `Completed ${subGoals.length}/${subGoals.length} sub-goals across ${subGoals.length * 4} phases.`,
      duration_ms: subGoals.length * 2700,
    },
  });

  return timed;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "target";
  }
}
