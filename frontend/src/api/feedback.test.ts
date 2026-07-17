import { describe, expect, it, vi } from "vitest";

import { createFeedbackEntry } from "./feedback";
import type { MatchDraft, MatchResult } from "./match";

const draft: MatchDraft = {
  resumeText: "Raw CV must not be stored",
  resumeFile: new File(["cv"], "cv.docx"),
  careerStrategy: "Senior backend, Germany",
  redFlags: "No gambling",
  vacancyText: "Raw vacancy text should stay out too",
  vacancyFile: new File(["vacancy"], "vacancy.docx"),
  openaiModel: "gpt-5.4-mini",
  locale: "ru",
  runMode: "normal",
  promptMode: "template",
  manualPrompt: "",
};

const result: MatchResult = {
  match_id: 42,
  match_score: 74,
  recommendation: "manual_review",
  confidence: "high",
  summary: "Есть базовое совпадение.",
  matched_requirements: [],
  missing_or_unclear_requirements: [],
  red_flags: [],
  score_breakdown: {
    base_match_score: 80,
    red_flags_modifier: -6,
    freshness_modifier: 0,
    final_score: 74,
  },
};

describe("createFeedbackEntry", () => {
  it("posts feedback with auto metadata and without raw cv or vacancy data", async () => {
    const saved = {
      id: "feedback_2026-05-28t09-00-00-000z_4fzyo8",
      created_at: "2026-05-28T09:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(saved, { status: 201 }));

    const response = await createFeedbackEntry(
      {
        type: "wrong_score",
        message: "Score should be lower.",
        expected: "Expected reject.",
      },
      {
        draft,
        result,
        apiMode: "api",
        fetcher,
        now: () => new Date("2026-05-28T09:00:00.000Z"),
        random: () => 0.123456,
        userAgent: "vitest",
      },
    );

    expect(response).toEqual(saved);
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/feedback",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      id: "feedback_2026-05-28t09-00-00-000z_4fzyo8",
      created_at: "2026-05-28T09:00:00.000Z",
      type: "wrong_score",
      message: "Score should be lower.",
      expected: "Expected reject.",
      page: "match",
      api_mode: "api",
      browser: { user_agent: "vitest" },
      match: {
        match_id: 42,
        match_score: 74,
        recommendation: "manual_review",
        confidence: "high",
        openai_model: "gpt-5.4-mini",
        prompt_mode: "template",
        run_mode: "normal",
        locale: "ru",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Raw CV must not be stored");
    expect(JSON.stringify(body)).not.toContain("Raw vacancy text should stay out too");
    expect(body.resumeText).toBeUndefined();
    expect(body.resumeFile).toBeUndefined();
    expect(body.vacancyText).toBeUndefined();
    expect(body.vacancyFile).toBeUndefined();
  });

  it("requires a non-empty comment before sending feedback", async () => {
    const fetcher = vi.fn();

    await expect(
      createFeedbackEntry(
        { type: "other", message: "   ", expected: "" },
        { draft, result, apiMode: "mock", fetcher },
      ),
    ).rejects.toThrow("Добавь комментарий к обратной связи.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends feedback even when no match result exists yet", async () => {
    const saved = {
      id: "feedback_2026-05-28t10-00-00-000z_4fzyo8",
      created_at: "2026-05-28T10:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(saved, { status: 201 }));

    await createFeedbackEntry(
      { type: "ui_bug", message: "Cannot start with empty data.", expected: "" },
      {
        draft: {
          ...draft,
          resumeText: "",
          resumeFile: undefined,
          careerStrategy: "",
          redFlags: "",
          vacancyText: "",
          vacancyFile: undefined,
        },
        apiMode: "mock",
        fetcher,
        now: () => new Date("2026-05-28T10:00:00.000Z"),
        random: () => 0.123456,
        userAgent: "vitest",
      },
    );

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.match).toBeNull();
    expect(body.input).toMatchObject({
      resume_source: "empty",
      vacancy_source: "empty",
      has_career_strategy: false,
      has_red_flags: false,
    });
  });
});
