"""
automation_agent.py — v3.0 (completed)

Autonomous multi-step vision-driven web automation agent.

What changed vs v2:
  1. execute_task() is now an iterative perceive -> plan -> act -> verify loop
     instead of a single-shot action.
  2. The IntelligentPlanner is wired in: high-level goals are decomposed into
     ordered sub-goals, and the loop advances through them.
  3. Every step emits a structured StepEvent, so callers can stream progress
     (see api.py /automate/stream).
  4. Failure handling: per-step retries with an escalating strategy ladder
     (vision -> DOM fallback -> re-plan -> abort).

Drop this file at the repository root, replacing the existing
automation_agent.py.
"""

from __future__ import annotations

import base64
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Callable, Dict, Iterator, List, Optional

from loguru import logger

from config import settings
from core.ai_reasoner import AIReasoner
from core.browser_engine import BrowserEngine
from core.evaluator import ActionEvaluator
from core.intelligent_planner import IntelligentPlanner
from core.matcher import ElementMatcher
from core.security import SecurityValidator
from core.training_pipeline import TrainingPipeline
from core.vision_detector import VisionDetector

MAX_STEPS = 25
MAX_RETRIES_PER_STEP = 3


@dataclass
class StepEvent:
    """A single observable unit of agent work, safe to serialise to JSON."""

    run_id: str
    step: int
    phase: str  # plan | perceive | reason | act | verify | done | error
    status: str  # running | success | failure
    sub_goal: Optional[str] = None
    action: Optional[Dict] = None
    reasoning: Optional[str] = None
    url: Optional[str] = None
    elements: List[Dict] = field(default_factory=list)
    screenshot_b64: Optional[str] = None
    duration_ms: int = 0
    error: Optional[str] = None

    def to_dict(self) -> Dict:
        return asdict(self)


def _encode_screenshot(path: Path | str) -> Optional[str]:
    try:
        with open(path, "rb") as handle:
            return base64.b64encode(handle.read()).decode("ascii")
    except Exception as exc:  # pragma: no cover - disk/IO edge case
        logger.warning(f"Could not encode screenshot {path}: {exc}")
        return None


