import { apiBaseUrl } from "../env";
import { fetchWithAuth } from "./auth";
import {
  DEFAULT_OPENAI_MODEL,
  type MatchConfidence,
  type MatchRecommendation,
  type OpenAiModel,
  type RedFlagItem,
  type RedFlagSeverity,
  type RequirementItem,
  type ScoreBreakdown,
  createMockMatchResult,
} from "./match";

export const AUTO_VACANCY_SEARCHES_ENDPOINT = "/auto_vacancy_searches";
export const AUTO_VACANCY_MATCHES_ENDPOINT = "/auto_vacancy_matches";

export type AutoVacancySource = "linkedin";
export type AutoVacancyLimit = 3 | 5;
export const DEFAULT_AUTO_VACANCY_LIMIT: AutoVacancyLimit = 3;
type AutoVacancyModelProvider = "openai";

const autoVacancyModelProviderByModel: Record<OpenAiModel, AutoVacancyModelProvider> = {
  "gpt-5-mini": "openai",
  "gpt-5.4-mini": "openai",
  "gpt-5.5": "openai",
};

export type AutoVacancySearchCreateDraft = {
  name: string;
};

export type AutoVacancySearchRunDraft = {
  resumeText: string;
  resumeFile?: File;
  careerStrategy: string;
  redFlags: string;
  source: AutoVacancySource;
  vacancyLimit: AutoVacancyLimit;
  locale: string;
  openaiModel?: OpenAiModel;
};

export type AutoVacancySearchRunDraftErrors = Partial<Record<keyof AutoVacancySearchRunDraft, string>>;
export type AutoVacancySearchRunRequest = FormData;

export type AutoVacancySearchSummary = {
  search_id: string;
  name: string;
  created_at: string;
  results_count: number;
};

export type AutoVacancySearchListResponse = {
  searches: AutoVacancySearchSummary[];
};

export type AutoVacancySearchLlmMeta = {
  assumptions: string[];
  confidence: MatchConfidence;
  missing_inputs: string[];
  negative_preferences: string[];
};

export type AutoMatchVacancyResult = {
  vacancy_id: string;
  provider_job_id: string;
  title: string;
  company: string;
  source: AutoVacancySource | string;
  source_url: string;
  location: string;
  match_score: number;
  recommendation: MatchRecommendation;
  confidence: MatchConfidence;
  summary: string;
  key_reasons: string[];
  matched_requirements: RequirementItem[];
  missing_or_unclear_requirements: RequirementItem[];
  red_flags: RedFlagItem[];
  score_breakdown: ScoreBreakdown;
};

export type AutoVacancySearchDetail = {
  search_id: string;
  name: string;
  resume: string;
  career_strategy: string;
  red_flags: string;
  vacancy_limit: AutoVacancyLimit;
  locale: string;
  llm_meta: AutoVacancySearchLlmMeta;
  results: AutoMatchVacancyResult[];
  results_count?: number;
  can_load_more?: boolean;
};

