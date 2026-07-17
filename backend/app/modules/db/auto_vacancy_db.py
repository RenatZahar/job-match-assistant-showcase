from app.config import get_settings
from psycopg import connect
from psycopg.types.json import Jsonb


def get_db_path():
    settings = get_settings()
    return settings.database_url or settings.database_online_url


def save_auto_vacancy_project_name(name, username):
    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
            """
            insert into auto_vacancy_searches (username, search_name)
            values (%s, %s)
            returning search_id, search_name, results_count, created_at
            """,
            (username, name)
            )
            result = cursor.fetchone()

            search_id, search_name, results_count, created_at = result
            return {
                    "search_id": str(search_id),
                    "name": search_name,
                    "results_count": results_count,
                    "created_at": created_at.isoformat(),
                    }


def get_auto_vacancy_project_names(username):
    # предусмотрть сортировку по дате создания
    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create extension if not exists pgcrypto;

                create table if not exists auto_vacancy_searches
                    (
                    search_id uuid primary key default gen_random_uuid(),
                    username text not null,
                    search_name text not null,
                    results_count integer not null default 0,
                    created_at timestamptz not null default now(),

                    source text,
                    status text default 'draft',
                    resume text,
                    career_strategy text,
                    red_flags text,
                    locale text,
                    search_plan_json jsonb,
                    bright_data_payload_json jsonb,
                    llm_meta_json jsonb,
                    shown_job_ids_json jsonb not null default '[]'::jsonb,
                    updated_at timestamptz not null default now()
                    )
                """
                )
            cursor.execute(
                """
                select search_id, search_name, results_count, created_at
                from auto_vacancy_searches
                where username = %s
                order by created_at desc
                """,
                (username,),
                )
            result = cursor.fetchall()
            return {
                    "searches": [
                            {
                            "search_id": str(search_id),
                            "name": search_name,
                            "results_count": results_count,
                            "created_at": created_at.isoformat(),
                            }
                            for search_id, search_name, results_count, created_at in result
                        ]
                    }


def save_users_input(request, username, search_id=None):
    if not search_id:
        return {"saved": False, "reason": "search_id is missing"}

    database_url = get_db_path()
    query = """
        update auto_vacancy_searches
        set
            source = %s,
            status = 'inputs_saved',
            resume = %s,
            career_strategy = %s,
            red_flags = %s,
            locale = %s,
            updated_at = now()
        where search_id = %s
    """
    params = [
        request.source,
        request.resume,
        request.career_strategy,
        request.red_flags,
        request.lang,
        search_id,
    ]

    if username:
        query += " and username = %s"
        params.append(username)

    query += """
        returning
            search_id,
            search_name,
            source,
            status,
            resume,
            career_strategy,
            red_flags,
            locale,
            results_count,
            created_at,
            updated_at
    """

    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            result = cursor.fetchone()

            if result is None:
                raise ValueError("auto vacancy search was not found for the current user")


def save_search_plan_llm_meta(search_plan, llm_meta, search_id=None, username=None):
    if not search_id:
        return {"saved": False, "reason": "search_id is missing"}

    database_url = get_db_path()
    query = """
        update auto_vacancy_searches
        set
            search_plan_json = %s,
            llm_meta_json = %s,
            status = 'search_plan_saved',
            updated_at = now()
        where search_id = %s
    """
    params = [Jsonb(search_plan), Jsonb(llm_meta), search_id]

    if username:
        query += " and username = %s"
        params.append(username)

    query += " returning search_id"

    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            result = cursor.fetchone()

            if result is None:
                raise ValueError("auto vacancy search was not found for the current user")

            return {"saved": True, "search_id": str(result[0])}


def _get_first_value(data, keys, default=""):
    for key in keys:
        value = data.get(key)
        if value is not None:
            return value
    return default


def _as_text(value):
    if value is None:
        return ""
    return str(value).strip()


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


def _extract_provider_job_id(vacancy):
    value = _get_first_value(vacancy, ("actual_job_posting_id", "job_posting_id"))
    return _as_text(value)


def save_bright_data_response(vacancies, search_id=None, username=None):
    if not search_id:
        return {"saved": False, "reason": "search_id is missing", "saved_count": 0}

    if not vacancies:
        return {"saved": False, "reason": "no vacancies in Bright Data response", "saved_count": 0}

    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("create extension if not exists pgcrypto")
            cursor.execute(
                """
                create table if not exists auto_vacancy_results
                    (
                    id uuid primary key default gen_random_uuid(),
                    search_id uuid not null references auto_vacancy_searches(search_id) on delete cascade,
                    username text,
                    provider_job_id text,
                    title text not null,
                    company text not null,
                    source text not null default 'linkedin',
                    source_url text,
                    location text,
                    provider_raw_json jsonb not null,
                    match_score integer,
                    recommendation text,
                    key_reasons_json jsonb not null default '[]'::jsonb,
                    score_breakdown_json jsonb,
                    llm_result_json jsonb,
                    updated_at timestamptz not null default now(),
                    created_at timestamptz not null default now()
                    )
                """
            )
            cursor.execute("alter table auto_vacancy_results add column if not exists llm_result_json jsonb")
            cursor.execute(
                """
                alter table auto_vacancy_results
                add column if not exists updated_at timestamptz not null default now()
                """
            )

            saved_count = 0
            provider_job_ids = []

            for vacancy in vacancies:
                provider_job_id = _as_text(vacancy.get("job_posting_id"))
                title = _as_text(vacancy.get("job_title"))
                company = _as_text(vacancy.get("company_name"))
                source_url = _as_text(vacancy.get("url"))
                location = _as_text(vacancy.get("job_location"))

                if not title:
                    title = "Untitled vacancy"
                if not company:
                    company = "Unknown company"

                cursor.execute(
                    """
                    insert into auto_vacancy_results
                        (
                        search_id,
                        username,
                        provider_job_id,
                        title,
                        company,
                        source,
                        source_url,
                        location,
                        provider_raw_json
                        )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        search_id,
                        username,
                        provider_job_id or None,
                        title,
                        company,
                        "linkedin",
                        source_url,
                        location,
                        Jsonb(vacancy),
                    ),
                )
                saved_count += 1
                if provider_job_id:
                    provider_job_ids.append(provider_job_id)

            cursor.execute(
                """
                update auto_vacancy_searches
                set
                    results_count = (
                        select count(*)
                        from auto_vacancy_results
                        where search_id = %s
                    ),
                    shown_job_ids_json = (
                        select coalesce(jsonb_agg(distinct job_id), '[]'::jsonb)
                        from (
                            select jsonb_array_elements_text(shown_job_ids_json) as job_id
                            from auto_vacancy_searches
                            where search_id = %s
                            union
                            select unnest(%s::text[]) as job_id
                        ) ids
                        where job_id <> ''
                    ),
                    status = 'vacancies_saved',
                    updated_at = now()
                where search_id = %s
                """,
                (search_id, search_id, provider_job_ids, search_id),
            )

            return {
                "saved": True,
                "saved_count": saved_count,
                "provider_job_ids_count": len(provider_job_ids),
            }


