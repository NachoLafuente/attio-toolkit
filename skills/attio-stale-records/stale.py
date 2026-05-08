#!/usr/bin/env python3
"""
attio-stale-records: find records that haven't been touched in a while.

Usage:
    ATTIO_API_KEY=<token> python stale.py
    ATTIO_API_KEY=<token> python stale.py --days 90
    ATTIO_API_KEY=<token> python stale.py --object companies
    ATTIO_API_KEY=<token> python stale.py --json

Output: markdown report. Read-only. Sample-based (up to 1000 records per object).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

API_BASE = "https://api.attio.com/v2"
HTTP_TIMEOUT = 30
SAMPLE_LIMIT = 1000

DEFAULT_OBJECTS = ("people", "companies", "deals")


def call(token: str, method: str, path: str, body: dict | None = None) -> Any:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resp = requests.request(method, f"{API_BASE}{path}", headers=headers, json=body, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_self(token: str) -> dict:
    return call(token, "GET", "/self")


def fetch_records(token: str, slug: str, limit: int = SAMPLE_LIMIT) -> list[dict]:
    return call(token, "POST", f"/objects/{slug}/records/query", {"limit": limit, "offset": 0}).get("data", [])


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def last_touched(record: dict) -> datetime | None:
    candidates = [
        record.get("updated_at"),
        record.get("last_modified_at"),
        record.get("created_at"),
    ]
    parsed = [parse_dt(c) for c in candidates if c]
    return max(parsed) if parsed else None


def is_sparse_person(record: dict) -> bool:
    values = record.get("values") or {}
    has_email = bool(values.get("email_addresses"))
    has_company = bool(values.get("company") or values.get("companies"))
    return not has_email and not has_company


def is_sparse_company(record: dict) -> bool:
    values = record.get("values") or {}
    has_domain = bool(values.get("domains"))
    has_team = bool(values.get("team") or values.get("people"))
    return not has_domain and not has_team


def primary_text(values: dict, *keys: str) -> str | None:
    for k in keys:
        v = values.get(k)
        if not v:
            continue
        if isinstance(v, list) and v:
            v = v[0]
        if isinstance(v, dict):
            for tk in ("full_name", "name", "value", "domain", "email_address"):
                if v.get(tk):
                    return str(v[tk])
        elif isinstance(v, str):
            return v
    return None


def display_label(slug: str, record: dict) -> str:
    values = record.get("values") or {}
    rid = (record.get("id") or {}).get("record_id", "?")[:8]
    if slug == "people":
        return f"{primary_text(values, 'name') or '(no name)'} ({rid})"
    if slug == "companies":
        return f"{primary_text(values, 'name') or '(no name)'} ({rid})"
    if slug == "deals":
        return f"{primary_text(values, 'name') or '(no name)'} ({rid})"
    return rid


def bucket(days: int) -> str:
    if days < 30:
        return "<30d"
    if days < 90:
        return "30-90d"
    if days < 180:
        return "90-180d"
    if days < 365:
        return "180-365d"
    return "365+d"


def render(workspace: dict, by_object: dict, threshold_days: int) -> str:
    name = workspace.get("workspace_name", "Unknown")
    slug = workspace.get("workspace_slug", "")

    out: list[str] = []
    out.append(f"# Attio Stale Records: {name}")
    out.append("")
    out.append(f"**Workspace:** `{slug}` &nbsp;·&nbsp; **Threshold:** {threshold_days}+ days idle &nbsp;·&nbsp; **Run:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out.append("")

    total_sampled = sum(d["sampled"] for d in by_object.values())
    total_stale = sum(d["stale_count"] for d in by_object.values())
    pct_total = (total_stale / total_sampled * 100) if total_sampled else 0

    out.append(f"## Summary: **{total_stale}** of {total_sampled} sampled records are stale ({pct_total:.0f}%)")
    out.append("")
    out.append("| Object | Sampled | Stale | % Stale |")
    out.append("|--------|---------|-------|---------|")
    for obj_slug, data in by_object.items():
        pct = (data["stale_count"] / data["sampled"] * 100) if data["sampled"] else 0
        out.append(f"| {obj_slug} | {data['sampled']} | {data['stale_count']} | {pct:.0f}% |")
    out.append("")

    out.append("## Age distribution of stale records")
    out.append("")
    all_buckets: Counter = Counter()
    for data in by_object.values():
        all_buckets.update(data["age_buckets"])
    bucket_order = ["30-90d", "90-180d", "180-365d", "365+d"]
    if any(all_buckets[b] for b in bucket_order):
        for b in bucket_order:
            count = all_buckets.get(b, 0)
            if count:
                out.append(f"- **{b}**: {count} records")
        out.append("")
    else:
        out.append("(no records past the threshold)")
        out.append("")

    quick_wins: list[tuple[str, str, int]] = []
    for obj_slug, data in by_object.items():
        for r, days in data.get("quick_wins", []):
            quick_wins.append((obj_slug, display_label(obj_slug, r), days))
    if quick_wins:
        quick_wins.sort(key=lambda t: -t[2])
        out.append("## Quick wins: sparse + ancient (likely safe to archive)")
        out.append("")
        for obj_slug, label, days in quick_wins[:15]:
            out.append(f"- **{obj_slug}**: {label}: {days}d idle, no key fields filled")
        if len(quick_wins) > 15:
            out.append(f"- (and {len(quick_wins) - 15} more)")
        out.append("")
    else:
        out.append("## Quick wins")
        out.append("")
        out.append("No records flagged as both sparse and ancient. Nothing obvious to archive.")
        out.append("")

    out.append("## Recommended next step")
    out.append("")
    if total_stale == 0:
        out.append("- Workspace is fresh. Nothing to clean up.")
    elif quick_wins:
        out.append(f"1. Archive the {min(len(quick_wins), 15)} quick-win records above. Lowest risk.")
        out.append(f"2. For the remaining {total_stale - len(quick_wins)} stale records, decide per object whether they should be archived, reassigned, or kept.")
        out.append(f"3. Set up a recurring sync (e.g. monthly) to keep dashboards clean.")
    else:
        out.append(f"1. Review the {total_stale} stale records by object. Decide archive vs reassign.")
        out.append(f"2. None are obvious quick wins (records still have core fields filled), so handle case by case.")
    out.append("")

    out.append("---")
    out.append("")
    out.append("Generated by [attio-toolkit](https://github.com/NachoLafuente/attio-toolkit). Open source from [5050Growth](https://5050growth.com).")
    return "\n".join(out)


def render_json(workspace: dict, by_object: dict, threshold_days: int) -> str:
    payload_objects = {}
    for obj_slug, data in by_object.items():
        payload_objects[obj_slug] = {
            "sampled": data["sampled"],
            "stale_count": data["stale_count"],
            "age_buckets": dict(data["age_buckets"]),
            "quick_wins": [
                {"label": display_label(obj_slug, r), "days_idle": days}
                for r, days in data.get("quick_wins", [])
            ],
        }
    return json.dumps(
        {
            "workspace": {
                "name": workspace.get("workspace_name"),
                "slug": workspace.get("workspace_slug"),
            },
            "threshold_days": threshold_days,
            "objects": payload_objects,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Find stale Attio records")
    p.add_argument("--token")
    p.add_argument("--days", type=int, default=90, help="Idle threshold in days (default: 90)")
    p.add_argument("--object", action="append", help="Object slug to check (repeatable). Default: people, companies, deals")
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

    objects_to_check = tuple(args.object) if args.object else DEFAULT_OBJECTS
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    quick_win_age = max(args.days * 2, 180)

    by_object: dict = {}
    for obj_slug in objects_to_check:
        try:
            records = fetch_records(token, obj_slug)
        except requests.HTTPError:
            continue

        stale_records = []
        age_buckets: Counter = Counter()
        quick_wins = []
        for r in records:
            touched = last_touched(r)
            if not touched:
                continue
            age_days = (datetime.now(timezone.utc) - touched).days
            if touched < cutoff:
                stale_records.append((r, age_days))
                age_buckets[bucket(age_days)] += 1
                if age_days >= quick_win_age:
                    sparse = False
                    if obj_slug == "people" and is_sparse_person(r):
                        sparse = True
                    elif obj_slug == "companies" and is_sparse_company(r):
                        sparse = True
                    if sparse:
                        quick_wins.append((r, age_days))

        by_object[obj_slug] = {
            "sampled": len(records),
            "stale_count": len(stale_records),
            "age_buckets": age_buckets,
            "quick_wins": quick_wins,
        }

    if args.json:
        print(render_json(ws, by_object, args.days))
    else:
        print(render(ws, by_object, args.days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
