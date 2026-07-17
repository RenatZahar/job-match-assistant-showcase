import { describe, expect, it, vi } from "vitest";

import {
  createMockMatchResult,
  openAiModelOptions,
  requestMatch,
  toMatchRequest,
  validateMatchDraft,
} from "./match";

describe("openAiModelOptions", () => {
  it("orders models from cheaper/faster to more expensive/stronger", () => {
    expect(openAiModelOptions.map((option) => option.value)).toEqual([
      "gpt-5-mini",
      "gpt-5.4-mini",
      "gpt-5.5",
    ]);
  });

  it("describes the practical tradeoff for each model", () => {
    expect(openAiModelOptions.map((option) => option.description)).toEqual([
      "Самый дешевый вариант для частых тестов и простых проверок.",
      "Основной вариант MVP: баланс качества, скорости и стоимости.",
      "Самая дорогая опция для финальной проверки сложных CV и вакансий.",
    ]);
  });
});

describe("validateMatchDraft", () => {
  it("requires resume and vacancy text", () => {
    expect(
      validateMatchDraft({
        resumeText: " ",
        careerStrategy: "",
        redFlags: "",
        vacancyText: "",
        locale: "ru",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      }),
    ).toEqual({
      resumeText: "Добавь текст резюме или файл.",
      careerStrategy: "Добавь карьерную стратегию кандидата.",
      vacancyText: "Добавь текст вакансии или файл.",
    });
  });

  it("accepts files instead of text", () => {
    expect(
      validateMatchDraft({
        resumeText: "",
        resumeFile: new File(["resume"], "resume.pdf", { type: "application/pdf" }),
        careerStrategy: "Senior backend role in Germany",
        redFlags: "",
        vacancyText: "",
        vacancyFile: new File(["vacancy"], "vacancy.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        locale: "ru",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      }),
    ).toEqual({});
  });

  it("accepts non-empty resume and vacancy text", () => {
    expect(
      validateMatchDraft({
        resumeText: "Python FastAPI",
        careerStrategy: "Backend role",
        redFlags: "no startups",
        vacancyText: "Backend Python",
        locale: "ru",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      }),
    ).toEqual({});
  });

  it("requires manual prompt for test manual input mode", () => {
    expect(
      validateMatchDraft({
        resumeText: "Python FastAPI",
        careerStrategy: "Backend role",
        redFlags: "",
        vacancyText: "Backend Python",
        locale: "ru",
        runMode: "test",
        promptMode: "manual",
        manualPrompt: "",
      }),
    ).toEqual({
      manualPrompt: "Для ручного тестового промта нужен prompt из test_data.",
    });
  });
});

describe("toMatchRequest", () => {
  it("creates FormData for the backend contract", () => {
    const request = toMatchRequest({
      resumeText: "  Python developer  ",
      careerStrategy: "  Senior backend in Germany  ",
      redFlags: "  startups, Canada  ",
      vacancyText: "  FastAPI role  ",
      locale: "en",
      runMode: "test",
      promptMode: "template",
      manualPrompt: "  Manual prompt  ",
    });

    expect(request.get("resume_text")).toBe("Python developer");
    expect(request.get("career_strategy")).toBe("Senior backend in Germany");
    expect(request.get("red_flags")).toBe("startups, Canada");
    expect(request.get("vacancy_text")).toBe("FastAPI role");
    expect(request.get("locale")).toBe("en");
    expect(request.get("run_mode")).toBe("test");
    expect(request.get("prompt_mode")).toBe("template");
    expect(request.get("provaider")).toBe("openai");
    expect(request.get("openai_model")).toBe("gpt-5-mini");
    expect(request.get("source_metadata")).toBe(JSON.stringify({ source: "manual" }));
    expect(request.get("manual_prompt")).toBe(null);
  });

  it("sends manual prompt only for test manual mode", () => {
    const request = toMatchRequest({
      resumeText: "Python developer",
      careerStrategy: "Senior backend",
      redFlags: "",
      vacancyText: "FastAPI role",
      locale: "ru",
      runMode: "test",
      promptMode: "manual",
      manualPrompt: "  Manual prompt  ",
    });

    expect(request.get("prompt_mode")).toBe("manual");
    expect(request.get("manual_prompt")).toBe("Manual prompt");
  });

  it("passes every configured model value to the backend as openai_model", () => {
    for (const option of openAiModelOptions) {
      const request = toMatchRequest({
        resumeText: "Python developer",
        careerStrategy: "Senior backend",
        redFlags: "",
        vacancyText: "FastAPI role",
        openaiModel: option.value,
        locale: "ru",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      });

      expect(request.get("openai_model")).toBe(option.value);
    }
  });
});

describe("createMockMatchResult", () => {
  it("returns apply recommendation when resume and vacancy have overlapping terms", () => {
    const result = createMockMatchResult({
      resumeText: "Python FastAPI PostgreSQL backend API Docker",
      careerStrategy: "Backend role",
      redFlags: "",
      vacancyText: "Need Python FastAPI PostgreSQL backend Docker API",
      locale: "ru",
      runMode: "normal",
      promptMode: "template",
      manualPrompt: "",
    });

    expect(result.recommendation).toBe("apply");
    expect(result.match_score).toBeGreaterThanOrEqual(80);
    expect(result.matched_requirements.map((item) => item.requirement)).toContain("python");
  });

  it("returns gaps for terms missing from the resume", () => {
    const result = createMockMatchResult({
      resumeText: "React TypeScript frontend",
      careerStrategy: "Frontend role",
      redFlags: "",
      vacancyText: "Python SQL backend",
      locale: "ru",
      runMode: "normal",
      promptMode: "template",
      manualPrompt: "",
    });

    expect(result.recommendation).toBe("reject");
    expect(result.missing_or_unclear_requirements.map((item) => item.requirement)).toEqual([
      "backend",
      "python",
      "sql",
    ]);
  });
});

describe("requestMatch", () => {
  it("uses mock mode without calling fetch", async () => {
    const fetcher = vi.fn();

    const result = await requestMatch(
      {
        resumeText: "Python FastAPI",
        careerStrategy: "Backend role",
        redFlags: "",
        vacancyText: "Python API",
        locale: "ru",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      },
      { mode: "mock", fetcher },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.match_id).toBe(0);
  });

  it("posts the backend request shape in api mode and reads target response", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        match_id: 1,
        match_score: 75,
        recommendation: "manual_review",
        confidence: "high",
        summary: "Есть базовое совпадение.",
        matched_requirements: [
          {
            requirement: "python",
            evidence: "Python указан в CV.",
            explanation: "Совпадает с обязательным требованием.",
          },
        ],
        missing_or_unclear_requirements: ["sql"],
        red_flags: [
          {
            flag: "crypto",
            severity: "high",
            evidence: "Вакансия в crypto domain.",
            explanation: "Crypto указан в red flags.",
          },
        ],
        score_breakdown: {
          base_match_score: 85,
          red_flags_modifier: -10,
          freshness_modifier: 0,
          final_score: 75,
        },
      }),
    });

    const result = await requestMatch(
      {
        resumeText: " Python ",
        careerStrategy: " Backend role ",
        redFlags: "  crypto  ",
        vacancyText: " Python SQL ",
        openaiModel: "gpt-5.5",
        locale: "de",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      },
      { mode: "api", fetcher },
    );

    const [, init] = fetcher.mock.calls[0];
    const body = init.body as FormData;

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/check_match", {
      method: "POST",
      body,
    });
    expect(body.get("resume_text")).toBe("Python");
    expect(body.get("career_strategy")).toBe("Backend role");
    expect(body.get("red_flags")).toBe("crypto");
    expect(body.get("vacancy_text")).toBe("Python SQL");
    expect(body.get("locale")).toBe("de");
    expect(body.get("run_mode")).toBe("normal");
    expect(body.get("prompt_mode")).toBe("template");
    expect(body.get("provaider")).toBe("openai");
    expect(body.get("openai_model")).toBe("gpt-5.5");
    expect(body.get("source_metadata")).toBe(JSON.stringify({ source: "manual" }));
    expect(body.get("manual_prompt")).toBe(null);
    expect(result.match_score).toBe(75);
    expect(result.recommendation).toBe("manual_review");
    expect(result.confidence).toBe("high");
    expect(result.matched_requirements[0]).toEqual({
      requirement: "python",
      evidence: "Python указан в CV.",
      explanation: "Совпадает с обязательным требованием.",
    });
    expect(result.missing_or_unclear_requirements[0]?.requirement).toBe("sql");
    expect(result.red_flags[0]?.severity).toBe("high");
    expect(result.score_breakdown.final_score).toBe(75);
  });

  it("throws a readable error when api mode receives a failed response", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Match calculation failed" }),
    });

    await expect(
      requestMatch(
        {
          resumeText: "Python",
          careerStrategy: "Backend role",
          redFlags: "",
          vacancyText: "SQL",
          locale: "ru",
          runMode: "normal",
          promptMode: "template",
          manualPrompt: "",
        },
        { mode: "api", fetcher },
      ),
    ).rejects.toThrow("Match calculation failed");
  });

  it("normalizes legacy backend response fields before rendering", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        match_id: 1,
        score: 77,
        verdict: "strong",
        summary: null,
        strengths: null,
        gaps: null,
        next_steps: null,
      }),
    });

    const result = await requestMatch(
      {
        resumeText: "Python",
        careerStrategy: "Backend role",
        redFlags: "",
        vacancyText: "FastAPI",
        locale: "ru",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      },
      { mode: "api", fetcher },
    );

    expect(result).toEqual({
      match_id: 1,
      match_score: 77,
      recommendation: "apply",
      confidence: "medium",
      summary: "",
      matched_requirements: [],
      missing_or_unclear_requirements: [],
      red_flags: [],
      score_breakdown: {
        base_match_score: 77,
        red_flags_modifier: 0,
        freshness_modifier: 0,
        final_score: 77,
      },
    });
  });
});