export type AutoVacancySearchMoreResponse = {
  search_id: string;
  added_results: AutoMatchVacancyResult[];
  results_count: number;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type AutoVacancySearchRequestOptions = {
  mode?: "mock" | "api";
  fetcher?: (input: string, init?: RequestInit) => Promise<FetchResponse>;
};

type MockVacancy = {
  id: string;
  providerJobId: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  vacancyText: string;
};

const MOCK_VACANCIES: MockVacancy[] = [
  {
    id: "mock_linkedin_1",
    providerJobId: "mock_provider_linkedin_1",
    title: "Python Backend Engineer",
    company: "Example Cloud GmbH",
    location: "Berlin, Germany",
    sourceUrl: "https://www.linkedin.com/jobs/view/mock-linkedin-1",
    vacancyText:
      "Python FastAPI PostgreSQL backend API Docker cloud deployments production support.",
  },
  {
    id: "mock_linkedin_2",
    providerJobId: "mock_provider_linkedin_2",
    title: "API Platform Developer",
    company: "Northstar Systems",
    location: "Remote EU",
    sourceUrl: "https://www.linkedin.com/jobs/view/mock-linkedin-2",
    vacancyText:
      "Backend API Python SQL integrations Docker observability and cloud platform work.",
  },
  {
    id: "mock_linkedin_3",
    providerJobId: "mock_provider_linkedin_3",
    title: "Full Stack Engineer",
    company: "Product Lab",
    location: "Munich, Germany",
    sourceUrl: "https://www.linkedin.com/jobs/view/mock-linkedin-3",
    vacancyText:
      "React TypeScript frontend with Python backend services and REST API integrations.",
  },
];

/**
 * Expected backend contract:
 *
 * GET /auto_vacancy_searches
 * Response:
 * { searches: [{ search_id, name, results_count, created_at }] }
 */
export async function listAutoVacancySearches(
  options: AutoVacancySearchRequestOptions = {},
): Promise<AutoVacancySearchListResponse> {
  if (options.mode === "mock") {
    return { searches: [] };
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}${AUTO_VACANCY_SEARCHES_ENDPOINT}`, {
    method: "GET",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.status));
  }

  return normalizeAutoVacancySearchListResponse(payload);
}

/**
 * Expected backend contract:
 *
 * POST /auto_vacancy_searches
 * Content-Type: application/json
 * Request: { name: string }
 * Response: { search_id, name, results_count, created_at }
 */
export async function createAutoVacancySearchDraft(
  draft: AutoVacancySearchCreateDraft,
  options: AutoVacancySearchRequestOptions = {},
): Promise<AutoVacancySearchDetail> {
  const name = draft.name.trim();

  if (!name) {
    throw new Error("Добавь название поиска.");
  }

  if (options.mode === "mock") {
    return createMockAutoVacancySearchDetail({
      name,
      searchId: "mock_auto_vacancy_search",
      hasResults: false,
    });
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}${AUTO_VACANCY_SEARCHES_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.status));
  }

  return normalizeAutoVacancySearchDetail(payload, { name });
}

/**
 * Expected backend contract:
 *
 * GET /auto_vacancy_searches/{search_id}
 * Response detail:
 * {
 *   search_id, name,
 *   career_strategy?, red_flags?, vacancy_limit?, results, results_count?, can_load_more?
 * }
 */
export async function fetchAutoVacancySearch(
  searchId: string,
  options: AutoVacancySearchRequestOptions = {},
): Promise<AutoVacancySearchDetail> {
  if (options.mode === "mock") {
    return createMockAutoVacancySearchDetail({ searchId, name: "Mock saved search" });
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(
    `${apiBaseUrl}${AUTO_VACANCY_SEARCHES_ENDPOINT}/${encodeURIComponent(searchId)}`,
    { method: "GET" },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.status));
  }

  return normalizeAutoVacancySearchDetail(payload);
}

/**
 * Expected backend contract:
 *
 * POST /auto_vacancy_matches
 * Content-Type: multipart/form-data
 *
 * Request fields:
 * - search_id
 * - resume_text or resume_file
 * - career_strategy
 * - red_flags optional
 * - source: "linkedin"
 * - vacancy_limit: "3" or "5"
 * - locale
 * - provaider: "openai"
 * - openai_model
 * - source_metadata: selected source value, currently "linkedin"
 *
 * Search name is intentionally not sent as the main source of truth here.
 * The project was already created through POST /auto_vacancy_searches.
 */
export function validateAutoVacancySearchRunDraft(
  draft: AutoVacancySearchRunDraft,
): AutoVacancySearchRunDraftErrors {
  const errors: AutoVacancySearchRunDraftErrors = {};

  if (!draft.resumeText.trim() && !draft.resumeFile) {
    errors.resumeText = "Добавь текст резюме или файл.";
  }

  if (!draft.careerStrategy.trim()) {
    errors.careerStrategy = "Добавь карьерную стратегию кандидата.";
  }

  return errors;
}

export function toAutoVacancySearchRunRequest(
  searchId: string,
  draft: AutoVacancySearchRunDraft,
): AutoVacancySearchRunRequest {
  const formData = new FormData();
  const resumeText = draft.resumeText.trim();
  const careerStrategy = draft.careerStrategy.trim();
  const redFlags = draft.redFlags.trim();

  formData.append("search_id", searchId);

  if (resumeText) {
    formData.append("resume_text", resumeText);
  }

  if (draft.resumeFile) {
    formData.append("resume_file", draft.resumeFile);
  }

  if (careerStrategy) {
    formData.append("career_strategy", careerStrategy);
  }

  if (redFlags) {
    formData.append("red_flags", redFlags);
  }

  formData.append("source", draft.source);
  formData.append("vacancy_limit", String(draft.vacancyLimit));
  formData.append("locale", draft.locale);
  formData.append("provaider", resolveAutoVacancyModelProvider(draft.openaiModel));
  formData.append("openai_model", draft.openaiModel ?? DEFAULT_OPENAI_MODEL);
  formData.append("source_metadata", draft.source);

  return formData;
}

function resolveAutoVacancyModelProvider(openaiModel: OpenAiModel | undefined): AutoVacancyModelProvider {
  return autoVacancyModelProviderByModel[openaiModel ?? DEFAULT_OPENAI_MODEL];
}

export async function runAutoVacancySearch(
  searchId: string,
  draft: AutoVacancySearchRunDraft,
  options: AutoVacancySearchRequestOptions = {},
): Promise<AutoVacancySearchDetail> {
  if (options.mode === "mock") {
    return createMockAutoVacancySearchDetail({
      draft,
      name: "Mock auto vacancy search",
      searchId,
      hasResults: true,
    });
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}${AUTO_VACANCY_MATCHES_ENDPOINT}`, {
    method: "POST",
    body: toAutoVacancySearchRunRequest(searchId, draft),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.status));
  }

  return normalizeAutoVacancySearchDetail(payload, { ...draft, search_id: searchId });
}

