import re
import unicodedata
import html

from .masks import ROLE_WORDS, ZERO_WIDTH_AND_BIDI, PROMPT_INJECTION_RE, PROMPT_INJECTION_BOUNDARY

EMAIL_RE = re.compile(r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b")
LINKEDIN_RE = re.compile(r"(?i)\b(?:https?://)?(?:www\.)?linkedin\.com/(?:in|pub)/[^\s<>()\[\]]+")
GITHUB_RE = re.compile(r"(?i)\b(?:https?://)?(?:www\.)?github\.com/[^\s<>()\[\]]+")
URL_RE = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>()\[\]]+")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)")
TELEGRAM_HANDLE_RE = re.compile(r"(?i)\b(telegram|tg)\s*:\s*@[a-z0-9_]{5,32}\b")
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
HTML_BREAK_RE = re.compile(r"(?is)<\s*(br|/p|/div|/li|/h[1-6])\b[^>]*>")
HTML_TAG_RE = re.compile(r"(?is)<[^>\n]{1,200}>")
BIRTH_YEAR_PATTERN = r"(?:19\d{2}|20[0-2]\d)"
MONTH_NAME_PATTERN = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|"
    r"января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|"
    r"июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь"
)
NUMERIC_BIRTH_DATE_PATTERN = (
    rf"(?:\b\d{{1,2}}[./-]\d{{1,2}}[./-]{BIRTH_YEAR_PATTERN}\b|"
    rf"\b{BIRTH_YEAR_PATTERN}[./-]\d{{1,2}}[./-]\d{{1,2}}\b)"
)
TEXTUAL_BIRTH_DATE_PATTERN = (
    rf"(?:\b\d{{1,2}}\s+(?:{MONTH_NAME_PATTERN})\s+{BIRTH_YEAR_PATTERN}\b|"
    rf"\b(?:{MONTH_NAME_PATTERN})\s+\d{{1,2}},?\s+{BIRTH_YEAR_PATTERN}\b)"
)
BIRTH_DATE_VALUE_PATTERN = rf"(?:{NUMERIC_BIRTH_DATE_PATTERN}|{TEXTUAL_BIRTH_DATE_PATTERN}|{BIRTH_YEAR_PATTERN})"
BIRTH_CONTEXT_PATTERN = (
    r"date\s+of\s+birth|birth\s+date|birth\s+year|year\s+of\s+birth|dob|born(?:\s+(?:on|in))?|b\.|"
    r"дата\s+рождения|день\s+рождения|год\s+рождения|д\.р\.|г\.р\.|род\.?|родил(?:ся|ась)?"
)
INLINE_BIRTH_DATE_RE = re.compile(
    rf"(?i)\b({BIRTH_CONTEXT_PATTERN})\s*[:,-]?\s*({BIRTH_DATE_VALUE_PATTERN})"
)
AGE_NUMBER_PATTERN = r"(?:1[4-9]|[2-8]\d|90)"
AGE_UNIT_EN_LABELED_PATTERN = r"(?:years?(?:\s*old)?|yrs?\.?(?:\s*old)?|y\.?\s*o\.?|yo)"
AGE_UNIT_EN_STRONG_PATTERN = r"(?:years?\s*old|yrs?\.?\s*old|y\.?\s*o\.?|yo)"
AGE_UNIT_RU_PATTERN = r"(?:лет|года|год)"
AGE_LABEL_RE = re.compile(
    rf"(?i)\b(age|возраст)\s*[:\-]?\s*({AGE_NUMBER_PATTERN})(?:\s*(?:{AGE_UNIT_EN_LABELED_PATTERN}|{AGE_UNIT_RU_PATTERN}))?\b"
)
STANDALONE_EN_AGE_RE = re.compile(rf"(?i)\b{AGE_NUMBER_PATTERN}\s*(?:{AGE_UNIT_EN_STRONG_PATTERN})\b")
DEMOGRAPHIC_CONTEXT_RE = re.compile(
    rf"(?i)\b(?:male|female|man|woman|gender|sex|мужчина|женщина|мужской|женский|пол|{BIRTH_CONTEXT_PATTERN})\b"
)
DEMOGRAPHIC_AGE_RE = re.compile(
    rf"(?i)\b{AGE_NUMBER_PATTERN}\s*(?:{AGE_UNIT_EN_LABELED_PATTERN}|{AGE_UNIT_RU_PATTERN})\b"
)
COMPACT_GENDER_AGE_RE = re.compile(
    rf"(?i)(\b(?:male|female|man|woman|мужчина|женщина)\b\s*[,;/-]\s*){AGE_NUMBER_PATTERN}(?=\s*(?:[,;/-]|$))"
)
AGE_ONLY_LINE_RE = re.compile(
    rf"(?i)^\s*{AGE_NUMBER_PATTERN}\s*(?:{AGE_UNIT_EN_LABELED_PATTERN}|{AGE_UNIT_RU_PATTERN})\s*[,.]?\s*$"
)


