import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(storage_root: Path, database_url: str | None = None) -> TestClient:
    settings = Settings(
        app_env="test",
        database_url=database_url,
        feedback_storage_dir=storage_root,
    )
    return TestClient(create_app(settings))


def make_auth_client(storage_root: Path) -> TestClient:
    settings = Settings(
        app_env="test",
        database_url=None,
        feedback_storage_dir=storage_root,
        basic_auth_users="admin:secret",
    )
    return TestClient(create_app(settings))


def test_feedback_endpoint_saves_json_without_raw_cv_fields(tmp_path):
    client = make_client(tmp_path)

    response = client.post(
        "/feedback",
        json={
            "id": "feedback_test_1",
            "created_at": "2026-05-28T12:00:00.000Z",
            "type": "other",
            "message": "Something is wrong.",
            "page": "match",
            "api_mode": "api",
            "browser": {"user_agent": "pytest"},
            "input": {
                "resume_source": "empty",
                "vacancy_source": "empty",
                "has_career_strategy": False,
                "has_red_flags": False,
            },
            "match": None,
        },
    )

    assert response.status_code == 201
    assert response.json() == {
        "id": "feedback_test_1",
        "created_at": "2026-05-28T12:00:00.000Z",
    }

    saved_file = tmp_path / "feedback_data" / "feedback_test_1.json"
    assert saved_file.exists()
    saved_payload = json.loads(saved_file.read_text(encoding="utf-8"))
    assert saved_payload["message"] == "Something is wrong."
    assert "resumeText" not in json.dumps(saved_payload)


def test_feedback_endpoint_rejects_raw_cv_fields(tmp_path):
    client = make_client(tmp_path)

    response = client.post(
        "/feedback",
        json={
            "id": "feedback_bad",
            "created_at": "2026-05-28T12:00:00.000Z",
            "type": "other",
            "message": "bad payload",
            "resumeText": "raw cv",
            "page": "match",
            "api_mode": "api",
            "browser": {"user_agent": "pytest"},
            "input": {
                "resume_source": "text",
                "vacancy_source": "empty",
                "has_career_strategy": False,
                "has_red_flags": False,
            },
            "match": None,
        },
    )

    assert response.status_code == 422
    assert not (tmp_path / "feedback_data" / "feedback_bad.json").exists()


def test_app_logs_endpoint_appends_ndjson_without_raw_cv_fields(tmp_path):
    client = make_client(tmp_path)

    response = client.post(
        "/app_logs",
        json={
            "id": "log_test_1",
            "created_at": "2026-05-28T12:01:00.000Z",
            "event": "match_failed",
            "level": "error",
            "page": "match",
            "api_mode": "api",
            "browser": {"user_agent": "pytest"},
            "input": {
                "resume_source": "file",
                "vacancy_source": "text",
                "has_career_strategy": True,
                "has_red_flags": False,
            },
            "match": None,
            "error": {"message": "Match provider failed"},
        },
    )

    assert response.status_code == 201
    assert response.json() == {"status": "ok"}

    saved_file = tmp_path / "app_logs" / "2026-05-28.ndjson"
    assert saved_file.exists()
    saved_lines = saved_file.read_text(encoding="utf-8").splitlines()
    assert len(saved_lines) == 1
    saved_payload = json.loads(saved_lines[0])
    assert saved_payload["event"] == "match_failed"
    assert saved_payload["error"]["message"] == "Match provider failed"


def test_feedback_endpoint_uses_database_when_database_url_is_configured(tmp_path, monkeypatch):
    calls = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            calls.append((sql, params))

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr("app.feedback_storage.connect", lambda database_url: FakeConnection())
    client = make_client(tmp_path, database_url="postgresql://neon.example/test")

    response = client.post(
        "/feedback",
        json={
            "id": "feedback_db_1",
            "created_at": "2026-05-28T12:00:00.000Z",
            "type": "other",
            "message": "Persist me.",
            "page": "match",
            "api_mode": "api",
            "browser": {"user_agent": "pytest"},
            "input": {
                "resume_source": "empty",
                "vacancy_source": "empty",
                "has_career_strategy": False,
                "has_red_flags": False,
            },
            "match": None,
        },
    )

    assert response.status_code == 201
    assert any("insert into feedback_entries" in sql.lower() for sql, _ in calls)
    assert not (tmp_path / "feedback_data" / "feedback_db_1.json").exists()


