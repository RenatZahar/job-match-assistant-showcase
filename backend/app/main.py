import json
from pydantic import ValidationError

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from . import funcs
from .auth import build_basic_auth_dependency
from .feedback_storage import list_feedback_summaries, save_app_log, save_feedback
from .test_data_storage import (
    create_test_data_case,
    delete_test_data_case,
    get_test_data_case,
    list_test_data_cases,
    replace_test_data_case,
)

from .modules import bright_data_provaider as bdp
from .modules import anonymizer_n_privacy as anp
from .modules import open_ai_provaider as oaip
from .modules.db import auto_vacancy_db as avdb
from .modules.db import db as app_db
from .modules.db import llm_logging as llmlog
from app.config import Settings, get_settings, parse_cors_origins
from app.endpoint_models import CheckMatchRequest, CheckMatchResponse, AutoVacancyRequest, AutoVacancyResponse, AutoVacancySearchDetail, AutoVacancyMoreRequest

# надо сносить require_auth и авторизацию и потом переделывать


async def parse_check_match_form(request: Request):
    form = await request.form()
    resume = await get_value(form, "resume_text", "resume_file", "resume")
    vacancy = await get_value(form, "vacancy_text", "vacancy_file", "vacancy")

    data = {
        "career_strategy": form.get("career_strategy"),
        "red_flags": form.get("red_flags") or "",
        "resume": resume,
        "vacancy": vacancy,
        "source_metadata": form.get("source_metadata"),
        "lang": form.get("locale") or "ru",
        "provaider": form.get("provaider") or "openai",
        "openai_model": form.get("openai_model") or "",
        "run_mode": form.get("run_mode") or "normal",
        "prompt_mode": form.get("prompt_mode") or "template",
        "manual_prompt": form.get("manual_prompt"),
    }


    try:
        return data
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=error.errors()) from error

async def parse_autovacancy_form(request: Request):
    form = await request.form()
    resume = await get_value(form, "resume_text", "resume_file", "resume")

    data = {
        "search_id":form.get("search_id"),
        "career_strategy": form.get("career_strategy"),
        "red_flags": form.get("red_flags") or "",
        "resume": resume,
        "source": form.get("source") or "linkedin",
        "lang": form.get("locale") or "ru",
        "provaider": form.get("provaider") or "",
        "openai_model": form.get("openai_model") or "gpt-5.4-mini",
        "source_metadata": form.get("source_metadata") or "",
        "vacancy_limit": form.get("vacancy_limit") or 10,
    }

    try:
        return AutoVacancyRequest.model_validate(data)
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=error.errors()) from error


async def get_value(form, text_key: str, file_key: str, field_name: str) -> str:
    text = form.get(text_key)
    file = form.get(file_key)

    if text and text.strip():
        return text.strip()

    if file:
        return await funcs.extract_text_from_file(file)

    raise HTTPException(
        status_code=422,
        detail=f"{field_name}: добавь текст или файл",
    )

# def create_app(settings: Settings | None = None) -> FastAPI:
#     active_settings = settings or get_settings()
# убрал конструкцию пока разбираюсь в коде

