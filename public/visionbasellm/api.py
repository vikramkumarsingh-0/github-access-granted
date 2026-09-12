"""
api.py — v3.0 (completed)

FastAPI surface with real-time streaming.

What changed vs v2:
  1. New GET /automate/stream — Server-Sent Events carrying every StepEvent
     (screenshot frames, bounding boxes, reasoning, action, verification).
  2. The blocking POST /automate is preserved for existing callers.
  3. CORS is enabled so a hosted dashboard can drive the agent directly.
  4. Optional bearer-token gate via AGENT_API_TOKEN.
  5. Pydantic v2 validators, fixing the missing `Optional` import in v2.

Drop this file at the repository root, replacing the existing api.py.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import AsyncIterator, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from loguru import logger
from prometheus_client import Counter, Histogram, generate_latest
from pydantic import BaseModel, field_validator

from automation_agent import AutomationAgent
from core.security import SecurityValidator

app = FastAPI(title="Vision-Based Web Automation API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

automation_requests = Counter("automation_requests_total", "Total automation requests")
automation_duration = Histogram("automation_duration_seconds", "Automation execution time")
automation_success = Counter("automation_success_total", "Successful automations")
automation_failures = Counter("automation_failures_total", "Failed automations")
security_blocks = Counter("security_blocks_total", "Blocked malicious requests")

BROWSERS = {"chromium", "firefox", "webkit"}


def require_token(authorization: Optional[str] = Header(default=None)) -> None:
    expected = os.getenv("AGENT_API_TOKEN")
    if not expected:
        return  # open mode for local development
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


class AutomationRequest(BaseModel):
    url: str
    task: str
    browser_type: str = "chromium"
    use_groq: bool = False
    vision_model: Optional[str] = None
    headless: bool = True
    max_steps: int = 25
    proxy: Optional[Dict] = None
    session_id: Optional[str] = None

    @field_validator("browser_type")
    @classmethod
    def _browser(cls, value: str) -> str:
        if value not in BROWSERS:
            raise ValueError(f"Browser must be one of {sorted(BROWSERS)}")
        return value

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        try:
            return SecurityValidator.validate_url(value)
        except ValueError as exc:
            security_blocks.inc()
            raise ValueError(f"Invalid URL: {exc}") from exc

    @field_validator("task")
    @classmethod
    def _task(cls, value: str) -> str:
        try:
            return SecurityValidator.validate_task(value)
        except ValueError as exc:
            security_blocks.inc()
            raise ValueError(f"Invalid task: {exc}") from exc


def _build_agent(request: AutomationRequest) -> AutomationAgent:
    return AutomationAgent(
        browser_type=request.browser_type,
        use_groq=request.use_groq,
        vision_model=request.vision_model,
        headless=request.headless,
        proxy=request.proxy,
        session_id=request.session_id,
        max_steps=request.max_steps,
    )


@app.get("/health")
async def health() -> Dict:
    return {"status": "ok", "version": app.version}


@app.post("/automate", dependencies=[Depends(require_token)])
async def automate(request: AutomationRequest) -> Dict:
    """Blocking run. Returns the full event log once the agent finishes."""
    automation_requests.inc()
    started = time.time()
    try:
        agent = _build_agent(request)
        result = await asyncio.to_thread(agent.execute_task, request.url, request.task)
        (automation_success if result["success"] else automation_failures).inc()
        return result
    except Exception as exc:  # noqa: BLE001
        automation_failures.inc()
        logger.exception("Automation run failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        automation_duration.observe(time.time() - started)


@app.get("/automate/stream", dependencies=[Depends(require_token)])
async def automate_stream(
    url: str = Query(...),
    task: str = Query(...),
    browser_type: str = Query("chromium"),
    use_groq: bool = Query(False),
    vision_model: Optional[str] = Query(None),
    headless: bool = Query(True),
    max_steps: int = Query(25, ge=1, le=60),
) -> StreamingResponse:
    """Server-Sent Events: one `data:` frame per agent step phase."""

    request = AutomationRequest(
        url=url,
        task=task,
        browser_type=browser_type,
        use_groq=use_groq,
        vision_model=vision_model,
        headless=headless,
        max_steps=max_steps,
    )
    automation_requests.inc()

    async def event_source() -> AsyncIterator[bytes]:
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        started = time.time()

        def run_agent() -> None:
            agent = _build_agent(request)
            try:
                for event in agent.stream_task(request.url, request.task):
                    loop.call_soon_threadsafe(queue.put_nowait, event.to_dict())
            except Exception as exc:  # noqa: BLE001
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"phase": "error", "status": "failure", "error": str(exc)},
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        worker = asyncio.create_task(asyncio.to_thread(run_agent))
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                if event.get("phase") == "done":
                    automation_success.inc()
                elif event.get("phase") == "error":
                    automation_failures.inc()
                yield f"data: {json.dumps(event)}\n\n".encode()
            yield b"event: end\ndata: {}\n\n"
        finally:
            automation_duration.observe(time.time() - started)
            await worker

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type="text/plain; version=0.0.4")
