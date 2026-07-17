# 1.взять данные из тест папки
# 2. запустить мэйн пайплайн с ними
import glob
import json

from types import SimpleNamespace
from docx import Document
from pypdf import PdfReader
from pathlib import Path
from fastapi.testclient import TestClient

from app.config import Settings
from app.endpoint_models import CheckMatchResponse
from app.main import create_app

# границы теста:
# endpoint принимает локальные test data;
# pipeline доходит до provider boundary;
# ответ проходит Pydantic/JSON validation;
# validate моделей корректно отрабатывает
# актуализировать текст выше

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


def read_file(data_dir, name):
    # читаем docx, txt, pdf
    file_path = glob.glob(f'{data_dir}/{name}.*')
    if not file_path:
        raise FileNotFoundError(name)
    
    file_path = Path(file_path[0])
    file_extension = file_path.suffix.lower()

    if file_extension == ".txt":
        text = file_path.read_text(encoding="utf-8")

    elif file_extension == ".docx":
        doc = Document(str(file_path))
        text = "\n".join(p.text for p in doc.paragraphs)

    elif file_extension == ".pdf":
        reader = PdfReader(file_path)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)

    else:
        raise ValueError(f"Unsupported file extension: {file_extension}")

    return text

def create_test_request(career_strategy, cv, red_flags, vacancy):
    return {
        "career_strategy": career_strategy,
        "red_flags": red_flags,
        "resume_text": cv,
        "vacancy_text": vacancy,
        "source_metadata": "local test_data/1",
        "locale": "ru",
        "provaider": "openai",
        "openai_model": "gpt-5.4-mini",
        "run_mode": "test",
        "prompt_mode": "template",
        "manual_prompt": "manual_prompt",
        }


def read_test_files(test_case_dir):
    settings = Settings()
    global_test_data_dir = settings.test_data_dir
    data_dir = global_test_data_dir / test_case_dir
    career_strategy = read_file(data_dir, 'career_strategy')
    cv = read_file(data_dir, 'cv')
    red_flags = read_file(data_dir, 'red_flags')
    vacancy = read_file(data_dir, 'vacancy')
    return career_strategy, cv, red_flags, vacancy

def get_data_from_test_data(test_case_dir):

    career_strategy, cv, red_flags, vacancy = read_test_files(test_case_dir)
    test_request = create_test_request(career_strategy, cv, red_flags, vacancy)

    return test_request

def test_pipeline(monkeypatch, test_data_dir="1"):
    # form - словарь с ключами cv vacancy prompt career_strategy
    # monkeypatch - перезапись функции в пайплайне на местную тестовую
    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_send_data_to_oai_provider)

    form_data = get_data_from_test_data(test_data_dir)

    client = make_test_client()
    response = client.post("/check_match", data=form_data)

    assert response.status_code == 200
    assert "[CANDIDATE_NAME]" in captured["resume"]
    assert "[EMAIL]" in captured["resume"]
    assert "[PHONE]" in captured["resume"]
     
    body_response =  CheckMatchResponse.model_validate(response.json())
    assert body_response


def test_422_boundary(monkeypatch, test_data_dir="1"):
    # сейчас тест - на получение 422 от отсутствующей career_strategy. по хорошему тест должен распространяться на все поля в CheckMatchRequest
    career_strategy, cv, red_flags, vacancy = read_test_files(test_data_dir)
    test_request = create_test_request(career_strategy, cv, red_flags, vacancy)
    test_request["career_strategy"] = None

    monkeypatch.setattr("app.funcs.oaip.send_data_to_oai_provider", fake_send_data_to_oai_provider)
    client = make_test_client()
    response = client.post("/check_match", data=test_request)
    assert response.status_code == 422



