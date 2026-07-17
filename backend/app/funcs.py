from io import BytesIO

from types import SimpleNamespace
from zipfile import BadZipFile
from docx import Document
from fastapi import HTTPException, UploadFile
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from docx.opc.exceptions import PackageNotFoundError

from .modules.masks import CV_EVALUATION_PROMT_TEMPLATE
from .modules import anonymizer_n_privacy as anp
from .modules import open_ai_provaider as oaip
from .modules import bright_data_provaider as bdp
from .modules.db import auto_vacancy_db as avdb
from app.config import get_settings

GOOD_MATCH_SCORE_THRESHOLD = 79
AUTO_VACANCY_SEARCH_HARD_CAP = 10

def build_auto_vacancy_response(request, oai_results, vacancies):
    vacancies_by_id = {
        str(vacancy.get("job_posting_id")): vacancy
        for vacancy in vacancies
        if vacancy.get("job_posting_id")
    }

    results = []
    for result in oai_results:
        vacancy_id = str(result.get("vacancy_id") or "")
        llm_answer = result.get("llm_answer") or {}
        vacancy = vacancies_by_id.get(vacancy_id, {})

        results.append({
            "vacancy_id": vacancy_id,
            "title": vacancy.get("job_title") or "",
            "company": vacancy.get("company_name") or "",
            "source": request.source or "linkedin",
            "source_url": vacancy.get("url") or "",
            "location": vacancy.get("job_location") or "",
            "match_score": llm_answer.get("match_score"),
            "recommendation": llm_answer.get("recommendation"),
            "confidence": llm_answer.get("confidence"),
            "summary": llm_answer.get("summary", ""),
            "key_reasons": llm_answer.get("key_reasons", []),
            "matched_requirements": llm_answer.get("matched_requirements", []),
            "missing_or_unclear_requirements": llm_answer.get("missing_or_unclear_requirements", []),
            "red_flags": llm_answer.get("red_flags", []),
            "score_breakdown": llm_answer.get("score_breakdown"),
        })

    sorted_results = sorted(results, key=lambda item: item.get("match_score") or 0, reverse=True)

    return {
        "search_id": request.search_id,
        "source": request.source or "linkedin",
        "vacancy_limit": request.vacancy_limit,
        "total_found": len(results),
        "results": sorted_results,
    }


def run_auto_vacancy_matching_batches(request, search_vacancy_settings, username, checked_vacancy_ids=None):
    all_vacancies = []
    all_oai_results = []
    target_vacancies_ids = []
    checked_vacancy_ids = checked_vacancy_ids or []
    iteration = 0

    while len(target_vacancies_ids) < request.vacancy_limit and iteration < AUTO_VACANCY_SEARCH_HARD_CAP:
        iteration += 1

        vacancies = bdp.vacancy_search_by_key(search_vacancy_settings, request, checked_vacancy_ids)
        if not vacancies:
            break

        all_vacancies.extend(vacancies)
        avdb.save_bright_data_response(vacancies, request.search_id, username)
        oai_results = oaip.send_many_vacancies(request, vacancies)
        all_oai_results.extend(oai_results)
        avdb.save_auto_vacancy_match_results(oai_results, request.search_id, username)

        for result in oai_results:
            vacancy_id = result["vacancy_id"]
            checked_vacancy_ids.append(vacancy_id)

            if result["llm_answer"]["match_score"] > GOOD_MATCH_SCORE_THRESHOLD:
                target_vacancies_ids.append(vacancy_id)

    return all_oai_results, all_vacancies


def build_auto_vacancy_more_response(search_id, oai_results, vacancies, previous_results_count=0):
    response = build_auto_vacancy_response(
        SimpleNamespace(search_id=search_id, source="linkedin", vacancy_limit=len(vacancies)),
        oai_results,
        vacancies,
    )
    return {
        "search_id": response["search_id"],
        "added_results": response["results"],
        "results_count": (previous_results_count or 0) + len(response["results"]),
    }


def load_more_auto_vacancies(search_id, username, vacancy_limit=3):
    context = avdb.get_search_run_context(search_id, username)
    if context is None:
        raise HTTPException(status_code=404, detail="Auto vacancy search was not found")

    (
        saved_search_id,
        source,
        resume,
        career_strategy,
        red_flags,
        locale,
        search_plan,
        shown_job_ids,
        results_count,
    ) = context

    if not search_plan:
        raise HTTPException(status_code=409, detail="Auto vacancy search has no saved Bright Data search plan")

    settings = get_settings()
    search_plan = dict(search_plan)
    search_vacancy_settings = bdp.BrightDataModel.model_validate(search_plan)
    request = SimpleNamespace(
        search_id=str(saved_search_id),
        source=source or "linkedin",
        resume=resume or "",
        career_strategy=career_strategy or "",
        red_flags=red_flags or "",
        lang=locale or "ru",
        vacancy_limit=vacancy_limit,
        openai_model=settings.openai_model,
    )

    try:
        checked_vacancy_ids = (shown_job_ids or []) + avdb.get_bright_data_vac_ids_in_search_project(
            request.search_id, username
        )
        oai_results, vacancies = run_auto_vacancy_matching_batches(
            request,
            search_vacancy_settings,
            username,
            checked_vacancy_ids,
        )
        return build_auto_vacancy_more_response(request.search_id, oai_results, vacancies, results_count)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail="Load more vacancy search failed") from error