/**
 * Expected backend contract:
 *
 * POST /auto_vacancy_searches/{search_id}/more
 *
 * Request JSON: { vacancy_limit: 3 | 5 }
 * Frontend intentionally sends no jobs_to_not_include. Backend owns provider
 * continuation state and duplicate exclusion.
 */
export async function loadMoreAutoVacancySearch(
  searchId: string,
  vacancyLimit: AutoVacancyLimit,
  options: AutoVacancySearchRequestOptions = {},
): Promise<AutoVacancySearchDetail | AutoVacancySearchMoreResponse> {
  if (options.mode === "mock") {
    return {
      search_id: searchId,
      added_results: [
        createMockAutoMatchVacancyResult(MOCK_VACANCIES[1], {
          resumeText: "Python FastAPI",
          careerStrategy: "Backend role",
          redFlags: "",
          source: "linkedin",
          vacancyLimit,
          locale: "ru",
        }),
      ],
      results_count: 2,
    };
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(
    `${apiBaseUrl}${AUTO_VACANCY_SEARCHES_ENDPOINT}/${encodeURIComponent(searchId)}/more`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vacancy_limit: vacancyLimit }),
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.status));
  }

  return normalizeAutoVacancySearchMorePayload(payload);
}

export function mergeAutoVacancySearchMoreResponse(
  current: AutoVacancySearchDetail,
  response: AutoVacancySearchDetail | AutoVacancySearchMoreResponse,
): AutoVacancySearchDetail {
  if (!isAutoVacancySearchMoreResponse(response)) {
    return response;
  }

  return {
    ...current,
    results: [...response.added_results, ...current.results],
    results_count: response.results_count,
  };
}

export function createMockAutoVacancySearchDetail({
  draft,
  hasResults = true,
  name,
  searchId,
}: {
  draft?: AutoVacancySearchRunDraft;
  hasResults?: boolean;
  name?: string;
  searchId?: string;
} = {}): AutoVacancySearchDetail {
  const mockDraft: AutoVacancySearchRunDraft = draft ?? {
    resumeText: "Python FastAPI PostgreSQL Docker API",
    careerStrategy: hasResults ? "Senior backend in Germany" : "",
    redFlags: hasResults ? "no crypto" : "",
    source: "linkedin",
    vacancyLimit: DEFAULT_AUTO_VACANCY_LIMIT,
    locale: "ru",
  };
  const results = hasResults ? [createMockAutoMatchVacancyResult(MOCK_VACANCIES[0], mockDraft)] : [];

  return {
    search_id: searchId ?? "mock_auto_vacancy_search",
    name: name ?? "Mock auto vacancy search",
    resume: mockDraft.resumeText,
    career_strategy: mockDraft.careerStrategy,
    red_flags: mockDraft.redFlags,
    vacancy_limit: mockDraft.vacancyLimit,
    locale: mockDraft.locale,
    llm_meta: {
      assumptions: [],
      confidence: "high",
      missing_inputs: [],
      negative_preferences: [],
    },
    results,
    results_count: results.length,
    can_load_more: results.length > 0,
  };
}

function normalizeAutoVacancySearchListResponse(
  payload: unknown,
): AutoVacancySearchListResponse {
  const data = isRecord(payload) ? payload : {};
  const rawSearches = Array.isArray(data.searches) ? data.searches : [];

  return {
    searches: rawSearches.map(normalizeAutoVacancySearchSummary),
  };
}

