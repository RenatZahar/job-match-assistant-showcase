from io import BytesIO
import json
from pathlib import Path

from docx import Document
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


def make_docx_bytes(text: str) -> bytes:
    document = Document()
    document.add_paragraph(text)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def test_test_data_case_upload_stores_anonymized_text_without_raw_cv(tmp_path):
    client = make_client(tmp_path)

    response = client.post(
        "/test_data/cases",
        data={
            "career_strategy": "Senior backend Germany",
            "red_flags": "No gambling",
        },
        files={
            "cv": (
                "cv.docx",
                make_docx_bytes("John Smith\nEmail: john@example.com\nPython FastAPI"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "vacancy": (
                "vacancy.docx",
                make_docx_bytes("Backend vacancy with Python"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "prompt": ("prompt.md", b"Evaluate this case.", "text/markdown"),
        },
    )

    assert response.status_code == 201
    assert response.json()["name"] == "1"

    saved_file = tmp_path / "test_data_cases" / "1.json"
    saved_payload = json.loads(saved_file.read_text(encoding="utf-8"))
    serialized_payload = json.dumps(saved_payload, ensure_ascii=False)
    assert "John Smith" not in serialized_payload
    assert "john@example.com" not in serialized_payload
    assert "[EMAIL]" in serialized_payload

    case_response = client.get("/test_data/cases/1")
    assert case_response.status_code == 200
    assert case_response.json()["resumeText"] == saved_payload["resume_text"]
    assert "Backend vacancy with Python" in case_response.json()["vacancyText"]


def test_test_data_case_replace_updates_existing_case_without_raw_cv(tmp_path):
    client = make_client(tmp_path)
    case_dir = tmp_path / "test_data_cases"
    case_dir.mkdir()
    (case_dir / "1.json").write_text(
        json.dumps(
            {
                "resume_text": "old synthetic resume",
                "vacancy_text": "old synthetic vacancy",
                "manual_prompt": "",
                "career_strategy": "",
                "red_flags": "",
            }
        ),
        encoding="utf-8",
    )

    response = client.put(
        "/test_data/cases/1",
        data={
            "career_strategy": "Senior Java backend Germany",
            "red_flags": "english c1",
        },
        files={
            "cv": (
                "cv.docx",
                make_docx_bytes("Jane Smith\nEmail: jane@example.com\nJava Spring"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "vacancy": (
                "vacancy.docx",
                make_docx_bytes("Java backend vacancy"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "prompt": ("prompt.md", b"Evaluate Java backend case.", "text/markdown"),
        },
    )

    assert response.status_code == 200
    assert response.json()["name"] == "1"

    saved_payload = json.loads((case_dir / "1.json").read_text(encoding="utf-8"))
    serialized_payload = json.dumps(saved_payload, ensure_ascii=False)
    assert "old synthetic" not in serialized_payload
    assert "Jane Smith" not in serialized_payload
    assert "jane@example.com" not in serialized_payload
    assert "[EMAIL]" in serialized_payload
    assert saved_payload["career_strategy"] == "Senior Java backend Germany"
    assert saved_payload["red_flags"] == "english c1"
    assert saved_payload["manual_prompt"] == "Evaluate Java backend case."


def test_test_data_case_delete_removes_existing_case(tmp_path):
    client = make_client(tmp_path)
    case_dir = tmp_path / "test_data_cases"
    case_dir.mkdir()
    (case_dir / "2.json").write_text(
        json.dumps(
            {
                "resume_text": "duplicate",
                "vacancy_text": "duplicate",
                "manual_prompt": "",
                "career_strategy": "",
                "red_flags": "",
            }
        ),
        encoding="utf-8",
    )

    response = client.delete("/test_data/cases/2")

    assert response.status_code == 200
    assert response.json() == {"name": "2", "status": "deleted"}
    assert not (case_dir / "2.json").exists()


def test_test_data_case_list_returns_cases(tmp_path):
    client = make_client(tmp_path)
    case_dir = tmp_path / "test_data_cases"
    case_dir.mkdir()
    (case_dir / "1.json").write_text(
        json.dumps(
            {
                "name": "1",
                "resume_text": "[CANDIDATE_NAME]",
                "vacancy_text": "Backend vacancy",
                "manual_prompt": "",
                "career_strategy": "",
                "red_flags": "",
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/test_data/cases")

    assert response.status_code == 200
    assert response.json() == [
        {
            "name": "1",
            "cvFile": "cv.txt",
            "vacancyFile": "vacancy.txt",
            "promptFile": None,
            "redFlagsFile": None,
            "careerStrategyFile": None,
        }
    ]


def test_test_data_case_upload_uses_database_when_database_url_is_configured(tmp_path, monkeypatch):
    calls = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            calls.append((sql, params))

        def fetchone(self):
            return (7,)

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr("app.test_data_storage.connect", lambda database_url: FakeConnection())
    client = make_client(tmp_path, database_url="postgresql://neon.example/test")

    response = client.post(
        "/test_data/cases",
        files={
            "cv": (
                "cv.docx",
                make_docx_bytes("John Smith\nEmail: john@example.com\nPython FastAPI"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "vacancy": (
                "vacancy.docx",
                make_docx_bytes("Backend vacancy with Python"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
        },
    )

    assert response.status_code == 201
    assert response.json()["name"] == "7"
    assert any("insert into test_data_cases" in sql.lower() for sql, _ in calls)
    assert not (tmp_path / "test_data_cases" / "7.json").exists()


def test_test_data_case_replace_uses_database_when_database_url_is_configured(tmp_path, monkeypatch):
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

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr("app.test_data_storage.connect", lambda database_url: FakeConnection())
    client = make_client(tmp_path, database_url="postgresql://neon.example/test")

    response = client.put(
        "/test_data/cases/1",
        files={
            "cv": (
                "cv.docx",
                make_docx_bytes("Jane Smith\nEmail: jane@example.com\nJava Spring"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "vacancy": (
                "vacancy.docx",
                make_docx_bytes("Java backend vacancy"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
        },
    )

    assert response.status_code == 200
    assert response.json()["name"] == "1"
    assert any("update test_data_cases" in sql.lower() for sql, _ in calls)
    assert not (tmp_path / "test_data_cases" / "1.json").exists()


def test_test_data_case_delete_uses_database_when_database_url_is_configured(tmp_path, monkeypatch):
    calls = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            calls.append((sql, params))

        def fetchone(self):
            return (2,)

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr("app.test_data_storage.connect", lambda database_url: FakeConnection())
    client = make_client(tmp_path, database_url="postgresql://neon.example/test")

    response = client.delete("/test_data/cases/2")

    assert response.status_code == 200
    assert response.json() == {"name": "2", "status": "deleted"}
    assert any("delete from test_data_cases" in sql.lower() for sql, _ in calls)
