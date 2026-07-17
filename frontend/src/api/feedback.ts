import { apiBaseUrl, type MatchApiMode } from "../env";
import { fetchWithAuth } from "./auth";
import type { MatchDraft, MatchResult, ScoreBreakdown } from "./match";

export type FeedbackType =
  | "wrong_score"
  | "wrong_recommendation"
  | "missed_requirement"
  | "wrong_red_flag"
  | "ui_bug"
  | "other";

export type FeedbackDraft = {
  type: FeedbackType;
  message: string;
  expected?: string;
};

export type FeedbackEntryResponse = {
  id: string;
  created_at: string;
};

type FeedbackOptions = {
  draft: MatchDraft;
  result?: MatchResult;
  apiMode: MatchApiMode;
  fetcher?: typeof fetch;
  now?: () => Date;
  random?: () => number;
  userAgent?: string;
};

type FeedbackEntry = {
  id: string;
  created_at: string;
  type: FeedbackType;
  message: string;
  expected?: string;
  page: "match";
  api_mode: MatchApiMode;
  browser: {
    user_agent: string;
  };
  input: {
    resume_source: "text" | "file" | "text_and_file" | "empty";
    vacancy_source: "text" | "file" | "text_and_file" | "empty";
    has_career_strategy: boolean;
    has_red_flags: boolean;
  };
  match: {
    match_id: number;
    match_score: number;
    recommendation: string;
    confidence: string;
    score_breakdown: ScoreBreakdown;
    matched_requirements_count: number;
    missing_or_unclear_requirements_count: number;
    red_flags_count: number;
    openai_model: string;
    prompt_mode: MatchDraft["promptMode"];
    run_mode: MatchDraft["runMode"];
    locale: string;
  } | null;
};

export async function createFeedbackEntry(
  feedback: FeedbackDraft,
  options: FeedbackOptions,
): Promise<FeedbackEntryResponse> {
  const message = feedback.message.trim();

  if (!message) {
    throw new Error("Добавь комментарий к обратной связи.");
  }

  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const entry: FeedbackEntry = {
    id: createFeedbackId(createdAt, options.random ?? Math.random),
    created_at: createdAt,
    type: feedback.type,
    message,
    page: "match",
    api_mode: options.apiMode,
    browser: {
      user_agent: readUserAgent(options.userAgent),
    },
    input: {
      resume_source: readInputSource(options.draft.resumeText, options.draft.resumeFile),
      vacancy_source: readInputSource(options.draft.vacancyText, options.draft.vacancyFile),
      has_career_strategy: Boolean(options.draft.careerStrategy.trim()),
      has_red_flags: Boolean(options.draft.redFlags.trim()),
    },
    match: options.result ? createMatchSnapshot(options.draft, options.result) : null,
  };
  const expected = feedback.expected?.trim();

  if (expected) {
    entry.expected = expected;
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new Error(`Не удалось сохранить обратную связь: ${response.status}`);
  }

  return response.json() as Promise<FeedbackEntryResponse>;
}

function createMatchSnapshot(draft: MatchDraft, result: MatchResult): NonNullable<FeedbackEntry["match"]> {
  return {
    match_id: result.match_id,
    match_score: result.match_score,
    recommendation: result.recommendation,
    confidence: result.confidence,
    score_breakdown: result.score_breakdown,
    matched_requirements_count: result.matched_requirements.length,
    missing_or_unclear_requirements_count: result.missing_or_unclear_requirements.length,
    red_flags_count: result.red_flags.length,
    openai_model: draft.openaiModel ?? "unknown",
    prompt_mode: draft.promptMode,
    run_mode: draft.runMode,
    locale: draft.locale,
  };
}

function createFeedbackId(createdAt: string, random: () => number): string {
  const timestamp = createdAt.replace(/[:.]/g, "-").toLowerCase();
  const suffix = random().toString(36).slice(2, 8).padEnd(6, "0");

  return `feedback_${timestamp}_${suffix}`;
}

function readInputSource(text: string, file: File | undefined) {
  const hasText = Boolean(text.trim());
  const hasFile = Boolean(file);

  if (hasText && hasFile) {
    return "text_and_file";
  }

  if (hasFile) {
    return "file";
  }

  if (hasText) {
    return "text";
  }

  return "empty";
}

function readUserAgent(userAgent: string | undefined): string {
  if (userAgent) {
    return userAgent;
  }

  if (typeof navigator !== "undefined") {
    return navigator.userAgent;
  }

  return "unknown";
}
