"""VisionBaseLLM standalone web app.

A self-contained automation tool: one process serves its own UI, the flow
library, the live run stream and an admin panel — no separate frontend build.

    pip install fastapi uvicorn
    python -m playwright install chromium
    uvicorn webapp:app --host 127.0.0.1 --port 8000

Open http://127.0.0.1:8000 for the console and /admin for the control panel.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from flows import Flow, FlowField, flow_from_actions, get_flow, list_flows, register_flow

logger = logging.getLogger("visionbasellm.webapp")
logging.basicConfig(level=logging.INFO)

STATE_DIR = Path(os.getenv("VBL_STATE_DIR", ".vbl"))
STATE_DIR.mkdir(parents=True, exist_ok=True)
RUNS_FILE = STATE_DIR / "runs.json"
SETTINGS_FILE = STATE_DIR / "settings.json"
FLOWS_FILE = STATE_DIR / "flows.json"

DEFAULT_SETTINGS: Dict = {
    "browser_type": "chromium",
    "headless": True,
    "use_groq": False,
    "vision_model": None,
    "max_steps": 12,
    "history_limit": 50,
    "disabled_flows": [],
    "automation_enabled": True,
}

app = FastAPI(title="VisionBaseLLM Standalone", version="1.0.0")

_lock = threading.Lock()


# ----------------------------------------------------------------------
# persistence
# ----------------------------------------------------------------------
def _load(path: Path, fallback):
    try:
        return json.loads(path.read_text())
    except Exception:
        return fallback


def _save(path: Path, payload) -> None:
    with _lock:
        path.write_text(json.dumps(payload, indent=2, default=str))


def get_settings() -> Dict:
    return {**DEFAULT_SETTINGS, **_load(SETTINGS_FILE, {})}


def save_settings(patch: Dict) -> Dict:
    merged = {**get_settings(), **patch}
    _save(SETTINGS_FILE, merged)
    return merged


def get_runs() -> List[Dict]:
    return _load(RUNS_FILE, [])


def record_run(record: Dict) -> None:
    limit = int(get_settings().get("history_limit", 50))
    _save(RUNS_FILE, ([record] + get_runs())[:limit])


def _restore_custom_flows() -> None:
    for payload in _load(FLOWS_FILE, []):
        try:
            register_flow(
                Flow(
                    id=payload["id"],
                    name=payload["name"],
                    description=payload.get("description", ""),
                    category=payload.get("category", "navigation"),
                    default_url=payload.get("default_url", "https://example.com"),
                    steps=payload.get("steps", []),
                    max_steps=int(payload.get("max_steps", 12)),
                    fields=[FlowField(**f) for f in payload.get("fields", [])],
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Skipped a stored flow: %s", exc)


_restore_custom_flows()


# ----------------------------------------------------------------------
# agent bridge
# ----------------------------------------------------------------------
def _build_agent(max_steps: int):
    from automation_agent import AutomationAgent  # imported lazily so the UI boots without deps

    settings = get_settings()
    return AutomationAgent(
        browser_type=settings["browser_type"],
        use_groq=bool(settings["use_groq"]),
        vision_model=settings["vision_model"],
        headless=bool(settings["headless"]),
        max_steps=max_steps,
    )


async def _run_stream(url: str, task: str, max_steps: int, request: Request):
    if not get_settings().get("automation_enabled", True):
        payload = {"phase": "error", "status": "failure", "error": "Automation is paused in admin.",
                   "run_id": "paused", "step": 0}
        yield f"data: {json.dumps(payload)}\n\n"
        yield "event: end\ndata: {}\n\n"
        return

    events: "queue.Queue[Optional[Dict]]" = queue.Queue()
    collected: List[Dict] = []
    started = time.time()

    def worker() -> None:
        try:
            agent = _build_agent(max_steps)
            for event in agent.stream_task(url, task):
                events.put(event.to_dict())
        except Exception as exc:  # noqa: BLE001
            logger.exception("Run failed")
            events.put({
                "run_id": uuid.uuid4().hex[:12], "step": 0, "phase": "error",
                "status": "failure", "error": str(exc),
            })
        finally:
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()

    while True:
        if await request.is_disconnected():
            break
        try:
            event = events.get(timeout=0.25)
        except queue.Empty:
            yield ": keep-alive\n\n"
            continue
        if event is None:
            break
        collected.append(event)
        yield f"data: {json.dumps(event, default=str)}\n\n"

    yield "event: end\ndata: {}\n\n"

    if collected:
        last = collected[-1]
        record_run({
            "run_id": last.get("run_id"),
            "started_at": started,
            "duration_s": round(time.time() - started, 2),
            "url": url,
            "task": task,
            "outcome": "success" if last.get("phase") == "done" else "failure",
            "events": len(collected),
        })


# ----------------------------------------------------------------------
# API
# ----------------------------------------------------------------------
@app.get("/api/health")
async def health() -> Dict:
    return {"status": "ok", "version": app.version, "automation_enabled": get_settings()["automation_enabled"]}


@app.get("/api/flows")
async def api_flows() -> Dict:
    disabled = set(get_settings().get("disabled_flows", []))
    return {"flows": [f for f in list_flows() if f["id"] not in disabled], "all": list_flows()}


class CompileRequest(BaseModel):
    flow_id: str
    values: Dict[str, str] = {}


@app.post("/api/flows/compile")
async def api_compile(request: CompileRequest) -> Dict:
    flow = get_flow(request.flow_id)
    if not flow:
        raise HTTPException(404, "Unknown flow")
    return flow.compile(request.values)


class RecordRequest(BaseModel):
    name: str
    url: str
    actions: List[Dict]


@app.post("/api/flows/record")
async def api_record(request: RecordRequest) -> Dict:
    flow = flow_from_actions(f"rec-{uuid.uuid4().hex[:8]}", request.name, request.url, request.actions)
    register_flow(flow)
    _save(FLOWS_FILE, [f for f in _load(FLOWS_FILE, []) if f.get("id") != flow.id] + [flow.to_dict()])
    return flow.to_dict()


@app.delete("/api/flows/{flow_id}")
async def api_delete_flow(flow_id: str) -> Dict:
    _save(FLOWS_FILE, [f for f in _load(FLOWS_FILE, []) if f.get("id") != flow_id])
    return {"deleted": flow_id}


@app.get("/api/run/stream")
async def api_run(
    request: Request,
    url: str = Query(...),
    task: str = Query(...),
    max_steps: int = Query(12, ge=1, le=25),
):
    return StreamingResponse(
        _run_stream(url, task, max_steps, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/admin/settings")
async def api_get_settings() -> Dict:
    return get_settings()


@app.post("/api/admin/settings")
async def api_set_settings(patch: Dict) -> Dict:
    return save_settings(patch)


@app.get("/api/admin/runs")
async def api_runs() -> Dict:
    runs = get_runs()
    success = len([r for r in runs if r.get("outcome") == "success"])
    return {
        "runs": runs,
        "total": len(runs),
        "success_rate": round(success / len(runs) * 100) if runs else 0,
    }


@app.delete("/api/admin/runs")
async def api_clear_runs() -> Dict:
    _save(RUNS_FILE, [])
    return {"cleared": True}


# ----------------------------------------------------------------------
# UI
# ----------------------------------------------------------------------
PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#0b0f14;--panel:#111820;--line:#1e2a36;--fg:#e6edf3;--mut:#8494a5;--pri:#b6ff3a;--acc:#41d7ff;--bad:#ff5470}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui}
a{color:var(--acc);text-decoration:none}main{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:4px 0}.mut{color:var(--mut)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.grid{display:grid;gap:16px}@media(min-width:900px){.grid.two{grid-template-columns:360px 1fr}.grid.four{grid-template-columns:repeat(4,1fr)}}
input,select,textarea{width:100%;background:#0a1016;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:8px}
label{display:block;font-size:12px;color:var(--mut);margin:10px 0 4px}
button{background:var(--pri);color:#0b0f14;border:0;border-radius:6px;padding:9px 14px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:5px 11px;margin:0 6px 6px 0;cursor:pointer;font-size:12px}
.chip.on{border-color:var(--pri);color:var(--pri);background:rgba(182,255,58,.1)}
.ev{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px}
.ev b{color:var(--acc);text-transform:uppercase;font-size:11px;letter-spacing:.1em}
.ev.error b{color:var(--bad)}nav{display:flex;gap:10px;margin-bottom:18px}
.feed{max-height:560px;overflow:auto}
</style></head><body><main>
<nav><a href="/">Console</a><a href="/admin">Admin</a><span class="mut mono" id="status">checking…</span></nav>
__BODY__
</main><script>__SCRIPT__</script></body></html>"""

