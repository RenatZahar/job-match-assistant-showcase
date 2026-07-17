import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from psycopg import connect
from psycopg.types.json import Jsonb


FORBIDDEN_RAW_INPUT_KEYS = {
    "resume",
    "resumeText",
    "resumeFile",
    "resume_text",
    "resume_file",
    "vacancy",
    "vacancyText",
    "vacancyFile",
    "vacancy_text",
    "vacancy_file",
}

SAFE_MATCH_KEYS = (
    "match_id",
    "match_score",
    "recommendation",
    "confidence",
    "matched_requirements_count",
    "missing_or_unclear_requirements_count",
    "red_flags_count",
    "openai_model",
    "prompt_mode",
    "run_mode",
    "locale",
)


def save_feedback(
    payload: dict[str, Any],
    storage_root: Path,
    database_url: str | None = None,
) -> dict[str, str]:
    reject_raw_input_fields(payload)

    feedback_id = read_required_string(payload, "id")
    created_at = read_required_string(payload, "created_at")
    message = read_required_string(payload, "message")

    if not message.strip():
        raise HTTPException(status_code=422, detail="message is required")

    if database_url:
        save_feedback_to_database(payload, database_url)
        return {"id": feedback_id, "created_at": created_at}

    feedback_dir = storage_root / "feedback_data"
    feedback_dir.mkdir(parents=True, exist_ok=True)
    feedback_path = safe_child_path(feedback_dir, f"{safe_file_stem(feedback_id)}.json")
    feedback_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {"id": feedback_id, "created_at": created_at}


def save_app_log(
    payload: dict[str, Any],
    storage_root: Path,
    database_url: str | None = None,
) -> dict[str, str]:
    reject_raw_input_fields(payload)

    created_at = read_required_string(payload, "created_at")
    read_required_string(payload, "id")
    read_required_string(payload, "event")

    if database_url:
        save_app_log_to_database(payload, database_url)
        return {"status": "ok"}

    log_dir = storage_root / "app_logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_date = safe_file_stem(created_at[:10] or "unknown-date")
    log_path = safe_child_path(log_dir, f"{log_date}.ndjson")
    with log_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")

    return {"status": "ok"}


