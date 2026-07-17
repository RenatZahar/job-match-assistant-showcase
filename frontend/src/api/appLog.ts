import { apiBaseUrl, type MatchApiMode } from "../env";
import { fetchWithAuth } from "./auth";
import type { MatchDraft, MatchResult } from "./match";

export type AppLogEvent =
  | "match_validation_failed"
  | "match_started"
  | "match_succeeded"
  | "match_failed"
  | "feedback_saved"
  | "feedback_failed";

type AppLogOptions = {
  apiMode: MatchApiMode;
  draft: MatchDraft;
  result?: MatchResult;
  error?: unknown;
  validationFields?: string[];
  fetcher?: typeof fetch;
  now?: () => Date;
  random?: () => number;
  userAgent?: string;
};

type AppLogEntry = {
  id: string;
  created_at: string;
  event: AppLogEvent;
  level: "info" | "warning" | "error";
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
    openai_model: string;
    prompt_mode: MatchDraft["promptMode"];
    run_mode: MatchDraft["runMode"];
    locale: string;
  } | null;
  error?: {
    message: string;
  };
  validation_fields?: string[];
};

export async function writeAppLogEntry(
  event: AppLogEvent,
  options: AppLogOptions,
): Promise<void> {
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const entry: AppLogEntry = {
    id: createLogId(createdAt, options.random ?? Math.random),
    created_at: createdAt,
    event,
    level: levelForEvent(event),
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

  const errorMessage = readErrorMessage(options.error);

  if (errorMessage) {
    entry.error = { message: errorMessage };
  }

  if (options.validationFields?.length) {
    entry.validation_fields = options.validationFields;
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}/app_logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new Error(`Не удалось сохранить app log: ${response.status}`);
  }
}

function createMatchSnapshot(draft: MatchDraft, result: MatchResult): NonNullable<AppLogEntry["match"]> {
  return {
    match_id: result.match_id,
    match_score: result.match_score,
    recommendation: result.recommendation,
    confidence: result.confidence,
    openai_model: draft.openaiModel ?? "unknown",
    prompt_mode: draft.promptMode,
    run_mode: draft.runMode,
    locale: draft.locale,
  };
}

function createLogId(createdAt: string, random: () => number): string {
  const timestamp = createdAt.replace(/[:.]/g, "-").toLowerCase();
  const suffix = random().toString(36).slice(2, 8).padEnd(6, "0");

  return `log_${timestamp}_${suffix}`;
}

function levelForEvent(event: AppLogEvent): AppLogEntry["level"] {
  if (event === "match_failed" || event === "feedback_failed") {
    return "error";
  }

  if (event === "match_validation_failed") {
    return "warning";
  }

  return "info";
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

function readErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  if (typeof error === "string") {
    return error.slice(0, 500);
  }

  return undefined;
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