function normalizeAutoVacancySearchSummary(
  value: unknown,
  index: number,
): AutoVacancySearchSummary {
  const data = isRecord(value) ? value : {};

  return {
    search_id: normalizeString(data.search_id ?? data.id, `search_${index + 1}`),
    name: normalizeString(data.name ?? data.title, "Untitled search"),
    created_at: normalizeString(data.created_at, ""),
    results_count: normalizeNonNegativeInteger(data.results_count ?? data.count, 0),
  };
}

function normalizeAutoVacancySearchDetail(
  payload: unknown,
  fallback: Partial<AutoVacancySearchRunDraft & AutoVacancySearchCreateDraft & AutoVacancySearchDetail> = {},
): AutoVacancySearchDetail {
  const data = isRecord(payload) ? payload : {};
  const inputs = isRecord(data.inputs) ? data.inputs : {};
  const rawResults = data.results ?? data.items ?? data.vacancies;
  const results = Array.isArray(rawResults)
    ? rawResults.map(normalizeAutoMatchVacancyResult)
    : [];
  const careerStrategy = normalizeString(
    data.career_strategy ?? inputs.career_strategy,
    fallback.careerStrategy ?? fallback.career_strategy ?? "",
  );
  const resume = normalizeString(
    data.resume ?? data.resume_text ?? inputs.resume ?? inputs.resume_text,
    fallback.resumeText ?? fallback.resume ?? "",
  );
  const redFlags = normalizeString(
    data.red_flags ?? inputs.red_flags,
    fallback.redFlags ?? fallback.red_flags ?? "",
  );
  const vacancyLimit = normalizeVacancyLimit(
    data.vacancy_limit ?? inputs.vacancy_limit,
    fallback.vacancyLimit ?? fallback.vacancy_limit ?? DEFAULT_AUTO_VACANCY_LIMIT,
  );

  return {
    search_id: normalizeString(data.search_id ?? data.id, fallback.search_id ?? ""),
    name: normalizeString(data.name ?? data.title, fallback.name ?? "Untitled search"),
    resume,
    career_strategy: careerStrategy,
    red_flags: redFlags,
    vacancy_limit: vacancyLimit,
    locale: normalizeString(data.locale ?? inputs.locale, fallback.locale ?? "ru"),
    llm_meta: normalizeAutoVacancySearchLlmMeta(data.llm_meta),
    results,
    results_count:
      data.results_count === undefined
        ? results.length
        : normalizeNonNegativeInteger(data.results_count, results.length),
    can_load_more: typeof data.can_load_more === "boolean" ? data.can_load_more : undefined,
  };
}

function normalizeAutoVacancySearchLlmMeta(value: unknown): AutoVacancySearchLlmMeta {
  const data = isRecord(value) ? value : {};

  return {
    assumptions: normalizeStringArray(data.assumptions),
    confidence: normalizeConfidence(data.confidence),
    missing_inputs: normalizeStringArray(data.missing_inputs),
    negative_preferences: normalizeStringArray(data.negative_preferences),
  };
}

function normalizeAutoVacancySearchMorePayload(
  payload: unknown,
): AutoVacancySearchDetail | AutoVacancySearchMoreResponse {
  const data = isRecord(payload) ? payload : {};

  if (Array.isArray(data.added_results)) {
    return {
      search_id: normalizeString(data.search_id ?? data.id, ""),
      added_results: data.added_results.map(normalizeAutoMatchVacancyResult),
      results_count: normalizeNonNegativeInteger(data.results_count ?? data.count, 0),
    };
  }

  return normalizeAutoVacancySearchDetail(payload);
}

function normalizeAutoMatchVacancyResult(value: unknown, index: number): AutoMatchVacancyResult {
  const data = isRecord(value) ? value : {};
  const matchScore = normalizeScore(data.match_score ?? data.score);
  const matchedRequirements = normalizeRequirementArray(data.matched_requirements ?? data.strengths);
  const missingRequirements = normalizeRequirementArray(
    data.missing_or_unclear_requirements ?? data.gaps,
  );

  return {
    vacancy_id: normalizeString(data.vacancy_id ?? data.id, `vacancy_${index + 1}`),
    provider_job_id: normalizeString(data.provider_job_id, ""),
    title: normalizeString(data.title ?? data.vacancy_title ?? data.position, "Untitled vacancy"),
    company: normalizeString(data.company ?? data.company_name, "Unknown company"),
    source: normalizeString(data.source, "linkedin"),
    source_url: normalizeString(data.source_url ?? data.job_url ?? data.url, ""),
    location: normalizeString(data.location, ""),
    match_score: matchScore,
    recommendation: normalizeRecommendation(data.recommendation, data.verdict, matchScore),
    confidence: normalizeConfidence(data.confidence),
    summary: normalizeString(data.summary, ""),
    key_reasons: normalizeKeyReasons(data.key_reasons ?? data.reasons, matchedRequirements, missingRequirements),
    matched_requirements: matchedRequirements,
    missing_or_unclear_requirements: missingRequirements,
    red_flags: normalizeRedFlagArray(data.red_flags),
    score_breakdown: normalizeScoreBreakdown(data.score_breakdown, matchScore),
  };
}