def start_match_pipeline(request):

    prompt = choose_prompt(request.prompt_mode, request.manual_prompt)
    resume = anp.clean_data_for_sensitive_n_safety(request.resume, sensitive=True)
    vacancy = anp.clean_data_for_sensitive_n_safety(request.vacancy, sensitive=False)

    if request.provaider == "openai":
        raw_answer = oaip.send_data_to_oai_provider(
            request.career_strategy, request.red_flags, resume, vacancy, request.lang, prompt, request.openai_model
        )
        answer = oaip.serialize_answer(raw_answer)

    else:
        raise HTTPException(status_code=422, detail="uncorrect provaider argument (error 422?)")

    return answer, raw_answer


def choose_prompt(prompt_mode, manual_prompt) -> str:
    if prompt_mode == "template":
        return CV_EVALUATION_PROMT_TEMPLATE

    if prompt_mode == "manual":
        prompt = manual_prompt.strip()
        if not prompt:
            raise HTTPException(
                status_code=422, detail="manual_prompt is required for manual prompt_mode"
            )
        return prompt

    raise HTTPException(status_code=422, detail=f"prompt_mode '{prompt_mode}' is not implemented")




async def extract_text_from_file(file: UploadFile) -> str:
    filename = (file.filename or "").lower()

    if not filename.endswith((".pdf", ".docx")):
        raise HTTPException(status_code=422, detail="Можно загружать только PDF или DOCX")

    content = await file.read()

    if filename.endswith(".pdf"):
        return extract_pdf_text(content)

    if filename.endswith(".docx"):
        return extract_docx_text(content)

    raise HTTPException(status_code=422, detail="Можно загружать только PDF или DOCX")


def extract_pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        return text
    except PdfReadError as error:
        raise HTTPException(status_code=422, detail="Не удалось прочитать PDF") from error


def extract_docx_text(content: bytes) -> str:
    try:
        document = Document(BytesIO(content))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs).strip()
        return text
    except (BadZipFile, PackageNotFoundError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Не удалось прочитать DOCX") from error


def parse_vacancies_n_match_data(vacancies_n_match_data):
    vacancies = []
    for vacancy_tupple in vacancies_n_match_data:

        (id,
        search_id,
        username,
        provider_job_id,
        title,
        company,
        source,
        source_url,
        location,
        provider_raw_json,
        match_score,
        recommendation,
        key_reasons_json,
        score_breakdown_json,
        llm_result_json,
        updated_at,
        created_at,
        ) = vacancy_tupple

        llm_result = llm_result_json or {}
        vacancy = {
            "vacancy_id": str(id),
            "provider_job_id": provider_job_id or "",
            "title": title or "Untitled vacancy",
            "company": company or "Unknown company",
            "source": source or "linkedin",
            "source_url": source_url or "",
            "location": location or "",
            "match_score": match_score or 0,
            "recommendation": recommendation or "manual_review",
            "confidence": llm_result.get("confidence", "medium"),
            "summary": llm_result.get("summary", ""),
            "key_reasons": key_reasons_json or [],
            "matched_requirements": llm_result.get("matched_requirements", []),
            "missing_or_unclear_requirements": llm_result.get("missing_or_unclear_requirements", []),
            "red_flags": llm_result.get("red_flags", []),
            "score_breakdown": score_breakdown_json or llm_result.get("score_breakdown") or {
                "base_match_score": match_score or 0,
                "red_flags_modifier": 0,
                "freshness_modifier": 0,
                "final_score": match_score or 0,
            },
        }

        vacancies.append(vacancy)
    return vacancies


def parse_search_id_data(search_id_data, vacancies_n_matches):
    (
        search_id,
        search_name,
        resume,
        career_strategy,
        red_flags,
        locale,
        llm_meta_json,
        results_count,
    ) = search_id_data

    search_id_response = {
        "search_id": str(search_id),
        "name": search_name,
        "resume": resume or "",
        "career_strategy": career_strategy or "",
        "red_flags": red_flags or "",
        "vacancy_limit": 3,  # пока нет в БД
        "locale": locale or "ru",
        "llm_meta": llm_meta_json or {
            "assumptions": [],
            "confidence": "medium",
            "missing_inputs": [],
            "negative_preferences": [],
        },
        "results": vacancies_n_matches,
        "results_count": results_count or len(vacancies_n_matches),
        "can_load_more": True,  # пока вычисляемое поле, не колонка
        }
    return search_id_response

def create_search_id_response(search_id, username):
    search_id_data = avdb.get_search_data(search_id, username)
    vacancies_n_match_data = avdb.get_vacancies_n_match_data(search_id, username)
    vacancies_n_matches = parse_vacancies_n_match_data(vacancies_n_match_data)
    search_id_data_n_vacancies = parse_search_id_data(search_id_data, vacancies_n_matches)
    return search_id_data_n_vacancies