def test_admin_feedback_lists_safe_summaries_without_raw_text(tmp_path):
    client = make_client(tmp_path)
    feedback_dir = tmp_path / "feedback_data"
    feedback_dir.mkdir()
    feedback_dir.joinpath("feedback_admin_1.json").write_text(
        json.dumps(
            {
                "id": "feedback_admin_1",
                "created_at": "2026-06-11T09:00:00.000Z",
                "type": "wrong_score",
                "message": "This private comment must not be returned.",
                "expected": "This private expectation must not be returned.",
                "page": "match",
                "api_mode": "api",
                "browser": {"user_agent": "pytest private user agent"},
                "input": {
                    "resume_source": "file",
                    "vacancy_source": "text",
                    "has_career_strategy": True,
                    "has_red_flags": False,
                },
                "match": {
                    "match_id": 42,
                    "match_score": 73,
                    "recommendation": "maybe",
                    "confidence": "medium",
                    "score_breakdown": {"hard_skills": 70},
                    "matched_requirements_count": 3,
                    "missing_or_unclear_requirements_count": 2,
                    "red_flags_count": 1,
                    "openai_model": "gpt-5-mini",
                    "prompt_mode": "template",
                    "run_mode": "normal",
                    "locale": "ru",
                },
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/admin/feedback")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"] == [
        {
            "id": "feedback_admin_1",
            "created_at": "2026-06-11T09:00:00.000Z",
            "type": "wrong_score",
            "message_length": 42,
            "expected_length": 46,
            "page": "match",
            "api_mode": "api",
            "input": {
                "resume_source": "file",
                "vacancy_source": "text",
                "has_career_strategy": True,
                "has_red_flags": False,
            },
            "match": {
                "match_id": 42,
                "match_score": 73,
                "recommendation": "maybe",
                "confidence": "medium",
                "matched_requirements_count": 3,
                "missing_or_unclear_requirements_count": 2,
                "red_flags_count": 1,
                "openai_model": "gpt-5-mini",
                "prompt_mode": "template",
                "run_mode": "normal",
                "locale": "ru",
            },
        }
    ]
    serialized = json.dumps(body)
    assert "private comment" not in serialized
    assert "private expectation" not in serialized
    assert "private user agent" not in serialized
    assert "score_breakdown" not in serialized


def test_admin_feedback_requires_basic_auth_when_users_are_configured(tmp_path):
    client = make_auth_client(tmp_path)

    unauthorized_response = client.get("/admin/feedback")
    authorized_response = client.get("/admin/feedback", auth=("admin", "secret"))

    assert unauthorized_response.status_code == 401
    assert authorized_response.status_code == 200


def test_admin_feedback_uses_database_when_database_url_is_configured(tmp_path, monkeypatch):
    calls = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            calls.append((sql, params))

        def fetchone(self):
            return (1,)

        def fetchall(self):
            return [
                (
                    {
                        "id": "feedback_db_admin_1",
                        "created_at": "2026-06-11T10:00:00.000Z",
                        "type": "ui_bug",
                        "message": "Raw admin message must stay hidden.",
                        "page": "match",
                        "api_mode": "api",
                        "browser": {"user_agent": "pytest private user agent"},
                        "input": {
                            "resume_source": "text",
                            "vacancy_source": "file",
                            "has_career_strategy": False,
                            "has_red_flags": True,
                        },
                        "match": None,
                    },
                )
            ]

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr("app.feedback_storage.connect", lambda database_url: FakeConnection())
    client = make_client(tmp_path, database_url="postgresql://neon.example/test")

    response = client.get("/admin/feedback")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["id"] == "feedback_db_admin_1"
    assert body["items"][0]["message_length"] == 35
    assert body["items"][0]["expected_length"] == 0
    assert body["items"][0]["input"]["vacancy_source"] == "file"
    assert body["items"][0]["match"] is None
    serialized = json.dumps(body)
    assert "Raw admin message" not in serialized
    assert "private user agent" not in serialized
    assert any("from feedback_entries" in sql.lower() for sql, _ in calls)