CONSOLE_BODY = """
<h1>VisionBaseLLM</h1>
<p class="mut">Pick a flow, fill in the details, and watch the agent look at the page, decide, act and check its work.</p>
<div class="grid two" style="margin-top:18px">
  <section class="panel">
    <div id="flowchips"></div>
    <div id="flowfields"></div>
    <label for="url">Target address</label><input id="url">
    <label for="task">Instructions</label><textarea id="task" rows="4"></textarea>
    <label for="steps">Step budget</label><input id="steps" type="number" min="1" max="25" value="12">
    <div style="display:flex;gap:8px;margin-top:14px">
      <button id="run">Start run</button><button class="ghost" id="stop">Stop</button>
    </div>
    <p id="err" class="mono" style="color:var(--bad)"></p>
  </section>
  <section class="panel"><h2 style="margin-top:0;font-size:14px" class="mut">Execution feed</h2>
    <div class="feed" id="feed"><p class="mut">No run yet.</p></div>
  </section>
</div>"""

CONSOLE_SCRIPT = """
let flows=[],active=null,values={},es=null;
const $=id=>document.getElementById(id);
fetch('/api/health').then(r=>r.json()).then(h=>$('status').textContent='agent v'+h.version+(h.automation_enabled?'':' · paused'));
fetch('/api/flows').then(r=>r.json()).then(d=>{flows=d.flows;renderChips();if(flows[0])pick(flows[0]);});
function renderChips(){$('flowchips').innerHTML=flows.map(f=>`<span class="chip${active&&active.id===f.id?' on':''}" data-id="${f.id}">${f.name}</span>`).join('');
 document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>pick(flows.find(f=>f.id===c.dataset.id)));}
function pick(f){active=f;values={};(f.fields||[]).forEach(x=>values[x.key]=x.default||'');$('url').value=f.default_url;$('steps').value=f.max_steps;renderChips();renderFields();compile();}
function renderFields(){$('flowfields').innerHTML=(active.fields||[]).map(f=>
 `<label for="f_${f.key}">${f.label}</label>`+(f.type==='textarea'
  ?`<textarea id="f_${f.key}" rows="3">${values[f.key]||''}</textarea>`
  :`<input id="f_${f.key}" type="${f.type==='password'?'password':f.type==='number'?'number':'text'}" value="${(values[f.key]||'').replace(/"/g,'&quot;')}">`)).join('');
 (active.fields||[]).forEach(f=>{const el=$('f_'+f.key);el.oninput=()=>{values[f.key]=el.value;compile();};});}
function compile(){fetch('/api/flows/compile',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({flow_id:active.id,values})}).then(r=>r.json()).then(d=>{$('task').value=d.task;});}
function add(e){const d=document.createElement('div');d.className='ev'+(e.phase==='error'?' error':'');
 d.innerHTML=`<b>${e.phase}</b> <span class="mono mut">step ${e.step}</span><div>${(e.reasoning||e.error||'')}</div>`+
 (e.action?`<div class="mono mut">${e.action.action||''} ${e.action.selector||''} ${e.action.value||''}</div>`:'');
 $('feed').appendChild(d);$('feed').scrollTop=$('feed').scrollHeight;}
$('run').onclick=()=>{$('feed').innerHTML='';$('err').textContent='';
 const q=new URLSearchParams({url:$('url').value,task:$('task').value,max_steps:$('steps').value});
 es=new EventSource('/api/run/stream?'+q);
 es.onmessage=m=>{try{add(JSON.parse(m.data))}catch(_){}};
 es.addEventListener('end',()=>es.close());
 es.onerror=()=>{$('err').textContent='Stream ended.';es&&es.close();};};
$('stop').onclick=()=>{es&&es.close();};
"""

