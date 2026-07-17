const DEFAULT_API_BASE_URL = "http://localhost:8000";

export type MatchApiMode = "mock" | "api";

export function normalizeApiBaseUrl(value: string | undefined): string {
  const rawValue = value?.trim();

  if (!rawValue) {
    return DEFAULT_API_BASE_URL;
  }

  return rawValue.replace(/\/+$/, "");
}

export function normalizeMatchApiMode(value: string | undefined): MatchApiMode {
  return value === "api" ? "api" : "mock";
}

export const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
export const matchApiMode = normalizeMatchApiMode(import.meta.env.VITE_MATCH_API_MODE);
