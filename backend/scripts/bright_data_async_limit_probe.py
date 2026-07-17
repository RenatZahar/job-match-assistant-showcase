"""Probe Bright Data async LinkedIn keyword discovery result limits.

This script is intentionally not part of the production backend flow.
It starts at most one Bright Data async snapshot when called with --run,
polls collected record count, and cancels the snapshot if it crosses a
small safety threshold.

It never prints the API key.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


DATASET_ID = "gd_lpfll7v5hcqtkxl6l"
API_BASE = "https://api.brightdata.com/datasets/v3"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"
DEBUG_DIR = PROJECT_ROOT / "debug"


def read_env_value(name: str) -> str:
    value = os.environ.get(name)
    if value:
        return value.strip()

    if not ENV_FILE.exists():
        return ""

    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw_value = stripped.split("=", 1)
        if key.strip().lower() == name.lower():
            return raw_value.strip().strip('"').strip("'")
    return ""


def request_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError as error:
        raise RuntimeError(
            f"Bright Data returned non-JSON response: status={response.status_code}, body={response.text[:500]}"
        ) from error


def save_debug_report(report: dict[str, Any]) -> Path:
    DEBUG_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = DEBUG_DIR / f"bright_data_async_limit_probe_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_snapshot_info(headers: dict[str, str], snapshot_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{API_BASE}/snapshots",
        headers=headers,
        params={
            "dataset_id": DATASET_ID,
            "trigger_type": "API",
            "limit": 50,
        },
        timeout=15,
    )
    data = request_json(response)
    if response.status_code >= 400:
        raise RuntimeError(f"Snapshots request failed: status={response.status_code}, body={data}")
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected snapshots response shape: {type(data).__name__}")

    for item in data:
        if isinstance(item, dict) and item.get("id") == snapshot_id:
            return item
    return {}


def get_progress(headers: dict[str, str], snapshot_id: str) -> dict[str, Any]:
    response = requests.get(f"{API_BASE}/progress/{snapshot_id}", headers=headers, timeout=15)
    data = request_json(response)
    if response.status_code >= 400:
        raise RuntimeError(f"Progress request failed: status={response.status_code}, body={data}")
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected progress response shape: {type(data).__name__}")
    return data


def cancel_snapshot(headers: dict[str, str], snapshot_id: str) -> tuple[int, str]:
    response = requests.post(f"{API_BASE}/snapshot/{snapshot_id}/cancel", headers=headers, timeout=15)
    return response.status_code, response.text[:500]


def download_snapshot(headers: dict[str, str], snapshot_id: str) -> tuple[Path, Any]:
    response = requests.get(
        f"{API_BASE}/snapshot/{snapshot_id}",
        headers=headers,
        params={"format": "json"},
        timeout=30,
    )
    data = request_json(response)
    if response.status_code >= 400:
        raise RuntimeError(f"Snapshot download failed: status={response.status_code}, body={data}")

    DEBUG_DIR.mkdir(exist_ok=True)
    path = DEBUG_DIR / f"bright_data_async_limit_probe_snapshot_{snapshot_id}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path, data


def summarize_snapshot_data(data: Any) -> dict[str, Any]:
    if not isinstance(data, list):
        return {"type": type(data).__name__, "count": None}

    valid_records = [item for item in data if isinstance(item, dict) and item.get("job_posting_id")]
    error_rows = [item for item in data if isinstance(item, dict) and item.get("error")]
    return {
        "type": "list",
        "count": len(data),
        "valid_records": len(valid_records),
        "error_rows": len(error_rows),
        "job_posting_ids": [item.get("job_posting_id") for item in valid_records[:20]],
        "job_titles": [item.get("job_title") for item in valid_records[:20]],
    }


def build_input(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "location": args.location,
        "keyword": args.keyword,
        "country": args.country,
        "time_range": args.time_range,
        "job_type": args.job_type,
        "experience_level": args.experience_level,
        "remote": args.remote,
        "company": args.company,
        "selective_search": args.selective_search,
        "jobs_to_not_include": [],
        "location_radius": args.location_radius,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Test whether Bright Data async trigger can cap LinkedIn keyword discovery results."
    )
    parser.add_argument("--run", action="store_true", help="Actually call Bright Data. Without this, dry-run only.")
    parser.add_argument("--target", type=int, default=10, help="Requested provider limit.")
    parser.add_argument(
        "--limit-multiple-results",
        type=int,
        default=None,
        help="Optional total request limit. If omitted, only limit_per_input is sent.",
    )
    parser.add_argument("--hard-stop", type=int, default=25, help="Cancel snapshot when dataset_size reaches this.")
    parser.add_argument("--poll-seconds", type=float, default=1.0, help="Polling interval. 1.0 is safer than 0.1.")
    parser.add_argument("--max-runtime-seconds", type=float, default=30.0, help="Cancel and stop after this time.")
    parser.add_argument("--wrapped-input", action="store_true", help='Send {"input": [...]} instead of raw input array.')
    parser.add_argument("--download-if-ready", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--download-max-records", type=int, default=20)

    parser.add_argument("--keyword", default='"Senior Java Backend Engineer"')
    parser.add_argument("--location", default="Germany")
    parser.add_argument("--country", default="DE")
    parser.add_argument("--time-range", default="Past week")
    parser.add_argument("--job-type", default="Full-time")
    parser.add_argument("--experience-level", default="Mid-Senior level")
    parser.add_argument("--remote", default="")
    parser.add_argument("--company", default="")
    parser.add_argument("--location-radius", default="")
    parser.add_argument("--selective-search", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.target < 1:
        raise SystemExit("--target must be >= 1")
    if args.limit_multiple_results is not None and args.limit_multiple_results < 1:
        raise SystemExit("--limit-multiple-results must be >= 1 when provided")
    if args.hard_stop < args.target:
        raise SystemExit("--hard-stop must be >= --target")
    if args.poll_seconds < 0.5:
        raise SystemExit("--poll-seconds below 0.5 is too aggressive for this management API probe")

    api_key = read_env_value("BRIGHT_DATA_API_KEY") or read_env_value("bright_data_api_key")
    if not api_key:
        raise SystemExit("Missing BRIGHT_DATA_API_KEY in environment or .env")

    input_item = build_input(args)
    body: Any = {"input": [input_item]} if args.wrapped_input else [input_item]
    params = {
        "dataset_id": DATASET_ID,
        "type": "discover_new",
        "discover_by": "keyword",
        "include_errors": "true",
        "notify": "false",
        "limit_per_input": str(args.target),
    }
    if args.limit_multiple_results is not None:
        params["limit_multiple_results"] = str(args.limit_multiple_results)
    report: dict[str, Any] = {
        "mode": "dry_run" if not args.run else "run",
        "created_at_utc": utc_now_iso(),
        "params": params,
        "body": body,
        "safety": {
            "target": args.target,
            "limit_multiple_results": args.limit_multiple_results,
            "hard_stop": args.hard_stop,
            "poll_seconds": args.poll_seconds,
            "max_runtime_seconds": args.max_runtime_seconds,
            "download_if_ready": args.download_if_ready,
            "download_max_records": args.download_max_records,
        },
        "events": [],
    }

    if not args.run:
        path = save_debug_report(report)
        print("Dry run only. Add --run to create a real Bright Data snapshot.")
        print(f"Debug report: {path}")
        print(json.dumps({"params": params, "body": body}, ensure_ascii=False, indent=2))
        return 0

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post(f"{API_BASE}/trigger", headers=headers, params=params, json=body, timeout=30)
    trigger_data = request_json(response)
    report["events"].append(
        {
            "type": "trigger_response",
            "checked_at_utc": utc_now_iso(),
            "elapsed_seconds": 0,
            "status_code": response.status_code,
            "body": trigger_data,
        }
    )
    if response.status_code >= 400:
        path = save_debug_report(report)
        print(f"Trigger failed. Debug report: {path}")
        return 2

    snapshot_id = trigger_data.get("snapshot_id") if isinstance(trigger_data, dict) else None
    if not snapshot_id:
        report["events"].append({"type": "error", "message": "No snapshot_id in trigger response"})
        path = save_debug_report(report)
        print(f"No snapshot_id returned. Debug report: {path}")
        return 2

    print(f"Snapshot started: {snapshot_id}")
    started = time.monotonic()
    cancelled = False
    last_status = ""
    last_dataset_size: int | None = None
    max_dataset_size_seen = 0

    while True:
        elapsed = time.monotonic() - started
        progress = get_progress(headers, snapshot_id)
        snapshot_info = get_snapshot_info(headers, snapshot_id)
        status = str(progress.get("status") or snapshot_info.get("status") or "")
        dataset_size = snapshot_info.get("dataset_size")
        if isinstance(dataset_size, int):
            last_dataset_size = dataset_size
            max_dataset_size_seen = max(max_dataset_size_seen, dataset_size)
        last_status = status

        event = {
            "type": "poll",
            "checked_at_utc": utc_now_iso(),
            "elapsed_seconds": round(elapsed, 3),
            "status": status,
            "dataset_size": dataset_size,
            "progress_response": progress,
            "snapshot_info": snapshot_info,
        }
        report["events"].append(event)
        print(
            json.dumps(
                {
                    "type": event["type"],
                    "checked_at_utc": event["checked_at_utc"],
                    "elapsed_seconds": event["elapsed_seconds"],
                    "status": event["status"],
                    "dataset_size": event["dataset_size"],
                },
                ensure_ascii=False,
            )
        )

        if isinstance(dataset_size, int) and dataset_size >= args.hard_stop and status != "ready":
            code, text = cancel_snapshot(headers, snapshot_id)
            report["events"].append(
                {
                    "type": "cancel",
                    "checked_at_utc": utc_now_iso(),
                    "elapsed_seconds": round(time.monotonic() - started, 3),
                    "reason": "hard_stop",
                    "dataset_size_at_cancel": dataset_size,
                    "status_code": code,
                    "body": text,
                }
            )
            print(f"Cancel requested after hard-stop: status={code}")
            cancelled = True
            break

        if status in {"ready", "failed"}:
            break

        if elapsed >= args.max_runtime_seconds:
            code, text = cancel_snapshot(headers, snapshot_id)
            report["events"].append(
                {
                    "type": "cancel",
                    "checked_at_utc": utc_now_iso(),
                    "elapsed_seconds": round(time.monotonic() - started, 3),
                    "reason": "max_runtime",
                    "dataset_size_at_cancel": dataset_size,
                    "status_code": code,
                    "body": text,
                }
            )
            print(f"Cancel requested after max runtime: status={code}")
            cancelled = True
            break

        time.sleep(args.poll_seconds)

    final_progress: dict[str, Any] | None = None
    final_snapshot_info: dict[str, Any] | None = None
    try:
        final_progress = get_progress(headers, snapshot_id)
        final_snapshot_info = get_snapshot_info(headers, snapshot_id)
    except Exception as error:  # noqa: BLE001 - probe must save diagnostics instead of hiding partial data.
        report["events"].append(
            {
                "type": "final_state_error",
                "checked_at_utc": utc_now_iso(),
                "message": str(error),
            }
        )

    report["result"] = {
        "snapshot_id": snapshot_id,
        "cancelled": cancelled,
        "finished_at_utc": utc_now_iso(),
        "runtime_seconds": round(time.monotonic() - started, 3),
        "last_status": last_status,
        "last_dataset_size": last_dataset_size,
        "max_dataset_size_seen": max_dataset_size_seen,
        "final_progress": final_progress,
        "final_snapshot_info": final_snapshot_info,
    }
    final_status = (final_progress or {}).get("status") or (final_snapshot_info or {}).get("status")
    final_dataset_size = (final_snapshot_info or {}).get("dataset_size")
    if (
        args.download_if_ready
        and final_status == "ready"
        and isinstance(final_dataset_size, int)
        and final_dataset_size <= args.download_max_records
    ):
        try:
            snapshot_path, snapshot_data = download_snapshot(headers, snapshot_id)
            report["result"]["downloaded_snapshot_path"] = str(snapshot_path)
            report["result"]["downloaded_snapshot_summary"] = summarize_snapshot_data(snapshot_data)
        except Exception as error:  # noqa: BLE001 - probe must preserve final diagnostics.
            report["events"].append(
                {
                    "type": "download_error",
                    "checked_at_utc": utc_now_iso(),
                    "message": str(error),
                }
            )
    path = save_debug_report(report)
    print(f"Debug report: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