ADMIN_BODY = """
<h1>Admin control panel</h1>
<p class="mut">Engine defaults, the flow library and the full run log.</p>
<div class="grid four" style="margin:18px 0"><div class="panel"><p class="mut mono">RUNS</p><h2 id="s_total">0</h2></div>
<div class="panel"><p class="mut mono">SUCCESS</p><h2 id="s_rate">0%</h2></div>
<div class="panel"><p class="mut mono">AUTOMATION</p><h2 id="s_on">on</h2></div>
<div class="panel"><p class="mut mono">FLOWS</p><h2 id="s_flows">0</h2></div></div>
<div class="grid two">
 <section class="panel"><h2 style="margin-top:0;font-size:14px" class="mut">Engine defaults</h2>
  <label>Browser</label><select id="browser_type"><option>chromium</option><option>firefox</option><option>webkit</option></select>
  <label>Headless</label><select id="headless"><option value="true">yes</option><option value="false">no</option></select>
  <label>Use Groq vision</label><select id="use_groq"><option value="false">no</option><option value="true">yes</option></select>
  <label>Default step budget</label><input id="max_steps" type="number" min="1" max="25">
  <label>Runs kept in the log</label><input id="history_limit" type="number" min="1" max="500">
  <label>Automation enabled</label><select id="automation_enabled"><option value="true">yes</option><option value="false">no (kill switch)</option></select>
  <div style="margin-top:14px"><button id="save">Save settings</button></div></section>
 <div>
  <section class="panel" style="margin-bottom:16px"><h2 style="margin-top:0;font-size:14px" class="mut">Flow library</h2><div id="flows"></div></section>
  <section class="panel"><div style="display:flex;justify-content:space-between"><h2 style="margin:0;font-size:14px" class="mut">Run log</h2>
   <button class="ghost" id="clear">Clear</button></div><div id="runs" style="margin-top:10px"></div></section>
 </div></div>"""

