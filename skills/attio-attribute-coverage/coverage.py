#!/usr/bin/env python3
"""
attio-attribute-coverage: see which attributes are filled vs unused per object.

Usage:
    ATTIO_API_KEY=<token> python coverage.py
    ATTIO_API_KEY=<token> python coverage.py --object companies
    ATTIO_API_KEY=<token> python coverage.py --json

Output: markdown report. Read-only. Sample-based (up to 500 records per object).
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

WELL_USED = 50
UNDERUSED = 10


def call(token: str, method: str, path: str, body: dict | None = None) -> Any:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resp = requests.request(method, f"{API_BASE}{path}", headers=headers, json=body, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_self(token: str) -> dict:
    return call(token, "GET", "/self")


def fetch_objects(token: str) -> list[dict]:
    return call(token, "GET", "/objects").get("data", [])


def fetch_attributes(token: str, slug: str) -> list[dict]:
    return call(token, "GET", f"/objects/{slug}/attributes").get("data", [])


def fetch_records(token: str, slug: str, limit: int = SAMPLE_LIMIT) -> list[dict]:
    return call(token, "POST", f"/objects/{slug}/records/query", {"limit": limit, "offset": 0}).get("data", [])


def is_filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, list):
        return len(value) > 0
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return bool(value)
    return True


def categorize(pct: float) -> str:
    if pct >= WELL_USED:
        return "well_used"
    if pct >= UNDERUSED:
        return "underused"
    return "bloat"


def category_emoji(cat: str) -> str:
    return {"well_used": "✓", "underused": "⚠", "bloat": "💀"}.get(cat, "?")


def category_label(cat: str) -> str:
    return {"well_used": "Well-used (≥50%)", "underused": "Underused (10-49%)", "bloat": "Probably bloat (<10%)"}.get(cat, cat)


def coverage_for_object(token: str, slug: str, object_label: str) -> dict | None:
    try:
        attrs = fetch_attributes(token, slug)
    except requests.HTTPError:
        return None
    try:
        records = fetch_records(token, slug)
    except requests.HTTPError:
        return None

    if not records or not attrs:
        return None

    filled_counts: dict[str, int] = {}
    for r in records:
        values = r.get("values") or {}
        for attr in attrs:
            api_slug = attr.get("api_slug")
            if not api_slug:
                continue
            if api_slug not in filled_counts:
                filled_counts[api_slug] = 0
            if is_filled(values.get(api_slug)):
                filled_counts[api_slug] += 1

    rows = []
    for attr in attrs:
        api_slug = attr.get("api_slug")
        if not api_slug:
            continue
        count = filled_counts.get(api_slug, 0)
        pct = (count / len(records)) * 100
        rows.append(
            {
                "title": attr.get("title") or api_slug,
                "api_slug": api_slug,
                "type": attr.get("type"),
                "is_system": attr.get("is_system", False),
                "filled_count": count,
                "filled_pct": pct,
                "category": categorize(pct),
            }
        )

    rows.sort(key=lambda r: -r["filled_pct"])
    return {
        "label": object_label,
        "slug": slug,
        "sampled": len(records),
        "total_attrs": len(attrs),
        "rows": rows,
    }


def render_object(data: dict) -> list[str]:
    out: list[str] = []
    out.append(f"## {data['label']} ({data['sampled']} records sampled, {data['total_attrs']} attributes)")
    out.append("")

    by_cat: dict[str, list[dict]] = {"well_used": [], "underused": [], "bloat": []}
    for r in data["rows"]:
        by_cat[r["category"]].append(r)

    for cat in ("well_used", "underused", "bloat"):
        rows = by_cat[cat]
        if not rows:
            continue
        out.append(f"### {category_emoji(cat)} {category_label(cat)}: {len(rows)} attributes")
        out.append("")
        for r in rows:
            sys_tag = " (system)" if r["is_system"] else ""
            out.append(f"- **{r['title']}** `{r['api_slug']}`{sys_tag}: {r['filled_pct']:.0f}% filled ({r['filled_count']}/{data['sampled']})")
        out.append("")

    bloat_custom = [r for r in by_cat["bloat"] if not r["is_system"]]
    if bloat_custom:
        out.append(f"### Suggested cleanup")
        out.append("")
        names = ", ".join(f"`{r['api_slug']}`" for r in bloat_custom[:5])
        more = f" (and {len(bloat_custom) - 5} more)" if len(bloat_custom) > 5 else ""
        out.append(f"Consider archiving these custom attributes if no team workflow depends on them: {names}{more}.")
        out.append("")

    return out


def render(workspace: dict, results: list[dict]) -> str:
    name = workspace.get("workspace_name", "Unknown")
    slug = workspace.get("workspace_slug", "")

    out: list[str] = []
    out.append(f"# Attio Attribute Coverage: {name}")
    out.append("")
    out.append(f"**Workspace:** `{slug}` &nbsp;·&nbsp; **Run:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out.append("")

    total_attrs = sum(d["total_attrs"] for d in results)
    total_bloat = sum(1 for d in results for r in d["rows"] if r["category"] == "bloat" and not r["is_system"])
    total_underused = sum(1 for d in results for r in d["rows"] if r["category"] == "underused" and not r["is_system"])

    out.append(f"## Summary")
    out.append("")
    out.append(f"- **{len(results)}** objects scanned")
    out.append(f"- **{total_attrs}** total attributes")
    out.append(f"- **{total_bloat}** custom attributes filled on <10% of records (probable bloat)")
    out.append(f"- **{total_underused}** custom attributes filled on 10-49% (underused)")
    out.append("")

    for data in results:
        out.extend(render_object(data))

    out.append("---")
    out.append("")
    out.append("System attributes (`(system)`) cannot be deleted but their coverage still tells you what your team actually uses. Custom attributes flagged as bloat are safe candidates to archive.")
    out.append("")
    out.append("Generated by [attio-toolkit](https://github.com/NachoLafuente/attio-toolkit). Open source from [5050Growth](https://5050growth.com).")
    return "\n".join(out)


def render_json(workspace: dict, results: list[dict]) -> str:
    return json.dumps(
        {
            "workspace": {
                "name": workspace.get("workspace_name"),
                "slug": workspace.get("workspace_slug"),
            },
            "objects": results,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Attribute coverage scan for Attio objects")
    p.add_argument("--token")
    p.add_argument("--object", action="append", help="Object slug (repeatable). Default: every object in the workspace.")
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

    if args.object:
        objects_to_scan = [{"api_slug": s, "singular_noun": s.title()} for s in args.object]
    else:
        objects_to_scan = fetch_objects(token)

    results: list[dict] = []
    for obj in objects_to_scan:
        slug = obj.get("api_slug") or (obj.get("singular_noun") or "").lower()
        if not slug:
            continue
        label = obj.get("singular_noun") or slug.title()
        data = coverage_for_object(token, slug, label)
        if data:
            results.append(data)

    if args.json:
        print(render_json(ws, results))
    else:
        print(render(ws, results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