function createMockAutoMatchVacancyResult(
  vacancy: MockVacancy,
  draft: AutoVacancySearchRunDraft,
): AutoMatchVacancyResult {
  const match = createMockMatchResult({
    resumeText: draft.resumeText,
    resumeFile: draft.resumeFile,
    careerStrategy: draft.careerStrategy,
    redFlags: draft.redFlags,
    vacancyText: vacancy.vacancyText,
    openaiModel: draft.openaiModel,
    locale: draft.locale,
    runMode: "normal",
    promptMode: "template",
    manualPrompt: "",
  });

  return {
    vacancy_id: vacancy.id,
    provider_job_id: vacancy.providerJobId,
    title: vacancy.title,
    company: vacancy.company,
    source: draft.source,
    source_url: vacancy.sourceUrl,
    location: vacancy.location,
    match_score: match.match_score,
    recommendation: match.recommendation,
    confidence: match.confidence,
    summary: match.summary,
    key_reasons: createKeyReasons(match.matched_requirements, match.missing_or_unclear_requirements),
    matched_requirements: match.matched_requirements,
    missing_or_unclear_requirements: match.missing_or_unclear_requirements,
    red_flags: match.red_flags,
    score_breakdown: match.score_breakdown,
  };
}

function createKeyReasons(
  matchedRequirements: RequirementItem[],
  missingRequirements: RequirementItem[],
): string[] {
  const matched = matchedRequirements.slice(0, 2).map((item) => `Совпало: ${item.requirement}`);
  const missing = missingRequirements.slice(0, 1).map((item) => `Проверить: ${item.requirement}`);

  return [...matched, ...missing];
}

function normalizeKeyReasons(
  value: unknown,
  matchedRequirements: RequirementItem[],
  missingRequirements: RequirementItem[],
): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item, ""))
      .filter(Boolean)
      .slice(0, 4);
  }

  return createKeyReasons(matchedRequirements, missingRequirements);
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

function normalizeScoreBreakdown(value: unknown, fallbackScore: number): ScoreBreakdown {
  const data = isRecord(value) ? value : {};

  return {
    base_match_score: normalizeScore(data.base_match_score ?? fallbackScore),
    red_flags_modifier: normalizeModifier(data.red_flags_modifier),
    freshness_modifier: normalizeModifier(data.freshness_modifier),
    final_score: normalizeScore(data.final_score ?? fallbackScore),
  };
}

function normalizeScore(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

function normalizeModifier(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue);
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.round(numericValue));
}

function normalizeVacancyLimit(value: unknown, fallback: AutoVacancyLimit): AutoVacancyLimit {
  const limit = normalizeNonNegativeInteger(value, fallback);

  return limit === 3 || limit === 5 ? limit : fallback;
}

function normalizeRecommendation(
  value: unknown,
  legacyVerdict: unknown,
  score: number,
): MatchRecommendation {
  if (value === "apply" || value === "manual_review" || value === "reject") {
    return value;
  }

  if (legacyVerdict === "strong") {
    return "apply";
  }

  if (legacyVerdict === "partial") {
    return "manual_review";
  }

  if (legacyVerdict === "weak") {
    return "reject";
  }

  if (score >= 80) {
    return "apply";
  }

  if (score >= 45) {
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

function normalizeRedFlagSeverity(value: unknown): RedFlagSeverity {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item, "")).filter(Boolean);
}

function isAutoVacancySearchMoreResponse(
  value: AutoVacancySearchDetail | AutoVacancySearchMoreResponse,
): value is AutoVacancySearchMoreResponse {
  return "added_results" in value;
}

function readErrorMessage(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.detail === "string") {
    return payload.detail;
  }

  return `Auto vacancy search request failed with status ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