ADMIN_SCRIPT = """
const $=id=>document.getElementById(id);let settings={};
fetch('/api/health').then(r=>r.json()).then(h=>$('status').textContent='agent v'+h.version);
function loadSettings(){fetch('/api/admin/settings').then(r=>r.json()).then(s=>{settings=s;
 ['browser_type','max_steps','history_limit'].forEach(k=>$(k).value=s[k]);
 ['headless','use_groq','automation_enabled'].forEach(k=>$(k).value=String(s[k]));
 $('s_on').textContent=s.automation_enabled?'on':'paused';renderFlows();});}
function renderFlows(){fetch('/api/flows').then(r=>r.json()).then(d=>{$('s_flows').textContent=d.all.length;
 const off=settings.disabled_flows||[];
 $('flows').innerHTML=d.all.map(f=>`<div class="ev"><b>${f.category}</b> ${f.name}
  <div class="mono mut">${f.steps.length} steps · ${f.id}</div>
  <button class="ghost" data-toggle="${f.id}">${off.includes(f.id)?'Enable':'Disable'}</button>
  ${f.id.startsWith('rec-')?`<button class="ghost" data-del="${f.id}">Delete</button>`:''}</div>`).join('');
 document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const id=b.dataset.toggle;
  const next=off.includes(id)?off.filter(x=>x!==id):off.concat(id);patch({disabled_flows:next});});
 document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>
  fetch('/api/flows/'+b.dataset.del,{method:'DELETE'}).then(loadSettings));});}
function patch(body){fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify(body)}).then(loadSettings);}
$('save').onclick=()=>patch({browser_type:$('browser_type').value,headless:$('headless').value==='true',
 use_groq:$('use_groq').value==='true',max_steps:+$('max_steps').value,history_limit:+$('history_limit').value,
 automation_enabled:$('automation_enabled').value==='true'});
function loadRuns(){fetch('/api/admin/runs').then(r=>r.json()).then(d=>{$('s_total').textContent=d.total;
 $('s_rate').textContent=d.success_rate+'%';
 $('runs').innerHTML=d.runs.length?d.runs.map(r=>`<div class="ev"><b>${r.outcome}</b> ${r.task}
  <div class="mono mut">${new Date(r.started_at*1000).toLocaleString()} · ${r.events} events · ${r.duration_s}s · ${r.url}</div></div>`).join('')
  :'<p class="mut">No runs yet.</p>';});}
$('clear').onclick=()=>fetch('/api/admin/runs',{method:'DELETE'}).then(loadRuns);
loadSettings();loadRuns();setInterval(loadRuns,10000);
"""


def _render(title: str, body: str, script: str) -> str:
    return PAGE.replace("__TITLE__", title).replace("__BODY__", body).replace("__SCRIPT__", script)


@app.get("/", response_class=HTMLResponse)
async def console_page() -> HTMLResponse:
    return HTMLResponse(_render("VisionBaseLLM console", CONSOLE_BODY, CONSOLE_SCRIPT))


@app.get("/admin", response_class=HTMLResponse)
async def admin_page() -> HTMLResponse:
    return HTMLResponse(_render("VisionBaseLLM admin", ADMIN_BODY, ADMIN_SCRIPT))


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
