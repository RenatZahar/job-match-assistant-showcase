from psycopg import connect


def check_database(database_url: str | None) -> dict[str, str]:
    if not database_url:
        return {
            "status": "skipped",
            "reason": "DATABASE_URL is not configured",
        }

    try:
        with connect(database_url, connect_timeout=5) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select 1")
                cursor.fetchone()
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "reason": str(exc),
        }

    return {"status": "ok"}
