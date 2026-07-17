"""Replay a saved auto-vacancy search plan against Bright Data.

This diagnostic script reads `search_plan_json` from `auto_vacancy_searches`,
builds the same Bright Data input shape after `BrightDataModel` defaults, and
saves request/response diagnostics under `debug/`.

It never prints or saves API keys, authorization headers, CV text, prompts, or
raw user inputs.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from psycopg import connect

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
DEBUG_DIR = PROJECT_ROOT / "debug"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.modules.bright_data_provaider import BrightDataModel  # noqa: E402


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def request_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError as error:
        raise RuntimeError(
            f"Bright Data returned non-JSON response: status={response.status_code}, body={response.text[:500]}"
        ) from error


def save_debug_file(prefix: str, payload: Any) -> Path:
    DEBUG_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = DEBUG_DIR / f"{prefix}_{stamp}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def get_database_url(database_source: str) -> str:
    settings = get_settings()
    if database_source == "local":
        database_url = settings.database_url
    elif database_source == "online":
        database_url = settings.database_online_url
    else:
        database_url = settings.database_online_url or settings.database_url

    if not database_url:
        raise SystemExit(f"Missing database URL for source: {database_source}")
    return database_url


def load_search_plan(search_id: str | None, username: str | None, database_source: str) -> dict[str, Any]:
    query = """
        select search_id::text, username, search_name, status, search_plan_json
        from auto_vacancy_searches
        where search_plan_json is not null
    """
    params: list[Any] = []

    if search_id:
        query += " and search_id = %s"
        params.append(search_id)

    if username:
        query += " and username = %s"
        params.append(username)

    query += " order by updated_at desc limit 1"

    with connect(get_database_url(database_source), connect_timeout=8) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()

    if row is None:
        raise SystemExit("No saved search_plan_json found for the requested filters")

    saved_search_id, saved_username, search_name, status, search_plan = row
    if not isinstance(search_plan, dict):
        raise SystemExit("Saved search_plan_json is not a JSON object")

    return {
        "search_id": saved_search_id,
        "username": saved_username,
        "search_name": search_name,
        "status": status,
        "search_plan": search_plan,
    }


def build_provider_input(search_plan: dict[str, Any]) -> dict[str, Any]:
    settings = BrightDataModel.model_validate(search_plan)
    return {
        "location": settings.location,
        "keyword": settings.keyword,
        "country": settings.country or "",
        "time_range": settings.time_range,
        "job_type": settings.job_type,
        "experience_level": settings.experience_level,
        "remote": settings.remote,
        "company": settings.company,
        "selective_search": settings.selective_search,
        "jobs_to_not_include": settings.jobs_to_not_include,
        "location_radius": settings.location_radius,
    }


def summarize_records(data: Any) -> dict[str, Any]:
    records = data if isinstance(data, list) else []
    valid = [item for item in records if isinstance(item, dict) and item.get("job_posting_id")]
    errors = [item for item in records if isinstance(item, dict) and (item.get("error") or item.get("error_code"))]
    return {
        "response_type": type(data).__name__,
        "records_count": len(records),
        "valid_records_count": len(valid),
        "error_rows_count": len(errors),
        "sample_titles": [item.get("job_title") for item in valid[:10]],
        "sample_companies": [item.get("company_name") for item in valid[:10]],
        "sample_locations": [item.get("job_location") for item in valid[:10]],
        "sample_job_ids": [item.get("job_posting_id") for item in valid[:10]],
    }


def get_progress(headers: dict[str, str], api_base: str, snapshot_id: str) -> dict[str, Any]:
    response = requests.get(f"{api_base}/progress/{snapshot_id}", headers=headers, timeout=15)
    data = request_json(response)
    if response.status_code >= 400:
        raise RuntimeError(f"Progress request failed: status={response.status_code}, body={data}")
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected progress response shape: {type(data).__name__}")
    return data


def download_snapshot(headers: dict[str, str], api_base: str, snapshot_id: str) -> Any:
    response = requests.get(
        f"{api_base}/snapshot/{snapshot_id}",
        headers=headers,
        params={"format": "json"},
        timeout=30,
    )
    data = request_json(response)
    if response.status_code >= 400:
        raise RuntimeError(f"Snapshot download failed: status={response.status_code}, body={data}")
    return data


def run_bright_data_probe(provider_input: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    settings = get_settings()
    if not settings.bright_data_api_key:
        raise SystemExit("Missing BRIGHT_DATA_API_KEY")

    api_base = settings.bright_data_api_base.rstrip("/")
    params = {
        "dataset_id": settings.bright_data_linkedin_jobs_dataset_id,
        "type": "discover_new",
        "discover_by": "keyword",
        "include_errors": "true",
        "notify": "false",
        "limit_per_input": str(args.limit_per_input),
    }
    body = [provider_input]
    headers = {
        "Authorization": f"Bearer {settings.bright_data_api_key}",
        "Content-Type": "application/json",
    }

    report: dict[str, Any] = {
        "created_at_utc": utc_now_iso(),
        "mode": "run" if args.run else "dry_run",
        "endpoint": f"{api_base}/trigger",
        "params": params,
        "body": body,
        "events": [],
    }

    if not args.run:
        return report

    response = requests.post(f"{api_base}/trigger", headers=headers, params=params, json=body, timeout=30)
    trigger_data = request_json(response)
    report["events"].append(
        {
            "type": "trigger_response",
            "checked_at_utc": utc_now_iso(),
            "status_code": response.status_code,
            "body": trigger_data,
        }
    )
    if response.status_code >= 400:
        return report

    snapshot_id = trigger_data.get("snapshot_id") if isinstance(trigger_data, dict) else None
    if not snapshot_id:
        report["events"].append({"type": "error", "message": "No snapshot_id in trigger response"})
        return report

    started = time.monotonic()
    while True:
        elapsed = time.monotonic() - started
        progress = get_progress(headers, api_base, snapshot_id)
        status = str(progress.get("status") or "")
        report["events"].append(
            {
                "type": "poll",
                "checked_at_utc": utc_now_iso(),
                "elapsed_seconds": round(elapsed, 3),
                "status": status,
                "progress": progress,
            }
        )
        print(json.dumps({"elapsed_seconds": round(elapsed, 1), "status": status}, ensure_ascii=False))

        if status == "ready":
            snapshot_data = download_snapshot(headers, api_base, snapshot_id)
            snapshot_path = save_debug_file(f"bright_data_search_plan_probe_snapshot_{snapshot_id}", snapshot_data)
            report["result"] = {
                "snapshot_id": snapshot_id,
                "status": status,
                "snapshot_path": str(snapshot_path),
                "snapshot_summary": summarize_records(snapshot_data),
            }
            return report

        if status == "failed":
            report["result"] = {"snapshot_id": snapshot_id, "status": status}
            return report

        if elapsed >= args.max_wait_seconds:
            report["result"] = {
                "snapshot_id": snapshot_id,
                "status": status,
                "timed_out": True,
                "max_wait_seconds": args.max_wait_seconds,
            }
            return report

        time.sleep(args.poll_seconds)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay saved search_plan_json against Bright Data async trigger.")
    parser.add_argument("--run", action="store_true", help="Actually call Bright Data. Without this, dry-run only.")
    parser.add_argument("--search-id", default=None, help="Specific auto_vacancy_searches.search_id to replay.")
    parser.add_argument("--username", default=None, help="Optional username filter. Defaults to latest saved plan.")
    parser.add_argument("--database-source", choices=["online", "local", "auto"], default="online")
    parser.add_argument("--limit-per-input", type=int, default=3)
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--max-wait-seconds", type=float, default=120.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit_per_input < 1 or args.limit_per_input > 10:
        raise SystemExit("--limit-per-input must be between 1 and 10 for this safety probe")
    if args.poll_seconds < 1:
        raise SystemExit("--poll-seconds must be >= 1")

    saved = load_search_plan(args.search_id, args.username, args.database_source)
    provider_input = build_provider_input(saved["search_plan"])
    report = run_bright_data_probe(provider_input, args)
    report["saved_search"] = {
        "search_id": saved["search_id"],
        "username": saved["username"],
        "search_name": saved["search_name"],
        "status": saved["status"],
    }
    report["provider_input_after_backend_defaults"] = provider_input

    path = save_debug_file("bright_data_search_plan_probe", report)
    print(f"Debug report: {path}")
    result = report.get("result") or {}
    if result:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
