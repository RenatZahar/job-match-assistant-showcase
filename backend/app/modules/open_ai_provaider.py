import json
from pathlib import Path
from openai import OpenAI
from fastapi import HTTPException
from concurrent.futures import ThreadPoolExecutor
from app.config import get_settings
from .masks import MATCH_SCHEMA, BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION, BRIGHT_DATA_LLM_VALIDATION_SCHEMA, CV_EVALUATION_PROMT_TEMPLATE
from .anonymizer_n_privacy import build_provider_instructions
from ..modules import anonymizer_n_privacy as anp

def get_openai_client():
    settings = get_settings()

    client = OpenAI(
        api_key=settings.openai_api_key,
        timeout=settings.openai_timeout_seconds,
        max_retries=settings.openai_max_retries,
    )
    return client

def serialize_answer(answer):
    # потом убедится, что эта функция подходит для сериализации ответов от других провайдеров llm
    if getattr(answer, "status", None) == "incomplete":
        reason = read_incomplete_reason(answer)
        if reason == "max_output_tokens":
            raise HTTPException(
                status_code=502,
                detail="Provider response was truncated by max_output_tokens",
            )

        raise HTTPException(status_code=502, detail="Provider response was incomplete")

    data = json.loads(answer.output_text)

    result = {
        "match_id": 1,
        "match_score": data["match_score"],
        "recommendation": data["recommendation"],
        "confidence": data["confidence"],
        "summary": data["summary"],
        "matched_requirements": data.get("matched_requirements", []),
        "missing_or_unclear_requirements": data.get("missing_or_unclear_requirements", []),
        "red_flags": data.get("red_flags", []),
        "score_breakdown": data["score_breakdown"],
        }
    return result


def read_incomplete_reason(answer) -> str | None:
    incomplete_details = getattr(answer, "incomplete_details", None)
    if incomplete_details is None:
        return None

    if isinstance(incomplete_details, dict):
        return incomplete_details.get("reason")

    return getattr(incomplete_details, "reason", None)

def send_data_to_oai_provider(career_strategy, red_flags, resume, vacancy, lang, cv_evaluation_promt, openai_model):
    settings = get_settings()
    client = get_openai_client()
    user_input = build_user_input(career_strategy=career_strategy, red_flags=red_flags, resume=resume, lang=lang, vacancy=vacancy)

    return client.responses.create(
        model=openai_model or settings.openai_model,
        reasoning={"effort": settings.openai_reasoning_effort},
        store=settings.openai_store_responses,
        instructions=build_provider_instructions(cv_evaluation_promt),
        input=user_input,
        max_output_tokens=settings.openai_max_output_tokens,
        prompt_cache_retention="24h",
        text={
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "job_match_result",
                "schema": MATCH_SCHEMA,
                "strict": True,
            },
        },
    )


def send_data_to_oai_provider_for_match_request(career_strategy, red_flags, resume, vacancy, lang, cv_evaluation_promt, openai_model, vacancy_id=None):
    settings = get_settings()
    raw_answer = send_data_to_oai_provider(
        career_strategy,
        red_flags,
        resume,
        vacancy,
        lang,
        cv_evaluation_promt,
        openai_model,
    )
    answer = serialize_answer(raw_answer)

    if settings.openai_debug_responses:
        save_openai_debug(raw_answer)

    if vacancy_id:
        return answer, vacancy_id
    else:
        return answer, raw_answer


def save_openai_debug(answer):
    payload = {
        "id": answer.id,
        "model": answer.model,
        "status": answer.status,
        "usage": answer.usage.model_dump() if answer.usage else None,
        "output_text": answer.output_text,
    }

    path = Path("debug/openai_last_response.json")
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")



def build_user_input(**kwargs):
    # возможно, перенос в общие фунцкии провайдеров, не только апенаи
    def untrusted_block(name, value):
        return f"BEGIN_UNTRUSTED_DATA:{name}\n{value}\nEND_UNTRUSTED_DATA:{name}"

    result ="\n\n".join(untrusted_block(name, value) for name, value in kwargs.items())

    return result


def get_settings_llm_validation(request):
    
    settings = get_settings()
    client = get_openai_client()
    user_input = build_user_input(
        career_strategy=request.career_strategy, 
        red_flags=request.red_flags, 
        resume=request.resume, 
        lang=request.lang)
    
    answer = client.responses.create(
        model=settings.openai_model,
        reasoning={"effort": settings.openai_reasoning_effort}, 
        store=settings.openai_store_responses, #разобраться как работает кэш и можно ли его тут использовать
        instructions=BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION,
        input=user_input,
        max_output_tokens=settings.openai_max_output_tokens,
        prompt_cache_retention="24h",   #и что это такое
        text={
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "job_match_result",
                "schema": BRIGHT_DATA_LLM_VALIDATION_SCHEMA,
                "strict": True,
                },
            },
        )
    
    return answer


    
def send_many_vacancies(request, vacancies):
    career_strategy = request.career_strategy
    red_flags = request.red_flags
    resume = request.resume
    lang = request.lang
    cv_evaluation_promt = "template"
    openai_model = request.openai_model

    def send_one(vacancy):
        return send_data_to_oai_provider_for_match_request(
            career_strategy=request.career_strategy,
            red_flags=request.red_flags,
            resume=request.resume,
            vacancy=vacancy["text_data"],
            lang=request.lang,
            cv_evaluation_promt=CV_EVALUATION_PROMT_TEMPLATE,
            openai_model=request.openai_model,
            vacancy_id=vacancy["job_posting_id"]

        )

    for vacancy in vacancies:
        vacancy["text_data"] = anp.clean_data_for_sensitive_n_safety(
            vacancy["text_data"],
            sensitive=False,
        )
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(send_one, vacancies))

    final_result = []
    for llm_answer, vacancy_id in results:
        one_llm_answer = {"vacancy_id": vacancy_id, "llm_answer": llm_answer}
        final_result.append(one_llm_answer)

    return final_result


