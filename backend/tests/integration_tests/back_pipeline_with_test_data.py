import glob

from docx import Document
from httpx import request
from pypdf import PdfReader
from pathlib import Path
from app.endpoint_models import CheckMatchRequest
from app.config import Settings
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app

# тест проверяет реальный пайплайн без фронта, с исподльзованием реального openai провайдера


def make_client(settings=None):
    return TestClient(create_app(Settings(app_env="test", database_url=None)))


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
        }


def get_data_from_test_data(test_case_dir):
    settings = Settings()
    global_test_data_dir = settings.test_data_dir
    data_dir = global_test_data_dir / test_case_dir
    career_strategy = read_file(data_dir, 'career_strategy')
    cv = read_file(data_dir, 'cv')
    red_flags = read_file(data_dir, 'red_flags')
    vacancy = read_file(data_dir, 'vacancy')
    request_ = create_test_request(career_strategy, cv, red_flags, vacancy)

    return request_

def main(test_data_dir="1"):
    # form - словарь с ключами cv vacancy prompt career_strategy
    form_data = get_data_from_test_data(test_data_dir)
    client = make_client()
    response = client.post(
        "/check_match",
        data=form_data,
        auth=("renat", "1234"),
    )

    print("start_e2e_back: success")

if __name__ == "__main__":
    main()