def clean_data_for_sensitive_n_safety(text, sensitive):
    text = sanitize_text(text)
    if sensitive:
        text = clean_sensitive_data(text)
    return text


def neutralize_prompt_injection(text: str) -> str:
    return PROMPT_INJECTION_RE.sub("[POTENTIAL_PROMPT_INJECTION]", text)

def sanitize_text(text: str) -> str:
    text = html.unescape(text)
    text = unicodedata.normalize("NFKC", text)
    text = "".join("" if char in ZERO_WIDTH_AND_BIDI else char for char in text)
    text = CONTROL_CHARS_RE.sub(" ", text)
    text = HTML_BREAK_RE.sub("\n", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = re.sub(r"[ \f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = neutralize_prompt_injection(text)
    return text.strip()

def clean_sensitive_data(text):
    text = replace_candidate_name(text)
    text = replace_labeled_private_line(text, "date_of_birth", "[DATE_OF_BIRTH]")
    text = replace_inline_birth_dates(text)
    text = replace_age_values(text)
    text = replace_labeled_private_line(text, "address", "[ADDRESS]")
    text = replace_labeled_private_line(text, "messenger", "[CONTACT]")
    text = TELEGRAM_HANDLE_RE.sub(lambda match: f"{match.group(1)}: [CONTACT]", text)
    text = LINKEDIN_RE.sub("[LINKEDIN_PROFILE_URL]", text)
    text = GITHUB_RE.sub("[GITHUB_PROFILE_URL]", text)
    text = EMAIL_RE.sub("[EMAIL]", text)
    text = PHONE_RE.sub(replace_phone_match, text)
    text = URL_RE.sub("[PORTFOLIO_URL]", text)
    return text

def replace_inline_birth_dates(text: str) -> str:
    return INLINE_BIRTH_DATE_RE.sub(lambda match: f"{match.group(1)} [DATE_OF_BIRTH]", text)

def replace_age_values(text: str) -> str:
    text = AGE_LABEL_RE.sub(lambda match: f"{match.group(1)}: [AGE]", text)
    text = STANDALONE_EN_AGE_RE.sub("[AGE]", text)

    lines = text.splitlines()
    for index, line in enumerate(lines):
        if DEMOGRAPHIC_CONTEXT_RE.search(line):
            line = COMPACT_GENDER_AGE_RE.sub(lambda match: f"{match.group(1)}[AGE]", line)
            line = DEMOGRAPHIC_AGE_RE.sub("[AGE]", line)
        elif AGE_ONLY_LINE_RE.match(line):
            line = AGE_ONLY_LINE_RE.sub("[AGE]", line)
        lines[index] = line

    return "\n".join(lines)

def replace_candidate_name(text: str) -> str:
    text = re.sub(
        r"(?im)^(name|full name|candidate name|имя|фио)\s*[:\-]\s*.+$",
        lambda match: f"{match.group(1)}: [CANDIDATE_NAME]",
        text,
    )

    lines = text.splitlines()
    for index, line in enumerate(lines):
        value = line.strip()
        if not value:
            continue
        if looks_like_candidate_name(value):
            lines[index] = "[CANDIDATE_NAME]"
        break

    return "\n".join(lines)

def replace_labeled_private_line(text: str, kind: str, placeholder: str) -> str:
    labels = {
        "date_of_birth": (
            r"date of birth|dob|birth date|birth year|year of birth|born|дата рождения|"
            r"день рождения|год рождения|д\.р\.|г\.р\.|род\.?|родился|родилась"
        ),
        "address": r"address|home address|адрес|место проживания",
        "messenger": r"telegram|skype|whatsapp",
    }
    pattern = re.compile(rf"(?im)^({labels[kind]})\s*[:\-]\s*.+$")
    return pattern.sub(lambda match: f"{match.group(1)}: {placeholder}", text)

def looks_like_candidate_name(value: str) -> bool:
    if len(value) > 80 or any(char.isdigit() for char in value):
        return False

    words = re.findall(r"[A-Za-zА-Яа-яЁё'-]+", value)
    if len(words) < 2 or len(words) > 4:
        return False

    lowered_words = {word.lower() for word in words}
    if lowered_words & ROLE_WORDS:
        return False

    return all(word[0].isupper() for word in words if word)

def replace_phone_match(match: re.Match[str]) -> str:
    value = match.group(0)
    digits = re.sub(r"\D", "", value)
    if 8 <= len(digits) <= 18:
        return "[PHONE]"
    return value


def build_provider_instructions(manual_prompt):
    if manual_prompt:
        return f"{PROMPT_INJECTION_BOUNDARY}\n\nTask prompt:\n{manual_prompt}"

    return PROMPT_INJECTION_BOUNDARY
