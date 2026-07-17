import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from .config import Settings


security = HTTPBasic(auto_error=False)

# сейчас авторизация и ее проверка фактически отключена. проверка происходит при заходе на адресс. и вообще все это нахер - надо делать через sql
def build_basic_auth_dependency(settings: Settings) :
    users = parse_basic_auth_users(settings.basic_auth_users)

    async def require_basic_auth(credentials: HTTPBasicCredentials | None = Depends(security)):
        if not users:
            return "anonymous"

        if credentials is None:
            raise_auth_error()

        expected_password = users.get(credentials.username)
        if expected_password is None:
            raise_auth_error()

        password_ok = secrets.compare_digest(credentials.password, expected_password)
        if not password_ok:
            raise_auth_error()

        return credentials.username

    return require_basic_auth


def parse_basic_auth_users(value: str) -> dict[str, str]:
    users: dict[str, str] = {}
    for raw_item in value.replace("\n", ",").split(","):
        item = raw_item.strip()
        if not item:
            continue

        if ":" not in item:
            raise RuntimeError("BASIC_AUTH_USERS entries must use username:password format")

        username, password = item.split(":", 1)
        username = username.strip()
        password = password.strip()
        if not username or not password:
            raise RuntimeError("BASIC_AUTH_USERS username and password must be non-empty")

        users[username] = password

    return users


def raise_auth_error() -> None:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Basic"},
    )
