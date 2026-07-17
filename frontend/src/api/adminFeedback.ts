import { apiBaseUrl } from "../env";
import { fetchWithAuth } from "./auth";

export type AdminFeedbackMatchSummary = {
  match_id?: number;
  match_score?: number;
  recommendation?: string;
  confidence?: string;
  matched_requirements_count?: number;
  missing_or_unclear_requirements_count?: number;
  red_flags_count?: number;
  openai_model?: string;
  prompt_mode?: string;
  run_mode?: string;
  locale?: string;
};

export type AdminFeedbackSummary = {
  id: string;
  created_at: string;
  type: string;
  message_length: number;
  expected_length: number;
  page: string;
  api_mode: string;
  input: {
    resume_source: string;
    vacancy_source: string;
    has_career_strategy: boolean;
    has_red_flags: boolean;
  };
  match: AdminFeedbackMatchSummary | null;
};

export type AdminFeedbackResponse = {
  count: number;
  items: AdminFeedbackSummary[];
};

export async function fetchAdminFeedback(limit = 50, fetcher: typeof fetch = fetchWithAuth) {
  let response: Response;

  try {
    response = await fetcher(`${apiBaseUrl}/admin/feedback?limit=${limit}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    throw new Error(`Не удалось загрузить feedback: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`Не удалось загрузить feedback: ${response.status}`);
  }

  return response.json() as Promise<AdminFeedbackResponse>;
}
