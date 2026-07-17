import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.feedback_storage import save_app_log

logger = logging.getLogger(__name__)

PROMPT_NAMES = {
    "template": "Шаблон оценки CV",
    "manual": "Ручной промт",
    "generated": "Сгенерированный промт",
}


def save_llm_evaluation_log(request, response, provider_answer, storage_root, database_url):
    payload = build_llm_evaluation_log_payload(request, response, provider_answer)

    try:
        save_app_log(payload, storage_root, database_url)
    except Exception:
        logger.exception("Failed to persist LLM evaluation log")


def build_llm_evaluation_log_payload(request, response, provider_answer):
    created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    log_data =  {
        "id": f"llm_eval_{created_at.replace(':', '-').replace('.', '-')}_{uuid4().hex[:8]}",
        "created_at": created_at,
        "event": "llm_evaluation_succeeded",
        "level": "info",
        "page": "backend",
        "provider": "openai",
        "endpoint": "/check_match",
        "response_id": getattr(provider_answer, "id", None),
        "status": getattr(provider_answer, "status", None),
        "model": {
            "requested": request.openai_model,
            "actual": getattr(provider_answer, "model", None),
        },
        "prompt": {
            "mode": request.prompt_mode,
            "name": PROMPT_NAMES.get(request.prompt_mode, request.prompt_mode),
        },
        "run_mode": request.run_mode,
        "lang": request.lang,
        "usage": dump_provider_usage(getattr(provider_answer, "usage", None)),
        "result": response.model_dump(mode="json"),
        }
    return log_data

def dump_provider_usage(usage: Any) -> dict[str, Any] | None:
    if usage is None:
        return None

    if isinstance(usage, dict):
        return usage

    model_dump = getattr(usage, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(mode="json")
        except TypeError:
            return model_dump()

    return None