def list_feedback_summaries(
    storage_root: Path,
    database_url: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    safe_limit = min(max(limit, 1), 200)

    if database_url:
        return list_feedback_summaries_from_database(database_url, safe_limit)

    feedback_dir = storage_root / "feedback_data"
    if not feedback_dir.exists():
        return {"count": 0, "items": []}

    payloads: list[dict[str, Any]] = []
    for feedback_path in feedback_dir.glob("*.json"):
        try:
            payload = json.loads(feedback_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue

        if isinstance(payload, dict):
            payloads.append(payload)

    payloads.sort(key=lambda payload: read_sortable_created_at(payload), reverse=True)
    return {
        "count": len(payloads),
        "items": [summarize_feedback_payload(payload) for payload in payloads[:safe_limit]],
    }


def save_feedback_to_database(payload: dict[str, Any], database_url: str) -> None:
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_feedback_tables(cursor)
            cursor.execute(
                """
                insert into feedback_entries (id, created_at, payload)
                values (%s, %s, %s)
                on conflict (id) do update
                set created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (
                    payload["id"],
                    payload["created_at"],
                    Jsonb(payload),
                ),
            )


def save_app_log_to_database(payload: dict[str, Any], database_url: str) -> None:
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_feedback_tables(cursor)
            cursor.execute(
                """
                insert into app_log_entries (id, created_at, event, level, payload)
                values (%s, %s, %s, %s, %s)
                on conflict (id) do update
                set created_at = excluded.created_at,
                    event = excluded.event,
                    level = excluded.level,
                    payload = excluded.payload
                """,
                (
                    payload["id"],
                    payload["created_at"],
                    payload["event"],
                    payload.get("level"),
                    Jsonb(payload),
                ),
            )


def list_feedback_summaries_from_database(database_url: str, limit: int, full_feedback_text = False) -> dict[str, Any]:
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass('public.feedback_entries')")
            if cursor.fetchone()[0] is None:
                return {"count": 0, "items": []}

            cursor.execute("select count(*) from feedback_entries")
            count = cursor.fetchone()[0]
            cursor.execute(
                """
                select payload
                from feedback_entries
                order by created_at desc
                limit %s
                """,
                (limit,),
            )
            payloads = [row[0] for row in cursor.fetchall() if isinstance(row[0], dict)]

    return {
        "count": count,
        "items": [summarize_feedback_payload(payload, full_feedback_text) for payload in payloads],
    }


def summarize_feedback_payload(payload: dict[str, Any], full_feedback_text = False) -> dict[str, Any]:
    message = payload.get("message")
    expected = payload.get("expected")
    input_summary = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    match = payload.get("match")
    if not full_feedback_text:
        data = {
            "id": stringify(payload.get("id")),
            "created_at": stringify(payload.get("created_at")),
            "type": stringify(payload.get("type")),
            "message_length": len(message) if isinstance(message, str) else 0,
            "expected_length": len(expected) if isinstance(expected, str) else 0,
            "page": stringify(payload.get("page")),
            "api_mode": stringify(payload.get("api_mode")),
            "input": {
                "resume_source": stringify(input_summary.get("resume_source")),
                "vacancy_source": stringify(input_summary.get("vacancy_source")),
                "has_career_strategy": bool(input_summary.get("has_career_strategy")),
                "has_red_flags": bool(input_summary.get("has_red_flags")),
            },
            "match": summarize_match(match),
        }
    else:
        data = {
            "id": stringify(payload.get("id")),
            "created_at": stringify(payload.get("created_at")),
            "type": stringify(payload.get("type")),
            "message": message,
            "page": stringify(payload.get("page")),
            "api_mode": stringify(payload.get("api_mode")),
            "input": {
                "resume_source": stringify(input_summary.get("resume_source")),
                "vacancy_source": stringify(input_summary.get("vacancy_source")),
                "has_career_strategy": bool(input_summary.get("has_career_strategy")),
                "has_red_flags": bool(input_summary.get("has_red_flags")),
            },
            "match": summarize_match(match),
            }
    return data


def summarize_match(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    return {key: value.get(key) for key in SAFE_MATCH_KEYS}


def read_sortable_created_at(payload: dict[str, Any]) -> str:
    value = payload.get("created_at")
    return value if isinstance(value, str) else ""


def stringify(value: Any) -> str:
    return value if isinstance(value, str) else ""


def ensure_feedback_tables(cursor) -> None:
    cursor.execute(
        """
        create table if not exists feedback_entries (
            id text primary key,
            created_at timestamptz not null,
            payload jsonb not null
        )
        """
    )
    cursor.execute(
        """
        create table if not exists app_log_entries (
            id text primary key,
            created_at timestamptz not null,
            event text not null,
            level text,
            payload jsonb not null
        )
        """
    )


def reject_raw_input_fields(value: Any) -> None:
    if contains_forbidden_key(value):
        raise HTTPException(
            status_code=422,
            detail="Payload must not include raw CV or vacancy fields",
        )


def contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, list):
        return any(contains_forbidden_key(item) for item in value)

    if not isinstance(value, dict):
        return False

    return any(
        key in FORBIDDEN_RAW_INPUT_KEYS or contains_forbidden_key(nested_value)
        for key, nested_value in value.items()
    )


def read_required_string(payload: dict[str, Any], field_name: str) -> str:
    value = payload.get(field_name)

    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=422, detail=f"{field_name} is required")

    return value


def safe_file_stem(value: str) -> str:
    safe_value = "".join(char if char.isalnum() or char in "._-" else "_" for char in value)
    return safe_value or "entry"


def safe_child_path(directory: Path, file_name: str) -> Path:
    directory_path = directory.resolve()
    file_path = (directory_path / file_name).resolve()

    if file_path.parent != directory_path:
        raise HTTPException(status_code=422, detail="Invalid file name")

    return file_path
