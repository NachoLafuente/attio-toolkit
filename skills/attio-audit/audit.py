#!/usr/bin/env python3
"""
attio-audit: score an Attio workspace 0-100 on data quality, schema, lists, activity.

Usage:
    ATTIO_API_KEY=<token> python audit.py
    python audit.py --token <token>
    python audit.py --json
    python audit.py --full   # paginate every record (exact, slower)

Output: markdown report to stdout. Exit code 0 always (this is a report, not a gate).

Default mode samples 500 records per object (~10 read-only API calls).
--full paginates every record (hundreds to thousands of calls). Both modes are read-only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

API_BASE = "https://api.attio.com/v2"
SAMPLE_LIMIT = 500
ATTIO_PAGE_MAX = 500
HTTP_TIMEOUT = 30

_records_cache: dict[tuple[str, bool], list[dict]] = {}


@dataclass
class Section:
    name: str
    score: int
    max_score: int
    findings: list[str] = field(default_factory=list)


def call(token: str, method: str, path: str, body: dict | None = None) -> Any:
    url = f"{API_BASE}{path}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resp = requests.request(method, url, headers=headers, json=body, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def grade_letter(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def bar(score: int, max_score: int, width: int = 20) -> str:
    filled = round((score / max_score) * width) if max_score else 0
    return "█" * filled + "░" * (width - filled)


def percent_score(pct: float, thresholds: list[tuple[float, int]]) -> int:
    for threshold, points in thresholds:
        if pct >= threshold:
            return points
    return 0


def fetch_self(token: str) -> dict:
    return call(token, "GET", "/self")


def fetch_objects(token: str) -> list[dict]:
    return call(token, "GET", "/objects").get("data", [])


def fetch_attributes(token: str, object_slug: str) -> list[dict]:
    return call(token, "GET", f"/objects/{object_slug}/attributes").get("data", [])


def fetch_lists(token: str) -> list[dict]:
    return call(token, "GET", "/lists").get("data", [])


def fetch_list_entries(token: str, list_id: str, limit: int = 1) -> list[dict]:
    body = {"limit": limit, "offset": 0}
    return call(token, "POST", f"/lists/{list_id}/entries/query", body).get("data", [])


def fetch_workspace_members(token: str) -> list[dict]:
    return call(token, "GET", "/workspace_members").get("data", [])


def fetch_records(
    token: str, object_slug: str, full: bool = False, limit: int = SAMPLE_LIMIT
) -> list[dict]:
    key = (object_slug, full)
    if key in _records_cache:
        return _records_cache[key]

    if not full:
        body = {"limit": limit, "offset": 0}
        data = call(token, "POST", f"/objects/{object_slug}/records/query", body).get("data", [])
        _records_cache[key] = data
        return data

    all_records: list[dict] = []
    offset = 0
    while True:
        body = {"limit": ATTIO_PAGE_MAX, "offset": offset}
        page = call(token, "POST", f"/objects/{object_slug}/records/query", body).get("data", [])
        if not page:
            break
        all_records.extend(page)
        if len(page) < ATTIO_PAGE_MAX:
            break
        offset += ATTIO_PAGE_MAX
    _records_cache[key] = all_records
    return all_records


def score_data_quality(token: str, full: bool = False) -> Section:
    section = Section(name="Data quality", score=0, max_score=30)
    scope = "" if full else " sample"

    try:
        people = fetch_records(token, "people", full=full)
    except requests.HTTPError:
        people = []
    if people:
        with_email = sum(1 for p in people if (p.get("values") or {}).get("email_addresses"))
        pct = with_email / len(people) * 100
        pts = percent_score(pct, [(85, 10), (70, 7), (50, 4)])
        section.score += pts
        section.findings.append(
            f"{pct:.0f}% of People have an email ({with_email}/{len(people)}{scope}): {pts}/10"
        )
    else:
        section.findings.append("No People records found or accessible: 0/10")

    try:
        companies = fetch_records(token, "companies", full=full)
    except requests.HTTPError:
        companies = []
    if companies:
        with_domain = sum(1 for c in companies if (c.get("values") or {}).get("domains"))
        pct = with_domain / len(companies) * 100
        pts = percent_score(pct, [(80, 10), (60, 7), (40, 4)])
        section.score += pts
        section.findings.append(
            f"{pct:.0f}% of Companies have a domain ({with_domain}/{len(companies)}{scope}): {pts}/10"
        )
    else:
        section.findings.append("No Companies records found or accessible: 0/10")

    if people:
        with_owner = 0
        for p in people:
            values = p.get("values") or {}
            owner_fields = [
                values.get("primary_owner"),
                values.get("owner"),
                values.get("account_owner"),
            ]
            if any(owner_fields):
                with_owner += 1
        pct = with_owner / len(people) * 100
        pts = percent_score(pct, [(75, 10), (50, 7), (25, 4)])
        section.score += pts
        note = " (note: many workspaces model ownership on list entries instead, which this check does not see)" if pct < 25 else ""
        section.findings.append(
            f"{pct:.0f}% of People have an owner attribute on the record itself ({with_owner}/{len(people)}{scope}): {pts}/10{note}"
        )
    else:
        section.findings.append("Skipped owner check (no People records): 0/10")

    return section


def score_schema(token: str, objects: list[dict]) -> Section:
    section = Section(name="Schema hygiene", score=0, max_score=25)

    custom_objects = [o for o in objects if not o.get("singular_noun") in {"Person", "Company", "Deal", "User", "Workspace"}]
    section.findings.append(
        f"{len(objects)} total objects ({len(custom_objects)} custom)"
    )

    attr_counts: dict[str, int] = {}
    for obj in objects:
        slug = obj.get("api_slug") or obj.get("singular_noun", "").lower()
        if not slug:
            continue
        try:
            attrs = fetch_attributes(token, slug)
            attr_counts[slug] = len(attrs)
        except requests.HTTPError:
            continue

    if attr_counts:
        avg = sum(attr_counts.values()) / len(attr_counts)
        max_count = max(attr_counts.values())
        if avg <= 25:
            pts = 15
        elif avg <= 40:
            pts = 10
        elif avg <= 60:
            pts = 5
        else:
            pts = 0
        section.score += pts
        section.findings.append(
            f"Avg {avg:.0f} attrs/object, max {max_count}: {pts}/15"
        )

        bloated = [s for s, n in attr_counts.items() if n > 50]
        if bloated:
            pts = 0
            section.findings.append(
                f"⚠ Heavy schema: {', '.join(bloated[:3])} have >50 attributes"
            )
        else:
            pts = 10
            section.score += pts
        if not bloated:
            section.findings.append(f"No object exceeds 50 attributes: {pts}/10")
    else:
        section.findings.append("Could not read object attributes: 0/25")

    return section


def score_lists(token: str) -> Section:
    section = Section(name="Lists", score=0, max_score=20)

    try:
        lists = fetch_lists(token)
    except requests.HTTPError as e:
        section.findings.append(f"Could not read lists: HTTP {e.response.status_code}: 0/20")
        return section

    if not lists:
        section.findings.append("No lists in workspace: 0/20")
        return section

    section.findings.append(f"{len(lists)} lists in workspace")

    populated = 0
    for lst in lists[:30]:
        list_id = (lst.get("id") or {}).get("list_id")
        if not list_id:
            continue
        try:
            entries = fetch_list_entries(token, list_id, limit=1)
            if entries:
                populated += 1
        except requests.HTTPError:
            continue

    pct = populated / min(len(lists), 30) * 100 if lists else 0
    pts = percent_score(pct, [(80, 10), (60, 7), (40, 4)])
    section.score += pts
    section.findings.append(
        f"{pct:.0f}% of sampled lists have at least one entry: {pts}/10"
    )

    if len(lists) >= 4 and len(lists) <= 30:
        section.score += 10
        section.findings.append(f"Healthy list count ({len(lists)}, neither sparse nor sprawling): 10/10")
    elif len(lists) < 4:
        section.score += 5
        section.findings.append(f"Sparse list use ({len(lists)} lists): 5/10")
    else:
        section.score += 3
        section.findings.append(f"List sprawl ({len(lists)} lists, consider archiving): 3/10")

    return section


def score_activity(token: str, full: bool = False) -> Section:
    section = Section(name="Activity", score=0, max_score=25)
    scope = "" if full else " sampled"

    try:
        members = fetch_workspace_members(token)
    except requests.HTTPError:
        members = []
    if members:
        if len(members) >= 3:
            pts = 10
        elif len(members) >= 2:
            pts = 7
        else:
            pts = 4
        section.score += pts
        section.findings.append(f"{len(members)} workspace members: {pts}/10")
    else:
        section.findings.append("Could not read workspace members: 0/10")

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    try:
        people = fetch_records(token, "people", full=full)
    except requests.HTTPError:
        people = []

    recent = 0
    for p in people:
        created = p.get("created_at")
        if not created:
            continue
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if dt >= cutoff:
                recent += 1
        except ValueError:
            continue

    if people:
        pct = recent / len(people) * 100
        pts = percent_score(pct, [(20, 15), (10, 10), (5, 5)])
        section.score += pts
        section.findings.append(
            f"{pct:.0f}% of{scope} People created in last 30d ({recent}/{len(people)}): {pts}/15"
        )
    else:
        section.findings.append("Could not assess record activity: 0/15")

    return section


def render(workspace: dict, sections: list[Section], total: int) -> str:
    name = workspace.get("workspace_name", "Unknown")
    slug = workspace.get("workspace_slug", "")
    out: list[str] = []
    out.append(f"# Attio Audit: {name}")
    out.append("")
    out.append(f"**Workspace:** `{slug}` &nbsp;·&nbsp; **Run:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out.append("")
    out.append(f"## Grade: **{total}/100 ({grade_letter(total)})**")
    out.append("")
    out.append(f"`{bar(total, 100, width=40)}`")
    out.append("")

    for s in sections:
        out.append(f"### {s.name}: {s.score}/{s.max_score}")
        out.append(f"`{bar(s.score, s.max_score)}`")
        out.append("")
        for f in s.findings:
            out.append(f"- {f}")
        out.append("")

    fix_priorities = []
    for s in sections:
        deficit = s.max_score - s.score
        if deficit >= 5:
            fix_priorities.append((deficit, s.name))
    fix_priorities.sort(reverse=True)
    out.append("## Where to focus")
    if fix_priorities:
        for i, (deficit, name) in enumerate(fix_priorities[:3], start=1):
            out.append(f"{i}. **{name}** ({deficit} points available)")
    else:
        out.append("- Workspace is in good shape. Maintain current hygiene.")
    out.append("")

    out.append("---")
    out.append("")
    out.append("Generated by [attio-toolkit](https://github.com/NachoLafuente/attio-toolkit). Open source from [5050Growth](https://5050growth.com).")
    return "\n".join(out)


def render_json(workspace: dict, sections: list[Section], total: int) -> str:
    return json.dumps(
        {
            "workspace": {
                "name": workspace.get("workspace_name"),
                "slug": workspace.get("workspace_slug"),
                "id": workspace.get("workspace_id"),
            },
            "grade": grade_letter(total),
            "score": total,
            "max_score": 100,
            "sections": [
                {"name": s.name, "score": s.score, "max_score": s.max_score, "findings": s.findings}
                for s in sections
            ],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Score an Attio workspace 0-100")
    p.add_argument("--token", help="Attio API token (default: $ATTIO_API_KEY or $ATTIO_OAUTH2)")
    p.add_argument("--json", action="store_true", help="Output JSON instead of markdown")
    p.add_argument(
        "--full",
        action="store_true",
        help="Paginate every record instead of sampling 500. Slower, exact counts.",
    )
    args = p.parse_args()

    token = args.token or os.environ.get("ATTIO_API_KEY") or os.environ.get("ATTIO_OAUTH2")
    if not token:
        print("error: provide --token or set ATTIO_API_KEY", file=sys.stderr)
        return 2

    try:
        ws = fetch_self(token)
    except requests.HTTPError as e:
        print(f"error: auth failed (HTTP {e.response.status_code}). Token invalid or revoked.", file=sys.stderr)
        return 2

    objects = fetch_objects(token)
    sections = [
        score_data_quality(token, full=args.full),
        score_schema(token, objects),
        score_lists(token),
        score_activity(token, full=args.full),
    ]
    total = sum(s.score for s in sections)

    if args.json:
        print(render_json(ws, sections, total))
    else:
        print(render(ws, sections, total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
