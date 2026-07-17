import json

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(settings = None):
    return TestClient(create_app(settings or Settings(app_env="test", database_url=None)))


def test_health_returns_ok_status():
    client = make_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "environment": "test",
    }


def test_health_db_reports_skipped_without_database_url():
    client = make_client()

    response = client.get("/health/db")

    assert response.status_code == 200
    assert response.json() == {
        "status": "skipped",
        "reason": "DATABASE_URL is not configured",
    }


def test_configured_basic_auth_protects_product_endpoints():
    client = make_client(
        Settings(
            app_env="test",
            database_url=None,
            basic_auth_users="renat:test-pass,viewer:viewer-pass",
        )
    )

    assert client.get("/health").status_code == 200
    assert client.get("/auth/me").status_code == 401
    assert client.get("/test_data/cases").status_code == 401
    assert client.put("/test_data/cases/1").status_code == 401
    assert client.delete("/test_data/cases/1").status_code == 401
    assert client.post("/feedback", json={}).status_code == 401

    response = client.get("/auth/me", auth=("renat", "test-pass"))

    assert response.status_code == 200
    assert response.json() == {"username": "renat"}


def test_configured_basic_auth_rejects_wrong_password():
    client = make_client(
        Settings(
            app_env="test",
            database_url=None,
            basic_auth_users="renat:test-pass",
        )
    )

    response = client.get("/auth/me", auth=("renat", "wrong-pass"))

    assert response.status_code == 401


def test_cors_allows_configured_frontend_origin():
    client = make_client(Settings(app_env="test", cors_origins="http://localhost:5173"))

    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_default_openai_output_token_limit_has_json_response_headroom():
    assert Settings(_env_file=None).openai_max_output_tokens >= 4000


def make_provider_answer(match_score: int = 77):
    class ProviderUsage:
        def model_dump(self):
            return {
                "input_tokens": 1000,
                "input_tokens_details": {"cached_tokens": 600},
                "output_tokens": 250,
                "output_tokens_details": {"reasoning_tokens": 50},
                "total_tokens": 1250,
            }

    class ProviderAnswer:
        id = "resp_test_123"
        model = "gpt-5-mini-2026-05-01"
        status = "completed"
        usage = ProviderUsage()
        output_text = json.dumps(
            {
                "match_score": match_score,
                "recommendation": "apply",
                "confidence": "medium",
                "summary": "summary",
                "matched_requirements": [],
                "missing_or_unclear_requirements": [],
                "red_flags": [],
                "score_breakdown": {
                    "base_match_score": match_score,
                    "red_flags_modifier": 0,
                    "freshness_modifier": 0,
                    "final_score": match_score,
                },
            }
        )

    return ProviderAnswer()


def test_check_match_accepts_frontend_payload_and_returns_match_result(monkeypatch):
    provider_calls = []

    def fake_provider(*args):
        provider_calls.append(args)
        return make_provider_answer()

    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_provider)
    client = make_client()

    response = client.post(
        "/check_match",
        data={
            "resume_text": "Python FastAPI",
            "career_strategy": "Senior backend role",
            "vacancy_text": "Python SQL",
            "source_metadata": '{"source":"manual"}',
            "locale": "ru",
            "openai_model": "gpt-5-mini",
        },
    )
 
    assert response.status_code == 200
    assert len(provider_calls) == 1
    assert response.json() == {
        "match_id": 1,
        "match_score": 77,
        "recommendation": "apply",
        "confidence": "medium",
        "summary": "summary",
        "matched_requirements": [],
        "missing_or_unclear_requirements": [],
        "red_flags": [],
        "score_breakdown": {
            "base_match_score": 77,
            "red_flags_modifier": 0,
            "freshness_modifier": 0,
            "final_score": 77,
        },
    }


def test_check_match_writes_safe_llm_result_log(monkeypatch, tmp_path):
    def fake_provider(*args):
        return make_provider_answer(match_score=86)

    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_provider)
    client = make_client(Settings(app_env="test", database_url=None, feedback_storage_dir=tmp_path))

    response = client.post(
        "/check_match",
        data={
            "resume_text": "Private raw CV text",
            "career_strategy": "Senior backend role",
            "vacancy_text": "Private raw vacancy text",
            "source_metadata": '{"source":"manual"}',
            "locale": "ru",
            "openai_model": "gpt-5-mini",
            "prompt_mode": "template",
        },
    )

    assert response.status_code == 200

    saved_files = list((tmp_path / "app_logs").glob("*.ndjson"))
    assert len(saved_files) == 1
    saved_payload = json.loads(saved_files[0].read_text(encoding="utf-8").splitlines()[0])
    saved_payload_text = json.dumps(saved_payload, ensure_ascii=False)

    assert saved_payload["event"] == "llm_evaluation_succeeded"
    assert saved_payload["provider"] == "openai"
    assert saved_payload["response_id"] == "resp_test_123"
    assert saved_payload["model"]["requested"] == "gpt-5-mini"
    assert saved_payload["model"]["actual"] == "gpt-5-mini-2026-05-01"
    assert saved_payload["prompt"]["mode"] == "template"
    assert saved_payload["prompt"]["name"] == "Шаблон оценки CV"
    assert saved_payload["usage"]["input_tokens"] == 1000
    assert saved_payload["usage"]["input_tokens_details"]["cached_tokens"] == 600
    assert saved_payload["result"]["match_score"] == 86
    assert "Private raw CV text" not in saved_payload_text
    assert "Private raw vacancy text" not in saved_payload_text


def test_check_match_rejects_unknown_openai_model():
    client = make_client()

    response = client.post(
        "/check_match",
        data={
            "resume_text": "Python FastAPI",
            "career_strategy": "Senior backend role",
            "vacancy_text": "Python SQL",
            "source_metadata": '{"source":"manual"}',
            "openai_model": "unknown-model",
        },
    )

    assert response.status_code == 422


def test_check_match_returns_controlled_error_when_provider_fails(monkeypatch):
    def fake_provider(*args):
        raise TimeoutError("provider timed out")

    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_provider)
    client = make_client()

    response = client.post(
        "/check_match",
        data={
            "resume_text": "Python FastAPI",
            "career_strategy": "Senior backend role",
            "vacancy_text": "Python SQL",
            "source_metadata": '{"source":"manual"}',
            "openai_model": "gpt-5-mini",
        },
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "Match provider failed"}


def test_check_match_reports_truncated_provider_response(monkeypatch):
    class IncompleteDetails:
        reason = "max_output_tokens"

    class ProviderAnswer:
        status = "incomplete"
        incomplete_details = IncompleteDetails()
        output_text = '{"match_score": 77'

    def fake_provider(*args):
        return ProviderAnswer()

    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_provider)
    client = make_client()

    response = client.post(
        "/check_match",
        data={
            "resume_text": "Python FastAPI",
            "career_strategy": "Senior backend role",
            "vacancy_text": "Python SQL",
            "source_metadata": '{"source":"manual"}',
            "openai_model": "gpt-5-mini",
        },
    )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Provider response was truncated by max_output_tokens"
    }
