"""
core/intelligent_planner.py — v3.0 (completed)

Hierarchical task decomposition, now wired directly into AutomationAgent.

What changed vs v2:
  1. decompose() turns a high-level goal into ordered, individually verifiable
     sub-goals, using a heuristic split first and the LLM only when needed.
  2. replan() rewrites the remaining sub-goals after repeated failure, using
     the live page state as context.
  3. The planner no longer owns a browser or a model of its own — it borrows
     the agent's AIReasoner so the whole run uses one backend and one budget.

Drop this file at core/intelligent_planner.py, replacing the existing file.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from loguru import logger

CONJUNCTIONS = re.compile(r"\s*(?:,\s*then\s+|\s+then\s+|\s+and then\s+|;\s*)", re.I)
MAX_SUB_GOALS = 8


class IntelligentPlanner:
    def __init__(self, reasoner):
        self.reasoner = reasoner

    def decompose(self, task: str, url: str, page_title: str = "") -> List[str]:
        """Split a goal into ordered sub-goals."""

        heuristic = self._heuristic_split(task)
        if len(heuristic) > 1:
            logger.info(f"Planner (heuristic) produced {len(heuristic)} sub-goals")
            return heuristic[:MAX_SUB_GOALS]

        try:
            steps = self.reasoner.plan_steps(task=task, url=url, page_title=page_title)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"LLM planning failed, using the raw goal: {exc}")
            return [task]

        steps = [s for s in (s.strip() for s in steps) if s]
        logger.info(f"Planner (llm) produced {len(steps)} sub-goals")
        return (steps or [task])[:MAX_SUB_GOALS]

    def replan(
        self,
        task: str,
        failed_sub_goal: str,
        remaining: List[str],
        page_state: Optional[Dict] = None,
    ) -> List[str]:
        """Rewrite the remaining sub-goals after a sub-goal repeatedly failed."""

        state = page_state or {}
        prompt_goal = (
            f"{task}\n"
            f"The sub-goal {failed_sub_goal!r} failed repeatedly. "
            f"The page is now at {state.get('url')} titled {state.get('title')!r}. "
            "Produce a different route to the remaining outcome: "
            + " | ".join(remaining)
        )

        try:
            steps = self.reasoner.plan_steps(
                task=prompt_goal,
                url=str(state.get("url") or ""),
                page_title=str(state.get("title") or ""),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Re-planning failed, dropping the blocked sub-goal: {exc}")
            return [s for s in remaining if s != failed_sub_goal] or remaining

        steps = [s for s in (s.strip() for s in steps) if s]
        return (steps or remaining)[:MAX_SUB_GOALS]

    @staticmethod
    def _heuristic_split(task: str) -> List[str]:
        parts = [p.strip(" .") for p in CONJUNCTIONS.split(task) if p and p.strip(" .")]
        return parts if len(parts) > 1 else [task.strip()]