def create_app(settings: Settings | None = None):
    active_settings = settings or get_settings()
    api = FastAPI(title="Job Match Assistant API")
    require_auth = build_basic_auth_dependency(active_settings)
    # require_auth - фактически не используется локально, на mvp полезность сомнительная, вместе со всем блоков .auth

    api.add_middleware(
        CORSMiddleware,
        allow_origins=parse_cors_origins(active_settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "environment": active_settings.app_env,
        }

    @api.get("/auth/me")
    def auth_me(username: str = Depends(require_auth)) -> dict[str, str]:
        return {"username": username}

    @api.get("/health/db", dependencies=[Depends(require_auth)])
    def health_db() -> dict[str, str]:
        return app_db.check_database(active_settings.database_url)

    @api.post("/feedback", status_code=201, dependencies=[Depends(require_auth)])
    async def feedback_entrypoint(payload: dict) -> dict[str, str]:
        return save_feedback(
            payload,
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )

    @api.post("/app_logs", status_code=201, dependencies=[Depends(require_auth)])
    async def app_logs_entrypoint(payload: dict) -> dict[str, str]:
        return save_app_log(
            payload,
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )

    @api.get("/admin/feedback", dependencies=[Depends(require_auth)])
    def admin_feedback_entrypoint(limit: int = 50) -> dict[str, object]:
        return list_feedback_summaries(
            active_settings.feedback_storage_dir,
            active_settings.database_url,
            limit,
        )

    @api.get("/test_data/cases", dependencies=[Depends(require_auth)])
    def test_data_cases_entrypoint() -> list[dict]:
        return list_test_data_cases(
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )

    @api.get("/test_data/cases/{case_name}", dependencies=[Depends(require_auth)])
    def test_data_case_entrypoint(case_name: str) -> dict[str, str]:
        return get_test_data_case(
            case_name,
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )

    @api.post("/test_data/cases", status_code=201, dependencies=[Depends(require_auth)])
    async def create_test_data_case_entrypoint(request: Request) -> dict[str, str | None]:
        form = await request.form()
        return await create_test_data_case(
            form,
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )

    @api.put("/test_data/cases/{case_name}", dependencies=[Depends(require_auth)])
    async def replace_test_data_case_entrypoint(
        case_name: str,
        request: Request,
    ) -> dict[str, str | None]:
        form = await request.form()
        return await replace_test_data_case(
            case_name,
            form,
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )

    @api.delete("/test_data/cases/{case_name}", dependencies=[Depends(require_auth)])
    def delete_test_data_case_entrypoint(case_name: str) -> dict[str, str]:
        return delete_test_data_case(
            case_name,
            active_settings.feedback_storage_dir,
            active_settings.database_url,
        )



    # пример минимального ендпоинт. но без авторизации
    # @api.post("/check_match")
    # async def main_scenario_entrypoint(request: CheckMatchRequest):
    #нужен ли response_model=CheckMatchResponse? мы все равно валидируем ответ в конце
    @api.post("/check_match", response_model=CheckMatchResponse, dependencies=[Depends(require_auth)])
    async def main_scenario_entrypoint(request = Depends(parse_check_match_form)) -> CheckMatchResponse:

        #добавить в инпуты ссылку?

        try:
            request = CheckMatchRequest.model_validate(request)
        except ValidationError as error:
            raise HTTPException(status_code=422, detail=error.errors()) from error

        try:
            result, provider_answer = funcs.start_match_pipeline(request)

        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=502, detail="Match provider failed") from error

        try:
            clean_request_data = CheckMatchResponse.model_validate(result)
            # model_validate - аналог CheckMatchResponse(**result) - для раскладки словаря в поля класса. просто простая и явная функция
            llmlog.save_llm_evaluation_log(request, clean_request_data, provider_answer, active_settings.feedback_storage_dir,active_settings.database_url)

            return clean_request_data
        except ValidationError as error:
            raise HTTPException(status_code=500, detail="Invalid match result") from error


    @api.get("/auto_vacancy_searches/{search_id}")
    async def get_auto_vacancy_search_entrypoint(search_id: str, username: str = Depends(require_auth)) -> AutoVacancySearchDetail:
        """Load one saved auto vacancy search session with stored inputs and results."""

        response = funcs.create_search_id_response(search_id, username)
        return AutoVacancySearchDetail.model_validate(response)

    @api.get("/auto_vacancy_searches")
    async def list_auto_vacancy_search_projects_entrypoint(username: str = Depends(require_auth)):
        """List saved auto vacancy search sessions for the authenticated account."""
        return avdb.get_auto_vacancy_project_names(username)


    @api.post("/auto_vacancy_searches", status_code=201)
    async def create_auto_vacancy_search_project_entrypoint(request: Request, username: str = Depends(require_auth)) -> dict[str, object]:
        """Create a named auto vacancy search session and return its first matched vacancies."""
        # убедится что projectname уникальный
        payload = await request.json()
        return avdb.save_auto_vacancy_project_name(payload.get("name"), username)

    @api.post("/auto_vacancy_searches/{search_id}/more")
    async def load_more_auto_vacancy_search_entrypoint(search_id: str, payload: AutoVacancyMoreRequest, username: str = Depends(require_auth)):
        """Continue an existing auto vacancy search and append the next matched vacancy batch."""
        return funcs.load_more_auto_vacancies(search_id, username, payload.vacancy_limit)

    @api.post("/auto_vacancy_matches", response_model=AutoVacancyResponse, dependencies=[Depends(require_auth)])
    async def auto_vacancy_matches(request = Depends(parse_autovacancy_form), username: str = Depends(require_auth)) -> AutoVacancyResponse:

        request.resume = anp.clean_data_for_sensitive_n_safety(request.resume, sensitive=True)
        avdb.save_users_input(request, username, search_id = request.search_id)
        # - тут - сохранение проекта поиска (потом - отдельно сохранение без старта пайплайна)
        search_vacancy_settings = oaip.get_settings_llm_validation(request)

        # нужен логгинг - для логирования входных для get_settings_llm_validation и полученных ответов для проверкикак отработала ллм
        # и - логи отправки в брайт апи чтобы копить ошибки и плохие значения ключей в запросах
        # логи надо делать в бд
        # переелать save_openai_debug (и поискать похожие функции) на запись в дб

        # сначала наДо искать вакансии по selective_search True,  но как только не нахоДится До лимита - переклЮчаться на FaLse

        # вставить защиту от появления дублей вакансий в дб в серч-проекте (с заменой новых данных?)
        # нужна защита на уровне дб от удвоения запросов  для ендпоинтов

        search_vacancy_settings = json.loads(search_vacancy_settings.output_text)
        llm_problems_to_research = {
            "assumptions": search_vacancy_settings.get("assumptions", []),
            "confidence": search_vacancy_settings.get("confidence"),
            "missing_inputs": search_vacancy_settings.get("missing_inputs", []),
            "negative_preferences": search_vacancy_settings.get("negative_preferences", []),
            }
        avdb.save_search_plan_llm_meta(search_vacancy_settings, llm_problems_to_research, request.search_id, username)

        search_vacancy_settings = bdp.BrightDataModel.model_validate(search_vacancy_settings)
        old_vacs_in_project = avdb.get_bright_data_vac_ids_in_search_project(request.search_id, username)
        # дописать - если BrightData не может вернуть вакансии - переключать на selective_search false
        all_oai_results, all_vacancies = funcs.run_auto_vacancy_matching_batches(request, search_vacancy_settings, username, old_vacs_in_project)

        auto_vacancy_response = funcs.build_auto_vacancy_response(request, all_oai_results, all_vacancies)

        return AutoVacancyResponse.model_validate(auto_vacancy_response)


    return api

app = create_app()
