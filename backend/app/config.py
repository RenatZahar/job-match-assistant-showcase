from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

OpenAIReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh"]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"


def parse_cors_origins(value: str) -> list[str]:
    return [origin.strip() for origin in value.split(",") if origin.strip()]


class Settings(BaseSettings):
    app_env: str = "test"
    database_url: str | None = None
    cors_origins: str = "http://localhost:5173"
    frontend_base_url: str = "http://localhost:5173"
    feedback_storage_dir: Path = PROJECT_ROOT
    llm_provider: str = "none"

    basic_auth_users: str = ""

    openai_api_key: str | None = Field(
        default=None,
        validation_alias="OPENAI_API_KEY",
    )
    openai_model: str = "gpt-5.4-mini"
    openai_reasoning_effort: OpenAIReasoningEffort = "low"
    openai_store_responses: bool = False
    openai_debug_responses: bool = False
    openai_timeout_seconds: int = 60
    openai_max_retries: int = 2
    openai_max_output_tokens: int = 4000
    test_data_dir: Path = PROJECT_ROOT / "test_data"
    database_online_url: str = ""
    bright_data_api_key: str = ""
    bright_data_api_base: str = "https://api.brightdata.com/datasets/v3"
    bright_data_linkedin_jobs_dataset_id: str = "gd_lpfll7v5hcqtkxl6l"
    bright_data_api_search: str = ""
    bright_data_api_snapshot: str = ""
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    
    )

# @lru_cache
def get_settings() -> Settings:
    return Settings()