class AutomationAgent:
    def __init__(
        self,
        browser_type: str = "chromium",
        use_groq: bool = False,
        vision_model: Optional[str] = None,
        headless: bool = True,
        proxy: Optional[Dict] = None,
        session_id: Optional[str] = None,
        max_steps: int = MAX_STEPS,
    ):
        self.browser_type = browser_type
        self.headless = headless
        self.proxy = proxy
        self.session_id = session_id
        self.max_steps = max_steps

        self.detector = VisionDetector()
        self.reasoner = AIReasoner(use_groq=use_groq, vision_model=vision_model)
        self.planner = IntelligentPlanner(reasoner=self.reasoner)
        self.matcher = ElementMatcher()
        self.evaluator = ActionEvaluator()
        self.training_pipeline = TrainingPipeline()

        self.failed_actions: List[Dict] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def execute_task(self, url: str, task: str) -> Dict:
        """Blocking convenience wrapper: drains the stream and returns a summary."""
        events = list(self.stream_task(url, task))
        successes = [e for e in events if e.phase == "verify" and e.status == "success"]
        terminal = events[-1] if events else None

        return {
            "run_id": terminal.run_id if terminal else None,
            "success": bool(terminal and terminal.phase == "done"),
            "steps_executed": len({e.step for e in events if e.step > 0}),
            "steps_succeeded": len(successes),
            "final_url": terminal.url if terminal else None,
            "error": terminal.error if terminal else None,
            "events": [e.to_dict() for e in events],
        }

    def stream_task(
        self,
        url: str,
        task: str,
        on_event: Optional[Callable[[StepEvent], None]] = None,
    ) -> Iterator[StepEvent]:
        """Run the task, yielding a StepEvent for every phase transition."""

        run_id = uuid.uuid4().hex[:12]
        url = SecurityValidator.validate_url(url)
        task = SecurityValidator.validate_task(task)

        def emit(event: StepEvent) -> StepEvent:
            if on_event:
                on_event(event)
            return event

        logger.info(f"[{run_id}] task={task!r} url={url} browser={self.browser_type}")

        started = time.time()
        with BrowserEngine(
            browser_type=self.browser_type,
            headless=self.headless,
            proxy=self.proxy,
            session_id=self.session_id,
        ) as browser:
            browser.navigate(url)

            # ---------- 1. PLAN ----------
            plan_started = time.time()
            try:
                sub_goals = self.planner.decompose(
                    task=task,
                    url=url,
                    page_title=browser.get_title(),
                )
            except Exception as exc:
                yield emit(
                    StepEvent(
                        run_id=run_id,
                        step=0,
                        phase="error",
                        status="failure",
                        error=f"Planning failed: {exc}",
                        url=browser.current_url(),
                    )
                )
                return

            yield emit(
                StepEvent(
                    run_id=run_id,
                    step=0,
                    phase="plan",
                    status="success",
                    reasoning=" -> ".join(sub_goals),
                    url=browser.current_url(),
                    duration_ms=int((time.time() - plan_started) * 1000),
                )
            )

            # ---------- 2. EXECUTION LOOP ----------
            step = 0
            goal_index = 0
            retries = 0

            while goal_index < len(sub_goals) and step < self.max_steps:
                step += 1
                sub_goal = sub_goals[goal_index]
                step_started = time.time()

                try:
                    # --- perceive ---
                    screenshot_path = browser.capture_screenshot()
                    visual_elements = self.detector.detect_elements(str(screenshot_path))
                    dom_elements = browser.extract_dom_elements()
                    matched = self.matcher.match_vision_to_dom(visual_elements, dom_elements)

                    yield emit(
                        StepEvent(
                            run_id=run_id,
                            step=step,
                            phase="perceive",
                            status="success",
                            sub_goal=sub_goal,
                            url=browser.current_url(),
                            elements=matched,
                            screenshot_b64=_encode_screenshot(screenshot_path),
                            duration_ms=int((time.time() - step_started) * 1000),
                        )
                    )

                    # --- reason ---
                    before_state = self._capture_state(browser)
                    decision = self.reasoner.decide_action(
                        task=sub_goal,
                        overall_goal=task,
                        screenshot_path=str(screenshot_path),
                        visual_elements=visual_elements,
                        dom_elements=dom_elements,
                        matched_elements=matched,
                        history=self.failed_actions[-3:],
                        fallback_to_dom=retries >= 1,
                    )

                    yield emit(
                        StepEvent(
                            run_id=run_id,
                            step=step,
                            phase="reason",
                            status="success",
                            sub_goal=sub_goal,
                            action=decision,
                            reasoning=decision.get("reasoning"),
                            url=browser.current_url(),
                        )
                    )

                    # --- act ---
                    self._execute_action(browser, decision)
                    yield emit(
                        StepEvent(
                            run_id=run_id,
                            step=step,
                            phase="act",
                            status="success",
                            sub_goal=sub_goal,
                            action=decision,
                            url=browser.current_url(),
                        )
                    )

                    # --- verify ---
                    after_state = self._capture_state(browser)
                    evaluation = self.evaluator.evaluate(decision, before_state, after_state)
                    goal_reached = self.reasoner.is_sub_goal_complete(
                        sub_goal=sub_goal,
                        before_state=before_state,
                        after_state=after_state,
                        evaluation=evaluation,
                    )

                    yield emit(
                        StepEvent(
                            run_id=run_id,
                            step=step,
                            phase="verify",
                            status="success" if goal_reached else "failure",
                            sub_goal=sub_goal,
                            action=decision,
                            reasoning=evaluation.get("reason"),
                            url=browser.current_url(),
                            screenshot_b64=_encode_screenshot(browser.capture_screenshot()),
                            duration_ms=int((time.time() - step_started) * 1000),
                        )
                    )

                    if goal_reached:
                        goal_index += 1
                        retries = 0
                        continue

                    # --- recovery ladder ---
                    retries += 1
                    self.failed_actions.append(
                        {
                            "sub_goal": sub_goal,
                            "action": decision,
                            "screenshot": str(screenshot_path),
                            "reason": evaluation.get("reason"),
                        }
                    )

                    if retries >= MAX_RETRIES_PER_STEP:
                        remaining = sub_goals[goal_index:]
                        sub_goals = sub_goals[:goal_index] + self.planner.replan(
                            task=task,
                            failed_sub_goal=sub_goal,
                            remaining=remaining,
                            page_state=after_state,
                        )
                        retries = 0
                        yield emit(
                            StepEvent(
                                run_id=run_id,
                                step=step,
                                phase="plan",
                                status="success",
                                reasoning=f"Re-planned after repeated failure: "
                                + " -> ".join(sub_goals[goal_index:]),
                                url=browser.current_url(),
                            )
                        )

                except Exception as exc:  # noqa: BLE001 - surface every failure as an event
                    logger.exception(f"[{run_id}] step {step} crashed")
                    retries += 1
                    yield emit(
                        StepEvent(
                            run_id=run_id,
                            step=step,
                            phase="error",
                            status="failure",
                            sub_goal=sub_goal,
                            error=str(exc),
                            url=browser.current_url(),
                            duration_ms=int((time.time() - step_started) * 1000),
                        )
                    )
                    if retries >= MAX_RETRIES_PER_STEP:
                        break

            # ---------- 3. TERMINATE ----------
            completed = goal_index >= len(sub_goals)
            if self.failed_actions:
                self.training_pipeline.queue_failures(self.failed_actions)

            yield emit(
                StepEvent(
                    run_id=run_id,
                    step=step,
                    phase="done" if completed else "error",
                    status="success" if completed else "failure",
                    reasoning=(
                        f"Completed {goal_index}/{len(sub_goals)} sub-goals in {step} steps."
                    ),
                    url=browser.current_url(),
                    screenshot_b64=_encode_screenshot(browser.capture_screenshot()),
                    duration_ms=int((time.time() - started) * 1000),
                    error=None if completed else "Agent stopped before completing all sub-goals.",
                )
            )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _capture_state(self, browser: BrowserEngine) -> Dict:
        return {
            "url": browser.current_url(),
            "title": browser.get_title(),
            "dom_hash": browser.dom_fingerprint(),
            "visible_text": browser.visible_text()[:4000],
        }

    def _execute_action(self, browser: BrowserEngine, decision: Dict) -> None:
        action = decision.get("action")
        selector = decision.get("selector")
        value = decision.get("value")

        if action == "click":
            browser.click(selector)
        elif action == "type":
            browser.type_text(selector, value or "")
        elif action == "select":
            browser.select_option(selector, value or "")
        elif action == "scroll":
            browser.scroll(value or "down")
        elif action == "navigate":
            browser.navigate(SecurityValidator.validate_url(value or ""))
        elif action == "press":
            browser.press_key(value or "Enter")
        elif action == "wait":
            browser.wait_for_network_idle(timeout=float(value or 5))
        elif action == "none":
            logger.info("Reasoner chose no-op for this step.")
        else:
            raise ValueError(f"Unsupported action: {action!r}")

        browser.wait_for_network_idle(timeout=settings.action_settle_timeout)
