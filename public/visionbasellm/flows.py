"""Reusable automation flows for VisionBaseLLM.

A flow is a named, parameterised recipe (log in, fill a form, click a
sequence of buttons...) that compiles down to the plain-language task string
the agent already understands. Both the web dashboard and the standalone web
app read this same registry so the two stay in sync.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional


@dataclass
class FlowField:
    key: str
    label: str
    type: str = "text"  # text | password | number | textarea
    default: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Flow:
    id: str
    name: str
    description: str
    category: str  # auth | forms | navigation | commerce | data
    default_url: str
    steps: List[str]
    max_steps: int = 12
    fields: List[FlowField] = field(default_factory=list)

    def to_dict(self) -> Dict:
        payload = asdict(self)
        payload["fields"] = [f.to_dict() for f in self.fields]
        return payload

    def defaults(self) -> Dict[str, str]:
        return {f.key: f.default for f in self.fields}

    def compile(self, values: Optional[Dict[str, str]] = None) -> Dict:
        merged = {**self.defaults(), **(values or {})}
        steps = [_fill(step, merged) for step in self.steps]
        return {
            "flow_id": self.id,
            "url": merged.get("url") or self.default_url,
            "task": ", then ".join(steps),
            "steps": steps,
            "max_steps": self.max_steps,
        }


_TEMPLATE = re.compile(r"\{\{(\w+)\}\}")


def _fill(template: str, values: Dict[str, str]) -> str:
    return _TEMPLATE.sub(lambda m: (values.get(m.group(1)) or f"[{m.group(1)}]").strip(), template)


FLOWS: List[Flow] = [
    Flow(
        id="login",
        name="Log into a website",
        description="Find the sign-in form, type the credentials, submit and confirm the session started.",
        category="auth",
        default_url="https://practice.expandtesting.com/login",
        max_steps=10,
        fields=[
            FlowField("username", "Username or email", default="practice"),
            FlowField("password", "Password", type="password", default="SuperSecretPassword!"),
            FlowField("success", "Text that proves it worked", default="You logged into a secure area"),
        ],
        steps=[
            "Open the sign-in form",
            "Type {{username}} into the username or email field",
            "Type the password into the password field",
            "Submit the sign-in form",
            "Confirm the page shows {{success}}",
        ],
    ),
    Flow(
        id="fill-form",
        name="Fill in a form",
        description="Complete every visible field of a form with the supplied values, then submit it.",
        category="forms",
        default_url="https://practice.expandtesting.com/inputs",
        max_steps=14,
        fields=[
            FlowField(
                "fields",
                "Field: value pairs (one per line)",
                type="textarea",
                default="Name: Vikram\nEmail: vikram@example.com\nMessage: Hello from VisionBaseLLM",
            ),
            FlowField("submit", "Submit button label", default="Submit"),
        ],
        steps=[
            "Read the form and list every input that needs a value",
            "Fill each field using these values: {{fields}}",
            "Click the {{submit}} button",
            "Confirm the form was accepted",
        ],
    ),
    Flow(
        id="click-sequence",
        name="Click through buttons",
        description="Click a named sequence of buttons or links, waiting for the page to settle after each one.",
        category="navigation",
        default_url="https://practice.expandtesting.com",
        max_steps=12,
        fields=[FlowField("targets", "Buttons or links, in order", default="Form Validation, Submit")],
        steps=[
            "Click each of these controls in order, waiting after every click: {{targets}}",
            "Confirm the last click produced a visible change",
        ],
    ),
    Flow(
        id="search-open",
        name="Search and open a result",
        description="Locate the search box, run a query and open the best matching result.",
        category="navigation",
        default_url="https://books.toscrape.com",
        max_steps=10,
        fields=[
            FlowField("query", "Search for", default="travel"),
            FlowField("pick", "Which result to open", default="the first result"),
        ],
        steps=[
            "Find the search field",
            "Search for {{query}}",
            "Open {{pick}}",
            "Confirm the detail page loaded",
        ],
    ),
    Flow(
        id="add-to-cart",
        name="Add a product to the cart",
        description="Find a product, add it to the basket and verify the cart counter changed.",
        category="commerce",
        default_url="https://www.saucedemo.com/inventory.html",
        max_steps=12,
        fields=[
            FlowField("product", "Product to buy", default="Sauce Labs Backpack"),
            FlowField("quantity", "Quantity", type="number", default="1"),
        ],
        steps=[
            "Locate {{product}} in the listing",
            "Set the quantity to {{quantity}} if a quantity control exists",
            "Add it to the cart",
            "Verify the cart badge increased",
        ],
    ),
    Flow(
        id="extract",
        name="Read data off a page",
        description="Navigate to the page and report back the specific values requested.",
        category="data",
        default_url="https://example.com",
        max_steps=6,
        fields=[FlowField("wanted", "What should the agent read?", default="the page heading and the first paragraph")],
        steps=["Load the page and wait for it to settle", "Read {{wanted}} and report it back"],
    ),
]

FLOWS_BY_ID: Dict[str, Flow] = {flow.id: flow for flow in FLOWS}


def get_flow(flow_id: str) -> Optional[Flow]:
    return FLOWS_BY_ID.get(flow_id)


def list_flows() -> List[Dict]:
    return [flow.to_dict() for flow in FLOWS]


def register_flow(flow: Flow) -> Flow:
    """Add a flow at runtime (used for recorded / user-defined flows)."""
    FLOWS_BY_ID[flow.id] = flow
    FLOWS[:] = [f for f in FLOWS if f.id != flow.id] + [flow]
    return flow


def flow_from_actions(flow_id: str, name: str, url: str, actions: List[Dict]) -> Flow:
    """Build a flow out of recorded manual actions.

    Each action is {"kind": "click"|"type"|"select"|"navigate",
                    "label": str, "value": str|None}.
    """
    steps: List[str] = []
    for action in actions:
        kind = action.get("kind", "click")
        label = action.get("label", "the control")
        value = action.get("value")
        if kind == "type":
            steps.append(f'Type "{value}" into {label}')
        elif kind == "select":
            steps.append(f'Choose "{value}" in {label}')
        elif kind == "navigate":
            steps.append(f"Go to {label}")
        else:
            steps.append(f"Click {label}")
    return Flow(
        id=flow_id,
        name=name,
        description=f"Recorded walkthrough with {len(steps)} steps.",
        category="navigation",
        default_url=url,
        steps=steps or ["Load the page and wait for it to settle"],
        max_steps=max(4, len(steps) + 3),
        fields=[],
    )
