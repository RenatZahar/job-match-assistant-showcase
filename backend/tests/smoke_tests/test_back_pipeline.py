import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.endpoint_models import CheckMatchResponse
from app.main import create_app

SYNTHETIC_CAREER_STRATEGY = "Backend Python role with API ownership."
SYNTHETIC_CV = """
John Smith
Email: john.smith+portfolio@example.com
Phone: +49 (151) 123-45-678
Python, FastAPI, PostgreSQL
"""
SYNTHETIC_RED_FLAGS = "No unpaid trial work."
SYNTHETIC_VACANCY = "Python backend engineer with FastAPI and PostgreSQL experience."

captured = {}


def fake_send_data_to_oai_provider(*args, **kwargs):
    captured["resume"] = args[2]

    return SimpleNamespace(
        id="fake-response-id",
        status="completed",
        model="fake-model",
        usage=None,
        incomplete_details=None,
        output_text=json.dumps({
            "match_score": 80,
            "recommendation": "manual_review",
            "confidence": "medium",
            "summary": "Fake provider response for test.",
            "matched_requirements": [],
            "missing_or_unclear_requirements": [],
            "red_flags": [],
            "score_breakdown": {
                "base_match_score": 80,
                "red_flags_modifier": 0,
                "freshness_modifier": 0,
                "final_score": 80,
            },
        }),
    )


def make_test_client(settings=None):
    active_settings = settings or Settings(app_env="test", database_url=None)
    return TestClient(create_app(active_settings))


def create_test_request():
    return {
        "career_strategy": SYNTHETIC_CAREER_STRATEGY,
        "red_flags": SYNTHETIC_RED_FLAGS,
        "resume_text": SYNTHETIC_CV,
        "vacancy_text": SYNTHETIC_VACANCY,
        "source_metadata": "synthetic smoke test",
        "locale": "ru",
        "provaider": "openai",
        "openai_model": "gpt-5.4-mini",
        "run_mode": "test",
        "prompt_mode": "template",
        "manual_prompt": "manual_prompt",
    }


def test_pipeline(monkeypatch):
    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_send_data_to_oai_provider)

    form_data = create_test_request()

    client = make_test_client()
    response = client.post("/check_match", data=form_data)

    assert response.status_code == 200
    assert "[CANDIDATE_NAME]" in captured["resume"]
    assert "[EMAIL]" in captured["resume"]
    assert "[PHONE]" in captured["resume"]

    body_response = CheckMatchResponse.model_validate(response.json())
    assert body_response


def test_422_boundary(monkeypatch):
    test_request = create_test_request()
    test_request["career_strategy"] = None

    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_send_data_to_oai_provider)
    client = make_test_client()
    response = client.post("/check_match", data=test_request)
    assert response.status_code == 422



