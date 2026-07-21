import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from psycopg import connect
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from . import funcs
from .modules import anonymizer_n_privacy as anp


async def create_test_data_case(
    form,
    storage_root: Path,
    database_url: str | None = None,
) -> dict[str, str | None]:
    payload = await build_test_case_payload(form)

    if database_url:
        case_name = await run_in_threadpool(save_test_case_to_database, payload, database_url)
    else:
        case_name = await run_in_threadpool(save_test_case_to_file, payload, storage_root)

    return test_case_summary(case_name, payload)


async def replace_test_data_case(
    case_name: str,
    form,
    storage_root: Path,
    database_url: str | None = None,
) -> dict[str, str | None]:
    payload = await build_test_case_payload(form)

    if database_url:
        await run_in_threadpool(replace_test_case_in_database, case_name, payload, database_url)
    else:
        await run_in_threadpool(replace_test_case_file, case_name, payload, storage_root)

    return test_case_summary(case_name, payload)


def delete_test_data_case(
    case_name: str,
    storage_root: Path,
    database_url: str | None = None,
) -> dict[str, str]:
    if database_url:
        delete_test_case_from_database(case_name, database_url)
    else:
        delete_test_case_file(case_name, storage_root)

    return {"name": case_name, "status": "deleted"}


async def build_test_case_payload(form) -> dict[str, Any]:
    cv_file = read_required_upload_file(form, "cv", "CV")
    vacancy_file = read_required_upload_file(form, "vacancy", "vacancy")
    prompt_file = read_optional_upload_file(form, "prompt")

    cv_text = anp.clean_data_for_sensitive_n_safety(
        await funcs.extract_text_from_file(cv_file),
        sensitive=True,
    )
    vacancy_text = anp.clean_data_for_sensitive_n_safety(
        await funcs.extract_text_from_file(vacancy_file),
        sensitive=False,
    )
    prompt_text = await read_optional_text_file(prompt_file)
    career_strategy = anp.sanitize_text(read_text_field(form, "career_strategy"))
    red_flags = anp.sanitize_text(read_text_field(form, "red_flags"))

    return {
        "resume_text": cv_text,
        "vacancy_text": vacancy_text,
        "manual_prompt": prompt_text,
        "career_strategy": career_strategy,
        "red_flags": red_flags,
        "source_metadata": {
            "cv_filename": cv_file.filename,
            "vacancy_filename": vacancy_file.filename,
            "prompt_filename": prompt_file.filename if prompt_file else None,
        },
    }


def list_test_data_cases(
    storage_root: Path,
    database_url: str | None = None,
) -> list[dict[str, str | None]]:
    if database_url:
        with connect(database_url) as connection:
            with connection.cursor() as cursor:
                ensure_test_data_table(cursor)
                cursor.execute(
                    """
                    select id, prompt_text, career_strategy, red_flags
                    from test_data_cases
                    order by id
                    """
                )
                return [
                    test_case_summary(
                        str(row[0]),
                        {
                            "manual_prompt": row[1],
                            "career_strategy": row[2],
                            "red_flags": row[3],
                        },
                    )
                    for row in cursor.fetchall()
                ]

    case_dir = storage_root / "test_data_cases"
    if not case_dir.exists():
        return []

    cases = []
    for path in sorted(case_dir.glob("*.json"), key=lambda item: numeric_sort_key(item.stem)):
        payload = read_json_file(path)
        cases.append(test_case_summary(path.stem, payload))

    return cases


def get_test_data_case(
    case_name: str,
    storage_root=None,
    database_url: str | None = None,
) -> dict[str, str]:
    if database_url:
        with connect(database_url) as connection:
            with connection.cursor() as cursor:
                ensure_test_data_table(cursor)
                cursor.execute(
                    """
                    select cv_text, vacancy_text, prompt_text, career_strategy, red_flags
                    from test_data_cases
                    where id = %s
                    """,
                    (int_case_name(case_name),),
                )
                row = cursor.fetchone()

        if row is None:
            raise HTTPException(status_code=404, detail=f"test_data/{case_name} not found")

        return test_case_payload(row[0], row[1], row[2], row[3], row[4])

    path = safe_child_path(storage_root / "test_data_cases", f"{safe_file_stem(case_name)}.json")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"test_data/{case_name} not found")

    payload = read_json_file(path)
    return test_case_payload(
        payload.get("resume_text", ""),
        payload.get("vacancy_text", ""),
        payload.get("manual_prompt", ""),
        payload.get("career_strategy", ""),
        payload.get("red_flags", ""),
    )


