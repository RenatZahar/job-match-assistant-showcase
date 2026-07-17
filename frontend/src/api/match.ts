import { apiBaseUrl } from "../env";
import { fetchWithAuth } from "./auth";

export type MatchDraft = {
  resumeText: string;
  resumeFile?: File;
  careerStrategy: string;
  redFlags: string;
  vacancyText: string;
  vacancyFile?: File;
  openaiModel?: OpenAiModel;
  locale: string;
  runMode: "normal" | "test";
  promptMode: "manual" | "generated" | "template";
  manualPrompt: string;
};

export type MatchDraftErrors = Partial<Record<keyof MatchDraft, string>>;

export type MatchRequest = FormData;

export type MatchVerdict = "strong" | "partial" | "weak";
export type OpenAiModel = "gpt-5.4-mini" | "gpt-5.5" | "gpt-5-mini";
export type MatchRecommendation = "apply" | "manual_review" | "reject";
export type MatchConfidence = "low" | "medium" | "high";
export type RedFlagSeverity = "low" | "medium" | "high" | "critical";

export const DEFAULT_OPENAI_MODEL: OpenAiModel = "gpt-5-mini";
const CHECK_MATCH_PROVIDER = "openai";

export const openAiModelOptions: Array<{
  value: OpenAiModel;
  label: string;
  description: string;
}> = [
  {
    value: "gpt-5-mini",
    label: "GPT-5 mini",
    description: "Самый дешевый вариант для частых тестов и простых проверок.",
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Основной вариант MVP: баланс качества, скорости и стоимости.",
  },
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    description: "Самая дорогая опция для финальной проверки сложных CV и вакансий.",
  },
];

export type RequirementItem = {
  requirement: string;
  evidence: string;
  explanation: string;
};

export type RedFlagItem = {
  flag: string;
  severity: RedFlagSeverity;
  evidence: string;
  explanation: string;
};

export type ScoreBreakdown = {
  base_match_score: number;
  red_flags_modifier: number;
  freshness_modifier: number;
  final_score: number;
};

