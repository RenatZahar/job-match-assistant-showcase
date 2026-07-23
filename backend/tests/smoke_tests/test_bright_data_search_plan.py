import pytest
from pydantic import ValidationError

from app.modules.bright_data_provider import BrightDataModel
from app.modules.masks import BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION


def make_search_plan(**overrides):
    payload = {
        "remote": "",
        "country": "AM",
        "experience_level": "Mid-Senior level",
        "location": "Yerevan",
        "keyword": "Python Backend Engineer",
        "company": "",
        "jobs_to_not_include": [],
        "location_radius": "",
    }
    payload.update(overrides)
    return payload


def test_bright_data_instruction_keeps_remote_as_a_hard_filter():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "remote is a hard provider filter, not a ranking preference" in instruction
    assert 'If multiple modes are acceptable, including "X preferred, but open to Y", return ""' in instruction
    assert '"Yerevan on-site/hybrid preferred; open to remote" must return remote=""' in instruction


def test_bright_data_instruction_limits_keyword_to_role_title():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "Use 2 to 4 words and keep it role-title-only" in instruction
    assert "reduce it to the canonical role title" in instruction


def test_bright_data_instruction_does_not_infer_country_from_city():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "country is a hard provider filter, not inferred geographic metadata" in instruction
    assert "Do not infer country from a city, location, resume" in instruction
    assert "Otherwise return null" in instruction


def test_bright_data_instruction_does_not_turn_preferred_city_into_hard_location():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "location is a required hard provider filter, not a ranking preference" in instruction
    assert "do not use the city as the sole location" in instruction
    assert 'return location="Worldwide"' in instruction


def test_bright_data_instruction_uses_worldwide_when_hard_geography_is_missing():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "no explicit hard geographic restriction" in instruction
    assert 'return location="Worldwide", country=null' in instruction
    assert 'otherwise add "geographic restriction"' in instruction
    assert "do not infer geography from resume or other candidate data" in instruction


def test_bright_data_instruction_does_not_infer_seniority_from_resume():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "experience_level is a hard provider filter" in instruction
    assert "Do not infer it from resume or years of experience" in instruction


def test_bright_data_instruction_avoids_redundant_seniority_in_keyword():
    instruction = BRIGHT_DATA_LLM_VALIDATION_INSTRUCTION

    assert "When experience_level is non-empty, omit seniority terms from keyword" in instruction
    assert 'keyword="Python Backend Engineer" with experience_level="Entry level"' in instruction
    assert 'For "Senior only", keyword="Senior Python Engineer" may be used' in instruction
    assert 'experience_level="Mid-Senior level" is broader than the requirement' in instruction


def test_bright_data_model_accepts_empty_remote_filter():
    search_plan = BrightDataModel.model_validate(make_search_plan())

    assert search_plan.remote == ""


def test_bright_data_model_rejects_multiple_remote_values():
    with pytest.raises(ValidationError):
        BrightDataModel.model_validate(make_search_plan(remote=["Hybrid", "Remote"]))
