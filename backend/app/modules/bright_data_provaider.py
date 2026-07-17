import requests
import time
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from app.config import get_settings


class BrightDataModel(BaseModel):
    # Literal[""] - не применять фильтр
    model_config = ConfigDict(extra="ignore")

    remote: Literal["Remote", "On-site", "Hybrid", ""]
    selective_search: Literal[True, False] = True
    country: str | None = Field(default="", max_length=2)
    time_range: Literal["Past 24 hours", "Past week", "Past month"] = "Past week"
    job_type: Literal["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Volunteer", "Other", ""] = "Full-time"

    experience_level: str
    location: str
    keyword: str
    company: str
    jobs_to_not_include: list[str] = Field(default_factory=list)
    location_radius: str


def check_snapshot_status(snapshot_id, settings):
    headers = {
        "Authorization": f"Bearer {settings.bright_data_api_key}",
        "Content-Type": "application/json"}

    progress_response = requests.get(
        f"{settings.bright_data_api_base}/progress/{snapshot_id}",
        headers=headers,
        timeout=15)

    try:
        progress = progress_response.json()
    except ValueError as error:
        raise RuntimeError(
            f"Bright Data progress returned non-JSON response: "
            f"status={progress_response.status_code}, body={progress_response.text[:500]}"
        ) from error

    if progress_response.status_code >= 400:
        raise RuntimeError(f"Bright Data progress failed: status={progress_response.status_code}, body={progress}")
    status = progress_response.json()
    status = progress.get("status")
    return status

def _extract_bright_data_vacancies(response):
    def is_valid_vacancy(item):
        if not isinstance(item, dict):
            return False
        if item.get("error") or item.get("error_code"):
            return False
        return True

    if isinstance(response, list):
        return [item for item in response if is_valid_vacancy(item)]

    if not isinstance(response, dict):
        return []

    for key in ("results", "data", "items", "jobs"):
        value = response.get(key)
        if isinstance(value, list):
            return [item for item in value if is_valid_vacancy(item)]
    return []

def get_snapshot(snapshot_id, settings):
    headers = {
        "Authorization": f"Bearer {settings.bright_data_api_key}",
        "Content-Type": "application/json"}
    response = requests.get(
        f"{settings.bright_data_api_base}/snapshot/{snapshot_id}",
            headers=headers,
            params={"format": "json"},
            timeout=30)

    vacancies = response.json()
    vacancies = _extract_bright_data_vacancies(vacancies)
    return vacancies


def check_brightdata_snapshot(request, settings):
    data = request.json()
    snapshot_id = data.get("snapshot_id")
    if not snapshot_id:
        raise RuntimeError(f"Bright Data trigger response did not include snapshot_id: {data}")

    while True:
        time.sleep(2)
        status = check_snapshot_status(snapshot_id, settings)
        if status == "ready":
            snapshot_data = get_snapshot(snapshot_id, settings)
            return snapshot_data
        if status == "failed":
            raise RuntimeError(f"Bright Data snapshot failed: snapshot_id={snapshot_id}")


def send_search_requst(search_vacancy_settings, request, settings, old_vacs_in_project=None):
    old_vacs_in_project = old_vacs_in_project or []
    jobs_to_not_include = search_vacancy_settings.jobs_to_not_include + old_vacs_in_project

    bright_data_api_key = f"Bearer {settings.bright_data_api_key}"
    headers = {
        "Authorization": bright_data_api_key,
        "Content-Type": "application/json",
        }
    payload = [
            {
                "location": search_vacancy_settings.location,
                "keyword": search_vacancy_settings.keyword,
                "country": search_vacancy_settings.country or "",
                "time_range": search_vacancy_settings.time_range,
                "job_type": search_vacancy_settings.job_type,
                "experience_level": search_vacancy_settings.experience_level,
                "remote": search_vacancy_settings.remote,
                "company": search_vacancy_settings.company,
                "selective_search": search_vacancy_settings.selective_search,
                "jobs_to_not_include": jobs_to_not_include,
                "location_radius": search_vacancy_settings.location_radius,
            }
        ]

    response = requests.post(
        settings.bright_data_api_search+f"&limit_per_input={request.vacancy_limit}",
        headers=headers,
        json=payload,
        timeout=30,
        )
    return response

def filtration_to_str(vacancies):
    cleared_vacancies = []
    for vacancy in vacancies:
        text_data = "\n".join([
            f"job_title: {vacancy.get('job_title')}",
            f"company_name: {vacancy.get('company_name')}",
            f"job_location: {vacancy.get('job_location')}",
            f"country_code: {vacancy.get('country_code')}",

            f"job_summary: {vacancy.get('job_summary')}",
            f"job_seniority_level: {vacancy.get('job_seniority_level')}",
            f"job_employment_type: {vacancy.get('job_employment_type')}",
            f"job_function: {vacancy.get('job_function')}",
            f"job_industries: {vacancy.get('job_industries')}",
        ])
        cleared_vacancy = {
            "job_posting_id": vacancy.get("job_posting_id"),
            "job_posted_date": vacancy.get("job_posted_date"),
            "url": vacancy.get("url"),
            "job_title": vacancy.get("job_title"),
            "company_name": vacancy.get("company_name"),
            "job_location": vacancy.get("job_location"),
            "text_data": text_data,
        }
        cleared_vacancies.append(cleared_vacancy)

    return cleared_vacancies



def vacancy_search_by_key(search_vacancy_settings, request, old_vacs_in_project=None):
    # иногда поиска по прямому ключу недостаточно
    # на примере Senior Java Backend Engineer
    # при ручном поиске, если вакансий по прямому ключу мало
    # надо искать  Java Backend Engineer, Senior  Backend Engineer и другие комбинации
    # возможно, проблема решается через апи ключ брайт дата про стрикт кейворд
    # позже предусмотреть механизм по более широкому поиску если основной ключ реализован

    # есть альтернативный путь - сбор урла для поиска на линкед инн на нашей стороне и поиск по нему через брайт дата (или theirstack?)

    old_vacs_in_project = old_vacs_in_project or []
    settings = get_settings()
    search_response = send_search_requst(search_vacancy_settings, request, settings, old_vacs_in_project)
    search_response_data = search_response.json()

    if isinstance(search_response_data, dict) and search_response_data.get("snapshot_id"):
        vacancies = check_brightdata_snapshot(search_response, settings)
    elif search_response.status_code == 200:
        vacancies = _extract_bright_data_vacancies(search_response_data)
    else:
        raise RuntimeError(
            f"Bright Data vacancy search failed: status={search_response.status_code}, "
            f"body={search_response.text[:500]}"
        )
    vacancies = filtration_to_str(vacancies)
    return vacancies