export type MatchResult = {
  match_id: number;
  match_score: number;
  recommendation: MatchRecommendation;
  confidence: MatchConfidence;
  summary: string;
  matched_requirements: RequirementItem[];
  missing_or_unclear_requirements: RequirementItem[];
  red_flags: RedFlagItem[];
  score_breakdown: ScoreBreakdown;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type MatchRequestOptions = {
  mode?: "mock" | "api";
  fetcher?: (input: string, init?: RequestInit) => Promise<FetchResponse>;
};

const TECH_TERMS = [
  "api",
  "backend",
  "cloud",
  "docker",
  "fastapi",
  "frontend",
  "llm",
  "postgres",
  "postgresql",
  "python",
  "react",
  "sql",
  "typescript",
];

export function validateMatchDraft(draft: MatchDraft): MatchDraftErrors {
  const errors: MatchDraftErrors = {};

  if (!draft.resumeText.trim() && !draft.resumeFile) {
    errors.resumeText = "Добавь текст резюме или файл.";
  }

  if (!draft.careerStrategy.trim()) {
    errors.careerStrategy = "Добавь карьерную стратегию кандидата.";
  }

  if (!draft.vacancyText.trim() && !draft.vacancyFile) {
    errors.vacancyText = "Добавь текст вакансии или файл.";
  }

  if (draft.runMode === "test" && draft.promptMode === "manual" && !draft.manualPrompt.trim()) {
    errors.manualPrompt = "Для ручного тестового промта нужен prompt из test_data.";
  }

  return errors;
}

export function toMatchRequest(draft: MatchDraft): MatchRequest {
  const formData = new FormData();
  const resumeText = draft.resumeText.trim();
  const careerStrategy = draft.careerStrategy.trim();
  const redFlags = draft.redFlags.trim();
  const vacancyText = draft.vacancyText.trim();
  const manualPrompt = draft.manualPrompt.trim();

  if (resumeText) {
    formData.append("resume_text", resumeText);
  }

  if (draft.resumeFile) {
    formData.append("resume_file", draft.resumeFile);
  }

  if (careerStrategy) {
    formData.append("career_strategy", careerStrategy);
  }

  if (vacancyText) {
    formData.append("vacancy_text", vacancyText);
  }

  if (redFlags) {
    formData.append("red_flags", redFlags);
  }

  if (draft.vacancyFile) {
    formData.append("vacancy_file", draft.vacancyFile);
  }

  formData.append("locale", draft.locale);
  formData.append("run_mode", draft.runMode);
  formData.append("prompt_mode", draft.promptMode);
  formData.append("provaider", CHECK_MATCH_PROVIDER);
  formData.append("openai_model", draft.openaiModel ?? DEFAULT_OPENAI_MODEL);
  formData.append("source_metadata", JSON.stringify({ source: "manual" }));

  if (draft.runMode === "test" && draft.promptMode === "manual" && manualPrompt) {
    formData.append("manual_prompt", manualPrompt);
  }

  return formData;
}

export function createMockMatchResult(draft: MatchDraft): MatchResult {
  const resumeTerms = extractTerms(draft.resumeText);
  const vacancyTerms = extractTerms(draft.vacancyText);
  const strengths = vacancyTerms.filter((term) => resumeTerms.includes(term));
  const gaps = vacancyTerms.filter((term) => !resumeTerms.includes(term));
  const score = calculateScore(strengths.length, vacancyTerms.length);
  const verdict = score >= 80 ? "strong" : score >= 45 ? "partial" : "weak";

  return {
    match_id: 0,
    match_score: score,
    recommendation: recommendationFromVerdict(verdict),
    confidence: "medium",
    summary: createSummary(verdict, strengths, gaps),
    matched_requirements: strengths.map((requirement) => ({
      requirement,
      evidence: "Найдено в резюме.",
      explanation: "Ключевой термин совпал с вакансией.",
    })),
    missing_or_unclear_requirements: gaps.map((requirement) => ({
      requirement,
      evidence: "Не найдено в резюме.",
      explanation: "Стоит проверить вручную или уточнить опыт кандидата.",
    })),
    red_flags: [],
    score_breakdown: {
      base_match_score: score,
      red_flags_modifier: 0,
      freshness_modifier: 0,
      final_score: score,
    },
  };
}

export async function requestMatch(
  draft: MatchDraft,
  options: MatchRequestOptions = {},
): Promise<MatchResult> {
  if (options.mode === "mock") {
    return createMockMatchResult(draft);
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}/check_match`, {
    method: "POST",
    body: toMatchRequest(draft),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.status));
  }

  return normalizeMatchResult(payload);
}

function normalizeMatchResult(payload: unknown): MatchResult {
  const data = isRecord(payload) ? payload : {};
  const matchScore = normalizeScore(data.match_score ?? data.score);
  const recommendation = normalizeRecommendation(data.recommendation, data.verdict, matchScore);

  return {
    match_id: normalizeMatchId(data.match_id),
    match_score: matchScore,
    recommendation,
    confidence: normalizeConfidence(data.confidence),
    summary: normalizeString(data.summary, ""),
    matched_requirements: normalizeRequirementArray(data.matched_requirements ?? data.strengths),
    missing_or_unclear_requirements: normalizeRequirementArray(
      data.missing_or_unclear_requirements ?? data.gaps,
    ),
    red_flags: normalizeRedFlagArray(data.red_flags),
    score_breakdown: normalizeScoreBreakdown(data.score_breakdown, matchScore),
  };
}

function normalizeScore(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

function normalizeMatchId(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue);
}

function normalizeRecommendation(
  value: unknown,
  legacyVerdict: unknown,
  score: number,
): MatchRecommendation {
  if (value === "apply" || value === "manual_review" || value === "reject") {
    return value;
  }

  if (legacyVerdict === "strong" || legacyVerdict === "partial" || legacyVerdict === "weak") {
    return recommendationFromVerdict(legacyVerdict);
  }

  if (score >= 80) {
    return "apply";
  }

  if (score >= 45) {
    return "manual_review";
  }

  return "reject";
}

function recommendationFromVerdict(verdict: MatchVerdict): MatchRecommendation {
  if (verdict === "strong") {
    return "apply";
  }

  if (verdict === "partial") {
    return "manual_review";
  }

  return "reject";
}

function normalizeConfidence(value: unknown): MatchConfidence {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return "medium";
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function normalizeRequirementArray(value: unknown): RequirementItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return {
          requirement: item,
          evidence: "",
          explanation: "",
        };
      }

      if (!isRecord(item)) {
        return undefined;
      }

      const requirement = normalizeString(item.requirement ?? item.name ?? item.title, "");

      if (!requirement) {
        return undefined;
      }

      return {
        requirement,
        evidence: normalizeString(item.evidence, ""),
        explanation: normalizeString(item.explanation, ""),
      };
    })
    .filter((item): item is RequirementItem => Boolean(item));
}

function normalizeRedFlagArray(value: unknown): RedFlagItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const flag = normalizeString(item.flag ?? item.name ?? item.title, "");

      if (!flag) {
        return undefined;
      }

      return {
        flag,
        severity: normalizeRedFlagSeverity(item.severity),
        evidence: normalizeString(item.evidence, ""),
        explanation: normalizeString(item.explanation, ""),
      };
    })
    .filter((item): item is RedFlagItem => Boolean(item));
}

function normalizeRedFlagSeverity(value: unknown): RedFlagSeverity {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }

  return "medium";
}

function normalizeScoreBreakdown(value: unknown, fallbackScore: number): ScoreBreakdown {
  const data = isRecord(value) ? value : {};

  return {
    base_match_score: normalizeScore(data.base_match_score ?? fallbackScore),
    red_flags_modifier: normalizeModifier(data.red_flags_modifier),
    freshness_modifier: normalizeModifier(data.freshness_modifier),
    final_score: normalizeScore(data.final_score ?? fallbackScore),
  };
}

function normalizeModifier(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue);
}

function extractTerms(text: string): string[] {
  const tokens = new Set(text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []);
  return TECH_TERMS.filter((term) => tokens.has(term));
}

function calculateScore(strengthCount: number, vacancyTermCount: number): number {
  if (vacancyTermCount === 0) {
    return 0;
  }

  return Math.round((strengthCount / vacancyTermCount) * 100);
}

function createSummary(verdict: MatchVerdict, strengths: string[], gaps: string[]): string {
  if (verdict === "strong") {
    return `Сильное совпадение по ключевым требованиям: ${strengths.join(", ")}.`;
  }

  if (verdict === "partial") {
    return `Есть частичное совпадение, но нужно проверить пробелы: ${gaps.join(", ")}.`;
  }

  return `Совпадение слабое: в резюме не хватает большей части ключевых требований.`;
}

function readErrorMessage(payload: unknown, status: number): string {
  if (isErrorPayload(payload) && typeof payload.detail === "string") {
    return payload.detail;
  }

  return `Match request failed with status ${status}`;
}

function isErrorPayload(payload: unknown): payload is { detail: unknown } {
  return typeof payload === "object" && payload !== null && "detail" in payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