def save_test_case_to_database(payload: dict[str, Any], database_url: str) -> str:
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_test_data_table(cursor)
            cursor.execute(
                """
                insert into test_data_cases (
                    cv_text,
                    vacancy_text,
                    prompt_text,
                    career_strategy,
                    red_flags,
                    source_metadata
                )
                values (%s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    payload["resume_text"],
                    payload["vacancy_text"],
                    payload["manual_prompt"],
                    payload["career_strategy"],
                    payload["red_flags"],
                    Jsonb(payload["source_metadata"]),
                ),
            )
            row = cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create test_data case")

    return str(row[0])


def replace_test_case_in_database(case_name: str, payload: dict[str, Any], database_url: str) -> None:
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_test_data_table(cursor)
            cursor.execute(
                """
                update test_data_cases
                set
                    created_at = now(),
                    cv_text = %s,
                    vacancy_text = %s,
                    prompt_text = %s,
                    career_strategy = %s,
                    red_flags = %s,
                    source_metadata = %s
                where id = %s
                returning id
                """,
                (
                    payload["resume_text"],
                    payload["vacancy_text"],
                    payload["manual_prompt"],
                    payload["career_strategy"],
                    payload["red_flags"],
                    Jsonb(payload["source_metadata"]),
                    int_case_name(case_name),
                ),
            )
            row = cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail=f"test_data/{case_name} not found")


def delete_test_case_from_database(case_name: str, database_url: str) -> None:
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            ensure_test_data_table(cursor)
            cursor.execute(
                """
                delete from test_data_cases
                where id = %s
                returning id
                """,
                (int_case_name(case_name),),
            )
            row = cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail=f"test_data/{case_name} not found")


def save_test_case_to_file(payload: dict[str, Any], storage_root: Path) -> str:
    case_dir = storage_root / "test_data_cases"
    case_dir.mkdir(parents=True, exist_ok=True)
    next_id = next_file_case_id(case_dir)
    path = safe_child_path(case_dir, f"{next_id}.json")
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return next_id


def replace_test_case_file(case_name: str, payload: dict[str, Any], storage_root: Path) -> None:
    path = safe_child_path(storage_root / "test_data_cases", f"{safe_file_stem(case_name)}.json")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"test_data/{case_name} not found")

    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def delete_test_case_file(case_name: str, storage_root: Path) -> None:
    path = safe_child_path(storage_root / "test_data_cases", f"{safe_file_stem(case_name)}.json")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"test_data/{case_name} not found")

    path.unlink()


def ensure_test_data_table(cursor) -> None:
    cursor.execute(
        """
        create table if not exists test_data_cases (
            id bigserial primary key,
            created_at timestamptz not null default now(),
            cv_text text not null,
            vacancy_text text not null,
            prompt_text text not null default '',
            career_strategy text not null default '',
            red_flags text not null default '',
            source_metadata jsonb not null default '{}'::jsonb
        )
        """
    )


def test_case_summary(case_name: str, payload: dict[str, Any]) -> dict[str, str | None]:
    return {
        "name": case_name,
        "cvFile": "cv.txt",
        "vacancyFile": "vacancy.txt",
        "promptFile": "prompt.txt" if payload.get("manual_prompt") else None,
        "redFlagsFile": "red_flags.txt" if payload.get("red_flags") else None,
        "careerStrategyFile": "career_strategy.txt" if payload.get("career_strategy") else None,
    }


def test_case_payload(
    resume_text: str,
    vacancy_text: str,
    manual_prompt: str,
    career_strategy: str,
    red_flags: str,
) -> dict[str, str]:
    return {
        "resumeText": resume_text,
        "vacancyText": vacancy_text,
        "manualPrompt": manual_prompt,
        "careerStrategy": career_strategy,
        "redFlags": red_flags,
    }


def read_required_upload_file(form, field_name: str, label: str) -> UploadFile:
    value = form.get(field_name)
    if not is_upload_file(value):
        raise HTTPException(status_code=422, detail=f"{label}: добавь файл")
    return value


def read_optional_upload_file(form, field_name: str) -> UploadFile | None:
    value = form.get(field_name)
    if value is None:
        return None
    if not is_upload_file(value):
        raise HTTPException(status_code=422, detail=f"{field_name}: ожидался файл")
    return value


def is_upload_file(value: Any) -> bool:
    return (
        hasattr(value, "filename")
        and hasattr(value, "read")
        and callable(value.read)
    )


async def read_optional_text_file(file: UploadFile | None) -> str:
    if file is None:
        return ""

    filename = (file.filename or "").lower()
    if not filename.endswith((".md", ".txt")):
        raise HTTPException(status_code=422, detail="prompt: можно загружать только MD или TXT")

    content = await file.read()
    return content.decode("utf-8").strip()


def read_text_field(form, field_name: str) -> str:
    value = form.get(field_name)
    return value.strip() if isinstance(value, str) else ""


def read_json_file(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def next_file_case_id(case_dir: Path) -> str:
    max_id = 0
    for path in case_dir.glob("*.json"):
        if path.stem.isdigit():
            max_id = max(max_id, int(path.stem))
    return str(max_id + 1)


def numeric_sort_key(value: str) -> tuple[int, str]:
    return (int(value), value) if value.isdigit() else (10**9, value)


def int_case_name(value: str) -> int:
    if not value.isdigit():
        raise HTTPException(status_code=404, detail=f"test_data/{value} not found")
    return int(value)


def safe_file_stem(value: str) -> str:
    safe_value = "".join(char if char.isalnum() or char in "._-" else "_" for char in value)
    return safe_value or "entry"


def safe_child_path(directory: Path, file_name: str) -> Path:
    directory_path = directory.resolve()
    file_path = (directory_path / file_name).resolve()

    if file_path.parent != directory_path:
        raise HTTPException(status_code=422, detail="Invalid file name")

    return file_path
