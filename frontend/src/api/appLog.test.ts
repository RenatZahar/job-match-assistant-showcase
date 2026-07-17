import { describe, expect, it, vi } from "vitest";

import { writeAppLogEntry } from "./appLog";
import type { MatchDraft, MatchResult } from "./match";

const draft: MatchDraft = {
  resumeText: "Raw CV must not be logged",
  resumeFile: new File(["cv"], "candidate.docx"),
  careerStrategy: "Backend Germany",
  redFlags: "No gambling",
  vacancyText: "Raw vacancy must not be logged",
  vacancyFile: new File(["vacancy"], "vacancy.docx"),
  openaiModel: "gpt-5.4-mini",
  locale: "ru",
  runMode: "normal",
  promptMode: "template",
  manualPrompt: "",
};

const result: MatchResult = {
  match_id: 7,
  match_score: 88,
  recommendation: "apply",
  confidence: "high",
  summary: "Good match.",
  matched_requirements: [],
  missing_or_unclear_requirements: [],
  red_flags: [],
  score_breakdown: {
    base_match_score: 88,
    red_flags_modifier: 0,
    freshness_modifier: 0,
    final_score: 88,
  },
};

describe("writeAppLogEntry", () => {
  it("posts a safe app log entry without raw cv or vacancy data", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok" }));

    await writeAppLogEntry("match_failed", {
      apiMode: "api",
      draft,
      result,
      error: new Error("Provider timeout"),
      fetcher,
      now: () => new Date("2026-05-28T11:00:00.000Z"),
      random: () => 0.123456,
      userAgent: "vitest",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/app_logs",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      id: "log_2026-05-28t11-00-00-000z_4fzyo8",
      created_at: "2026-05-28T11:00:00.000Z",
      event: "match_failed",
      level: "error",
      api_mode: "api",
      page: "match",
      browser: { user_agent: "vitest" },
      error: { message: "Provider timeout" },
      input: {
        resume_source: "text_and_file",
        vacancy_source: "text_and_file",
        has_career_strategy: true,
        has_red_flags: true,
      },
      match: {
        match_id: 7,
        match_score: 88,
        recommendation: "apply",
        confidence: "high",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Raw CV must not be logged");
    expect(JSON.stringify(body)).not.toContain("Raw vacancy must not be logged");
    expect(body.resumeText).toBeUndefined();
    expect(body.vacancyText).toBeUndefined();
  });
});
