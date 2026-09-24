"""
Civic Connect - batch ETL pipeline for citizen complaints.

Extract   : CSV export (e.g. from a call centre, WhatsApp desk or legacy system)
Transform : clean, validate, normalise, categorise, prioritise, route to department,
            detect duplicates (within the batch and against the database)
Load      : insert valid rows into public.reports, write rejects to a CSV,
            and log run metrics to public.etl_runs (shown on /analytics).

Usage:
    pip install psycopg2-binary pandas
    export DATABASE_URL="postgresql://..."
    python etl/civic_etl.py complaints.csv [--dry-run]

Expected CSV columns (extra columns are ignored, missing ones are tolerated):
    title, description, category, priority, latitude, longitude, address, reported_at
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

import pandas as pd

CATEGORIES = {"pothole", "streetlight", "trash", "graffiti", "sidewalk", "drainage", "other"}
PRIORITIES = {"low", "medium", "high", "urgent"}
PRIORITY_ALIASES = {"p1": "urgent", "critical": "urgent", "p2": "high", "p3": "medium",
                    "normal": "medium", "p4": "low", "minor": "low"}
CATEGORY_KEYWORDS = {
    "pothole": ["pothole", "gadda", "crater", "road damage"],
    "streetlight": ["streetlight", "street light", "lamp", "bulb", "dark street"],
    "trash": ["garbage", "trash", "waste", "kachra", "litter", "dump"],
    "graffiti": ["graffiti", "vandal", "poster"],
    "sidewalk": ["footpath", "sidewalk", "pavement"],
    "drainage": ["drain", "sewage", "waterlogging", "nala", "overflow", "flood"],
}
DEPARTMENTS = {
    "pothole": "Public Works (Roads)", "sidewalk": "Public Works (Roads)",
    "streetlight": "Electrical Department", "trash": "Solid Waste Management",
    "drainage": "Water & Drainage", "graffiti": "Parks & Beautification",
    "other": "General Administration",
}
URGENT_RE = re.compile(r"accident|injur|live wire|electrocut|collapse|fire|sewage overflow|flood")
HIGH_RE = re.compile(r"danger|school|hospital|children|blocked road")
INDIA_BBOX = (6.0, 38.0, 68.0, 98.0)


def clean_text(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def to_float(v):
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def transform(row: dict, now: datetime) -> tuple[dict | None, list[str], str | None]:
    """Return (clean_record, flags, reject_reason)."""
    flags: list[str] = []
    title = clean_text(row.get("title"))
    desc = clean_text(row.get("description"))
    text = f"{title} {desc}".lower()

    if len(desc) < 10:
        return None, flags, "missing_description"
    if len(title) < 3:
        title = desc[:60]
        flags.append("missing_title")

    # Category
    cat = clean_text(row.get("category")).lower()
    if cat not in CATEGORIES:
        inferred = next((c for c, kws in CATEGORY_KEYWORDS.items() if any(k in text for k in kws)), None)
        flags.append("missing_category" if not cat else "invalid_category")
        cat = inferred or "other"

    # Priority
    pr = clean_text(row.get("priority")).lower()
    pr = PRIORITY_ALIASES.get(pr, pr)
    if pr not in PRIORITIES:
        flags.append("missing_priority" if not pr else "invalid_priority")
        pr = "medium"
    if URGENT_RE.search(text) and pr != "urgent":
        pr = "urgent"; flags.append("priority_escalated")
    elif HIGH_RE.search(text) and pr in ("low", "medium"):
        pr = "high"; flags.append("priority_escalated")

    # Location
    lat, lng = to_float(row.get("latitude")), to_float(row.get("longitude"))
    address = clean_text(row.get("address")) or None
    if (lat is None) != (lng is None) or (lat is not None and (
            not -90 <= lat <= 90 or not -180 <= lng <= 180 or (lat == 0 and lng == 0))):
        lat = lng = None
        flags.append("invalid_location")
    elif lat is not None and not (INDIA_BBOX[0] <= lat <= INDIA_BBOX[1] and INDIA_BBOX[2] <= lng <= INDIA_BBOX[3]):
        flags.append("location_outside_india")
    elif lat is None and not address:
        flags.append("missing_location")

    # Date
    created = pd.to_datetime(row.get("reported_at"), errors="coerce", utc=True, dayfirst=True)
    if pd.isna(created) or created > now + timedelta(minutes=5) or created < now - timedelta(days=365):
        created = now
        flags.append("invalid_date")
    else:
        created = created.to_pydatetime()

    return {
        "title": title[:100], "description": desc[:1000], "category": cat, "priority": pr,
        "latitude": lat, "longitude": lng, "address": address,
        "assigned_department": DEPARTMENTS[cat], "created_at": created,
    }, flags, None


def dedupe_key(r: dict) -> tuple:
    if r["latitude"] is not None:
        return (r["category"], round(r["latitude"], 3), round(r["longitude"], 3))
    return (r["category"], r["title"].lower())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    df = pd.read_csv(args.csv, dtype=str, keep_default_na=False)
    issues: Counter = Counter()
    clean, rejects, seen = [], [], set()

    for i, row in enumerate(df.to_dict("records"), start=2):
        rec, flags, reason = transform(row, now)
        if reason:
            issues[reason] += 1
            rejects.append({**row, "line": i, "reject_reason": reason})
            continue
        key = dedupe_key(rec)
        if key in seen:
            issues["duplicate_in_batch"] += 1
            rejects.append({**row, "line": i, "reject_reason": "duplicate_in_batch"})
            continue
        seen.add(key)
        issues.update(flags)
        rec["quality_flags"] = flags
        clean.append(rec)

    flagged = sum(1 for r in clean if r["quality_flags"])
    print(f"read={len(df)} clean={len(clean)} rejected={len(rejects)} flagged={flagged}")
    print("issues:", dict(issues))

    if rejects:
        out = os.path.splitext(args.csv)[0] + "_rejects.csv"
        pd.DataFrame(rejects).to_csv(out, index=False)
        print("rejects written to", out)

    if args.dry_run:
        return 0

    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    with conn, conn.cursor() as cur:
        # The database trigger re-validates every row and flags duplicates
        # against existing open complaints, so the DB stays the source of truth.
        execute_values(cur, """
            INSERT INTO public.reports
              (title, description, category, priority, latitude, longitude,
               address, assigned_department, created_at)
            VALUES %s RETURNING is_duplicate, quality_flags
        """, [(r["title"], r["description"], r["category"], r["priority"], r["latitude"],
               r["longitude"], r["address"], r["assigned_department"], r["created_at"]) for r in clean],
            fetch=True) if clean else None
        cur.execute("""
            INSERT INTO public.etl_runs
              (started_at, finished_at, rows_read, rows_loaded, rows_rejected, rows_flagged, issues)
            VALUES (%s, now(), %s, %s, %s, %s, %s)
        """, (now, len(df), len(clean), len(rejects), flagged, json.dumps(issues)))
    conn.close()
    print("loaded", len(clean), "rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
