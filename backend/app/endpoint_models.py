from typing import Literal, Any

from pydantic import BaseModel, ConfigDict, Field

OpenAIModel = Literal["gpt-5.4-mini", "gpt-5.5", "gpt-5-mini"]


class AutoVacancyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    search_id: str
    resume: str = Field(min_length=1, max_length=99999)
    career_strategy: str = Field(min_length=1, max_length=333)
    red_flags: str = Field(default="", max_length=333)
    source: str = "linkedin"
    vacancy_limit: int = Field(default=3, ge=1, le=20)
    lang: str = "ru"
    provaider: str = Field(default="", max_length=333)
    openai_model: OpenAIModel = "gpt-5.4-mini"
    source_metadata: str = ""


class ScoreBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_match_score: int = Field(ge=0, le=100)
    red_flags_modifier: int
    freshness_modifier: int
    final_score: int = Field(ge=0, le=100)

class AutoVacancyResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vacancy_id: str
    title: str
    company: str
    source: str = "linkedin"
    source_url: str = ""
    location: str = ""
    match_score: int = Field(ge=0, le=100)
    recommendation: Literal["apply", "manual_review", "reject"]
    confidence: Literal["low", "medium", "high"] = "medium"
    summary: str = ""
    key_reasons: list[str] = []
    matched_requirements: list = []
    missing_or_unclear_requirements: list = []
    red_flags: list = []
    score_breakdown: ScoreBreakdown

class AutoVacancyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    search_id: str
    source: str = "linkedin"
    vacancy_limit: int = Field(ge=1, le=100)
    total_found: int = Field(ge=0, le=100)
    results: list[AutoVacancyResult]


class AutoVacancyMoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vacancy_limit: Literal[3, 5] = 3

class RedFlagResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flag: str
    severity: Literal["low", "medium", "high", "critical"]
    evidence: str
    explanation: str

class SendRequestOAI(BaseModel):
    model_config = ConfigDict(extra="forbid")

    openai_model: OpenAIModel
    openai_reasoning_effort: dict[str, Any] = Field(min_length=1)
    openai_store_responses: str = "False"

    career_strategy: str
    red_flags: str
    resume: str
    vacancy: str
    lang: str
    prompt: str

class CheckMatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    career_strategy: str = Field(min_length=1, max_length=333)
    red_flags: str = Field(default="", max_length=333)
    resume: str = Field(min_length=1, max_length=99999)
    vacancy: str = Field(min_length=1, max_length=99999)
    source_metadata: str = Field(min_length=1, max_length=99999)
    lang: str = "ru"
    provaider: str = Field(default="", max_length=333)
    openai_model: OpenAIModel = "gpt-5.4-mini"
    prompt_mode: Literal["manual", "generated", "template"] = "template"
    run_mode: Literal["normal", "test"] = "normal"
    manual_prompt: str | None = Field(min_length=1, max_length=99999)

class CheckMatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_id: int
    match_score: int = Field(ge=0, le=100)
    recommendation: Literal["apply", "manual_review", "reject"]
    confidence: Literal["low", "medium", "high"]
    summary: str
    matched_requirements: list[str]
    missing_or_unclear_requirements: list[str]
    red_flags: list[RedFlagResult]
    score_breakdown: ScoreBreakdown

class AutoVacancySearchLlmMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assumptions: list[str]
    confidence: Literal["low", "medium", "high"]
    missing_inputs: list[str]
    negative_preferences: list[str]

class AutoVacancyOneResult(BaseModel):
    vacancy_id: str
    provider_job_id: str = ""
    title: str
    company: str
    source: str = "linkedin"
    source_url: str = ""
    location: str = ""
    match_score: int
    recommendation: Literal["apply", "manual_review", "reject"]
    confidence: Literal["low", "medium", "high"]
    summary: str = ""
    key_reasons: list[str]
    matched_requirements: list
    missing_or_unclear_requirements: list
    red_flags: list
    score_breakdown: ScoreBreakdown


class AutoVacancySearchDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    search_id: str #какой тип данных в дб для uuid
    name: str
    resume: str
    career_strategy: str
    red_flags: str
    vacancy_limit: int = Field(default=3, ge=1, le=20)
    locale: str ="ru"
    llm_meta: AutoVacancySearchLlmMeta #сделать словарь (как?) или новую бэйз модел?
    results: list[AutoVacancyOneResult]
    results_count: int #не факт, что нужно, не понимаю, куда уходит
    can_load_more: bool
