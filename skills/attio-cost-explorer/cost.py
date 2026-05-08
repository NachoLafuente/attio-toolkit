#!/usr/bin/env python3
"""
attio-cost-explorer: estimate your Attio bill across plan tiers.

Usage:
    ATTIO_API_KEY=<token> python cost.py
    ATTIO_API_KEY=<token> python cost.py --json
    ATTIO_API_KEY=<token> python cost.py --plus-rate 34 --pro-rate 69

Output: markdown report to stdout. ~5 read-only API calls.

Pricing rates default to Attio's published annual-billing prices as of May 2026.
Override via --plus-rate / --pro-rate if your contract differs or if rates have changed.
For exact current rates check https://attio.com/pricing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests

API_BASE = "https://api.attio.com/v2"
HTTP_TIMEOUT = 30
SAMPLE_LIMIT = 500

DEFAULT_PLUS_RATE = 34
DEFAULT_PRO_RATE = 69
FREE_SEAT_CAP = 3


def call(token: str, method: str, path: str, body: dict | None = None) -> Any:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resp = requests.request(method, f"{API_BASE}{path}", headers=headers, json=body, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_self(token: str) -> dict:
    return call(token, "GET", "/self")


def fetch_objects(token: str) -> list[dict]:
    return call(token, "GET", "/objects").get("data", [])


def fetch_lists(token: str) -> list[dict]:
    return call(token, "GET", "/lists").get("data", [])


def fetch_workspace_members(token: str) -> list[dict]:
    return call(token, "GET", "/workspace_members").get("data", [])


def fetch_records(token: str, slug: str, limit: int = SAMPLE_LIMIT) -> list[dict]:
    return call(token, "POST", f"/objects/{slug}/records/query", {"limit": limit, "offset": 0}).get("data", [])


def determine_min_plan(seats: int, has_custom_objects: bool) -> str:
    if seats <= FREE_SEAT_CAP and not has_custom_objects:
        return "Free"
    if has_custom_objects:
        return "Pro"
    return "Plus"


def render(
    workspace: dict,
    seats: int,
    seats_known: bool,
    objects: list[dict],
    custom_objects: list[dict],
    record_estimate: int,
    list_count: int,
    plus_rate: int,
    pro_rate: int,
) -> str:
    has_custom = bool(custom_objects)
    min_plan = determine_min_plan(seats, has_custom)

    plus_bill = seats * plus_rate
    pro_bill = seats * pro_rate
    free_eligible = seats <= FREE_SEAT_CAP and not has_custom

    out: list[str] = []
    name = workspace.get("workspace_name", "Unknown")
    slug = workspace.get("workspace_slug", "")

    out.append(f"# Attio Cost Explorer: {name}")
    out.append("")
    out.append(f"**Workspace:** `{slug}` &nbsp;·&nbsp; **Run:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out.append("")

    out.append("## Today's footprint")
    out.append("")
    seat_note = "" if seats_known else " (token lacks `user_management:read` scope, seat count was assumed; figures below may be lowballed)"
    out.append(f"- **{seats}** workspace member{'s' if seats != 1 else ''}{seat_note}")
    out.append(f"- **{len(objects)}** objects ({len(custom_objects)} custom)")
    out.append(f"- **{list_count}** lists")
    out.append(f"- **~{record_estimate:,}** records sampled across People, Companies, and Deals")
    out.append("")

    out.append("## Cheapest plan that fits")
    out.append("")
    if min_plan == "Free":
        out.append(f"**Free** ({seats} seat{'s' if seats != 1 else ''}, no custom objects).")
        out.append(f"Estimated cost: **$0/mo**.")
    elif min_plan == "Plus":
        out.append(f"**Plus** at ~${plus_rate}/seat/mo (annual billing).")
        out.append(f"Estimated cost: **${plus_bill}/mo** (${plus_bill * 12}/year).")
    else:
        out.append(f"**Pro** at ~${pro_rate}/seat/mo (annual billing). Custom objects detected ({len(custom_objects)}), which require Pro.")
        out.append(f"Estimated cost: **${pro_bill}/mo** (${pro_bill * 12}/year).")
    out.append("")

    out.append("## Cost across all plans")
    out.append("")
    out.append("| Plan | Per seat (annual) | Your bill | Fits you? |")
    out.append("|------|-------------------|-----------|-----------|")
    free_fit = "yes" if free_eligible else f"no ({'>3 seats' if seats > FREE_SEAT_CAP else 'has custom objects'})"
    out.append(f"| Free | $0 | $0/mo | {free_fit} |")
    plus_fit = "yes" if not has_custom else "no (custom objects need Pro)"
    out.append(f"| Plus | ${plus_rate} | ${plus_bill}/mo | {plus_fit} |")
    out.append(f"| Pro | ${pro_rate} | ${pro_bill}/mo | yes |")
    out.append(f"| Enterprise | custom | contact sales | depends on needs |")
    out.append("")

    out.append("## What forces an upgrade")
    out.append("")
    forcing_factors = []
    if seats > FREE_SEAT_CAP:
        forcing_factors.append(f"You have {seats} seats. Free caps at {FREE_SEAT_CAP}.")
    if has_custom:
        names = ", ".join((o.get("singular_noun") or o.get("api_slug") or "?") for o in custom_objects[:5])
        forcing_factors.append(f"Custom objects detected ({names}). Custom objects require Pro.")
    if not forcing_factors:
        forcing_factors.append("Nothing. You qualify for Free today.")
    for f in forcing_factors:
        out.append(f"- {f}")
    out.append("")

    out.append("## Where you might save")
    out.append("")
    savings = []
    if min_plan == "Pro" and len(custom_objects) <= 1:
        savings.append(f"You have only {len(custom_objects)} custom object. If you can fold its use case into a standard object (people/companies/deals), you'd drop to Plus and save ${(pro_rate - plus_rate) * seats}/mo.")
    if min_plan == "Plus" and seats <= FREE_SEAT_CAP and not has_custom:
        savings.append(f"You qualify for Free. Switching saves ${plus_bill}/mo.")
    if seats > 5:
        savings.append(f"At {seats} seats, you're paying for everyone. Audit who actually logs in monthly. Each unused seat removed saves ${plus_rate if min_plan == 'Plus' else pro_rate}/mo.")
    if not savings:
        savings.append("Your plan is sized correctly for current usage. Revisit when team or schema grows.")
    for s in savings:
        out.append(f"- {s}")
    out.append("")

    out.append("---")
    out.append("")
    out.append("Pricing approximations as of May 2026 published rates. For your exact bill check Attio billing settings or [attio.com/pricing](https://attio.com/pricing).")
    out.append("")
    out.append("Generated by [attio-toolkit](https://github.com/NachoLafuente/attio-toolkit). Open source from [5050Growth](https://5050growth.com).")
    return "\n".join(out)


def render_json(
    workspace: dict,
    seats: int,
    seats_known: bool,
    objects: list[dict],
    custom_objects: list[dict],
    record_estimate: int,
    list_count: int,
    plus_rate: int,
    pro_rate: int,
) -> str:
    has_custom = bool(custom_objects)
    min_plan = determine_min_plan(seats, has_custom)
    return json.dumps(
        {
            "workspace": {
                "name": workspace.get("workspace_name"),
                "slug": workspace.get("workspace_slug"),
                "id": workspace.get("workspace_id"),
            },
            "footprint": {
                "seats": seats,
                "seats_known": seats_known,
                "objects_total": len(objects),
                "objects_custom": len(custom_objects),
                "lists": list_count,
                "records_sampled": record_estimate,
            },
            "min_plan": min_plan,
            "estimated_monthly_cost_usd": {
                "free": 0,
                "plus": seats * plus_rate,
                "pro": seats * pro_rate,
            },
            "rates_used": {"plus_per_seat": plus_rate, "pro_per_seat": pro_rate},
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Estimate your Attio bill across plan tiers")
    p.add_argument("--token", help="Attio API token (default: $ATTIO_API_KEY or $ATTIO_OAUTH2)")
    p.add_argument("--plus-rate", type=int, default=DEFAULT_PLUS_RATE, help="Plus plan $/seat/mo (annual)")
    p.add_argument("--pro-rate", type=int, default=DEFAULT_PRO_RATE, help="Pro plan $/seat/mo (annual)")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    token = args.token or os.environ.get("ATTIO_API_KEY") or os.environ.get("ATTIO_OAUTH2")
    if not token:
        print("error: provide --token or set ATTIO_API_KEY", file=sys.stderr)
        return 2

    try:
        ws = fetch_self(token)
    except requests.HTTPError as e:
        print(f"error: auth failed (HTTP {e.response.status_code})", file=sys.stderr)
        return 2

    try:
        objects = fetch_objects(token)
    except requests.HTTPError:
        objects = []
    system_nouns = {"Person", "Company", "Deal", "User", "Workspace"}
    custom_objects = [o for o in objects if o.get("singular_noun") not in system_nouns]

    seats_known = True
    try:
        members = fetch_workspace_members(token)
        seats = len([m for m in members if m.get("access_level") != "no-access"])
    except requests.HTTPError:
        seats = 1
        seats_known = False

    try:
        lists = fetch_lists(token)
    except requests.HTTPError:
        lists = []

    record_estimate = 0
    for slug in ("people", "companies", "deals"):
        try:
            sample = fetch_records(token, slug, limit=SAMPLE_LIMIT)
            record_estimate += len(sample)
        except requests.HTTPError:
            continue

    if args.json:
        print(render_json(ws, seats, seats_known, objects, custom_objects, record_estimate, len(lists), args.plus_rate, args.pro_rate))
    else:
        print(render(ws, seats, seats_known, objects, custom_objects, record_estimate, len(lists), args.plus_rate, args.pro_rate))
    return 0


if __name__ == "__main__":
    sys.exit(main())