def save_auto_vacancy_match_results(oai_results, search_id=None, username=None):
    if not search_id:
        return {"saved": False, "reason": "search_id is missing", "saved_count": 0}

    if not oai_results:
        return {"saved": False, "reason": "no match results", "saved_count": 0}

    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("alter table auto_vacancy_results add column if not exists llm_result_json jsonb")
            cursor.execute(
                """
                alter table auto_vacancy_results
                add column if not exists updated_at timestamptz not null default now()
                """
            )

            saved_count = 0

            for result in oai_results:
                provider_job_id = _as_text(result.get("vacancy_id"))
                llm_answer = result.get("llm_answer") or {}

                if not provider_job_id or not llm_answer:
                    continue

                query = """
                    update auto_vacancy_results
                    set
                        match_score = %s,
                        recommendation = %s,
                        key_reasons_json = %s,
                        score_breakdown_json = %s,
                        llm_result_json = %s,
                        updated_at = now()
                    where search_id = %s
                        and provider_job_id = %s
                """
                params = [
                    llm_answer.get("match_score"),
                    llm_answer.get("recommendation"),
                    Jsonb(llm_answer.get("key_reasons", [])),
                    Jsonb(llm_answer.get("score_breakdown")),
                    Jsonb(llm_answer),
                    search_id,
                    provider_job_id,
                ]

                if username:
                    query += " and username = %s"
                    params.append(username)

                cursor.execute(query, params)
                saved_count += cursor.rowcount

            if username:
                cursor.execute(
                    """
                    update auto_vacancy_searches
                    set
                        status = 'matched',
                        updated_at = now()
                    where search_id = %s
                        and username = %s
                    """,
                    (search_id, username),
                )
            else:
                cursor.execute(
                    """
                    update auto_vacancy_searches
                    set
                        status = 'matched',
                        updated_at = now()
                    where search_id = %s
                    """,
                    (search_id,),
                )

            return {"saved": True, "saved_count": saved_count}


def get_vacancy_ids(search_id, username, database_url):
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select id from auto_vacancy_results
                where search_id = %s and username = %s

                """,
                (search_id, username,)
                )

            result = cursor.fetchall()
            return [row[0] for row in result]

def get_vacancies_data(vacancies_ids, search_id, username, database_url):
    if vacancies_ids:
        with connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select
                        id,
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
                        created_at
                    from auto_vacancy_results
                    where id = any(%s) and search_id = %s and username = %s
                    order by match_score desc nulls last, created_at desc

                    """,
                    (vacancies_ids, search_id, username,)
                    )
                result = cursor.fetchall()
                return result
    else:
        return []

def get_vacancies_n_match_data(search_id, username):
    database_url = get_db_path()
    vacancies_ids = get_vacancy_ids(search_id, username, database_url)
    vacancies_data = get_vacancies_data(vacancies_ids, search_id, username, database_url)
    return vacancies_data


def get_search_data(search_id, username):
    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select
                    search_id,
                    search_name,
                    resume,
                    career_strategy,
                    red_flags,
                    locale,
                    llm_meta_json,
                    results_count
                from auto_vacancy_searches
                where search_id = %s
                and username = %s
                """,
                (search_id, username,)
                )
            result = cursor.fetchone()

    return result


def get_search_run_context(search_id, username):
    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select
                    search_id,
                    source,
                    resume,
                    career_strategy,
                    red_flags,
                    locale,
                    search_plan_json,
                    shown_job_ids_json,
                    results_count
                from auto_vacancy_searches
                where search_id = %s
                and username = %s
                """,
                (search_id, username,),
                )
            result = cursor.fetchone()

    return result


def get_bright_data_vac_ids_in_search_project(search_id, username):
    """функция возвращает список брайт дата идс для поискового проекта"""
    database_url = get_db_path()
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass('auto_vacancy_results')")
            table_exists = cursor.fetchone()[0]
            if table_exists is None:
                return []

            cursor.execute(
                """
                select provider_job_id
                from auto_vacancy_results
                where search_id = %s
                and username = %s
                and provider_job_id is not null
                """,
                (search_id, username,),
                )
            result = cursor.fetchall()
            return [row[0] for row in result]
