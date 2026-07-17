import { describe, expect, it, vi } from "vitest";

import {
  createAutoVacancySearchDraft,
  createMockAutoVacancySearchDetail,
  fetchAutoVacancySearch,
  listAutoVacancySearches,
  loadMoreAutoVacancySearch,
  mergeAutoVacancySearchMoreResponse,
  runAutoVacancySearch,
  toAutoVacancySearchRunRequest,
  validateAutoVacancySearchRunDraft,
} from "./autoMatch";

describe("validateAutoVacancySearchRunDraft", () => {
  it("requires CV input and career strategy before running a search", () => {
    expect(
      validateAutoVacancySearchRunDraft({
        resumeText: " ",
        careerStrategy: "",
        redFlags: "",
        source: "linkedin",
        vacancyLimit: 3,
        locale: "ru",
      }),
    ).toEqual({
      resumeText: "Добавь текст резюме или файл.",
      careerStrategy: "Добавь карьерную стратегию кандидата.",
    });
  });

  it("accepts a file instead of resume text", () => {
    expect(
      validateAutoVacancySearchRunDraft({
        resumeText: "",
        resumeFile: new File(["resume"], "resume.pdf", { type: "application/pdf" }),
        careerStrategy: "Senior backend in Germany",
        redFlags: "",
        source: "linkedin",
        vacancyLimit: 3,
        locale: "ru",
      }),
    ).toEqual({});
  });
});

describe("toAutoVacancySearchRunRequest", () => {
  it("creates FormData for the first match run with search_id and without backend-owned exclusion state", () => {
    const request = toAutoVacancySearchRunRequest("search_1", {
      resumeText: "  Python backend  ",
      careerStrategy: "  Germany, relocation  ",
      redFlags: "  crypto  ",
      source: "linkedin",
      vacancyLimit: 5,
      locale: "en",
      openaiModel: "gpt-5.5",
    });

    expect(request.get("search_id")).toBe("search_1");
    expect(request.get("resume_text")).toBe("Python backend");
    expect(request.get("career_strategy")).toBe("Germany, relocation");
    expect(request.get("red_flags")).toBe("crypto");
    expect(request.get("source")).toBe("linkedin");
    expect(request.get("vacancy_limit")).toBe("5");
    expect(request.get("locale")).toBe("en");
    expect(request.get("openai_model")).toBe("gpt-5.5");
    expect(request.get("provaider")).toBe("openai");
    expect(request.get("source_metadata")).toBe("linkedin");
    expect(request.has("name")).toBe(false);
    expect(request.has("jobs_to_not_include")).toBe(false);
  });
});

describe("listAutoVacancySearches", () => {
  it("gets saved search projects from the backend endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        searches: [
          {
            search_id: "search_1",
            name: "Berlin backend",
            created_at: "2026-07-06T10:00:00Z",
            results_count: 10,
          },
        ],
      }),
    });

    const response = await listAutoVacancySearches({ mode: "api", fetcher });

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/auto_vacancy_searches", {
      method: "GET",
    });
    expect(response.searches[0]?.name).toBe("Berlin backend");
    expect(response.searches[0]?.results_count).toBe(10);
    expect(response.searches[0]?.created_at).toBe("2026-07-06T10:00:00Z");
  });
});

describe("createAutoVacancySearchDraft", () => {
  it("posts only the search name JSON to create a search project", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        search_id: "search_draft_1",
        name: "Berlin backend",
        results_count: 0,
        created_at: "2026-07-06T10:00:00Z",
      }),
    });

    const response = await createAutoVacancySearchDraft({ name: " Berlin backend " }, { mode: "api", fetcher });

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/auto_vacancy_searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Berlin backend" }),
    });
    expect(response.search_id).toBe("search_draft_1");
    expect(response.vacancy_limit).toBe(3);
    expect(response.results).toEqual([]);
  });
});

describe("fetchAutoVacancySearch", () => {
  it("loads a saved search detail and normalizes top-level inputs and result rows", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        search_id: "search_1",
        name: "Berlin backend",
        source: "linkedin",
        status: "completed",
        resume: "Python FastAPI",
        career_strategy: "Senior backend in Germany",
        red_flags: "no crypto",
        vacancy_limit: 5,
        locale: "ru",
        llm_meta: {
          assumptions: [],
          confidence: "high",
          missing_inputs: [],
          negative_preferences: [],
        },
        results: [
          {
            vacancy_id: "vacancy_1",
            provider_job_id: "provider_1",
            title: "Backend Engineer",
            company: "Example GmbH",
            source: "linkedin",
            source_url: "https://www.linkedin.com/jobs/view/1",
            location: "Berlin",
            match_score: 84,
            recommendation: "apply",
            confidence: "high",
            summary: "Good backend fit.",
            key_reasons: ["Python", "FastAPI"],
            matched_requirements: ["Python"],
            missing_or_unclear_requirements: [],
            red_flags: [],
            score_breakdown: {
              base_match_score: 84,
              red_flags_modifier: 0,
              freshness_modifier: 0,
              final_score: 84,
            },
          },
        ],
      }),
    });

    const response = await fetchAutoVacancySearch("search_1", { mode: "api", fetcher });

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/auto_vacancy_searches/search_1", {
      method: "GET",
    });
    expect(response.vacancy_limit).toBe(5);
    expect(response.resume).toBe("Python FastAPI");
    expect(response.career_strategy).toBe("Senior backend in Germany");
    expect(response.results[0]?.provider_job_id).toBe("provider_1");
    expect(response.results[0]?.matched_requirements[0]?.requirement).toBe("Python");
  });

  it("normalizes resume aliases from saved search detail payloads", async () => {
    const cases = [
      { payload: { resume_text: "Top-level resume text alias" }, expected: "Top-level resume text alias" },
      { payload: { inputs: { resume: "Nested resume alias" } }, expected: "Nested resume alias" },
      { payload: { inputs: { resume_text: "Nested resume text alias" } }, expected: "Nested resume text alias" },
    ];

    for (const { expected, payload } of cases) {
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          search_id: "search_aliases",
          name: "Alias search",
          career_strategy: "Saved strategy alias",
          red_flags: "Saved red flags alias",
          vacancy_limit: 3,
          locale: "en",
          results: [],
          ...payload,
        }),
      });

      const response = await fetchAutoVacancySearch("search_aliases", { mode: "api", fetcher });

      expect(response.resume).toBe(expected);
      expect(response.career_strategy).toBe("Saved strategy alias");
      expect(response.red_flags).toBe("Saved red flags alias");
      expect(response.vacancy_limit).toBe(3);
      expect(response.locale).toBe("en");
    }
  });
});

describe("runAutoVacancySearch", () => {
  it("uses mock mode without calling fetch", async () => {
    const fetcher = vi.fn();

    const response = await runAutoVacancySearch(
      "mock_auto_vacancy_search",
      {
        resumeText: "Python FastAPI",
        careerStrategy: "Backend role",
        redFlags: "",
        source: "linkedin",
        vacancyLimit: 3,
        locale: "ru",
      },
      { mode: "mock", fetcher },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.resume).toBe("Python FastAPI");
  });

  it("posts FormData to the legacy first-run matching endpoint with search_id", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        createMockAutoVacancySearchDetail({
          name: "API search",
          searchId: "search_1",
          hasResults: true,
        }),
    });

    const response = await runAutoVacancySearch(
      "search_1",
      {
        resumeText: " Python ",
        careerStrategy: " Backend role ",
        redFlags: "",
        source: "linkedin",
        vacancyLimit: 5,
        locale: "ru",
      },
      { mode: "api", fetcher },
    );

    const [, init] = fetcher.mock.calls[0];
    const body = init.body as FormData;

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/auto_vacancy_matches", {
      method: "POST",
      body,
    });
    expect(body.get("search_id")).toBe("search_1");
    expect(body.get("resume_text")).toBe("Python");
    expect(body.get("source")).toBe("linkedin");
    expect(body.get("vacancy_limit")).toBe("5");
    expect(body.get("provaider")).toBe("openai");
    expect(body.get("source_metadata")).toBe("linkedin");
    expect(body.has("name")).toBe(false);
    expect(body.has("jobs_to_not_include")).toBe(false);
    expect(response.search_id).toBe("search_1");
  });
});

describe("loadMoreAutoVacancySearch", () => {
  it("continues a search without sending frontend-owned exclusion state", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        search_id: "search_1",
        added_results: [
          {
            vacancy_id: "vacancy_2",
            provider_job_id: "provider_2",
            title: "API Platform Developer",
            company: "Northstar Systems",
            source: "linkedin",
            source_url: "https://www.linkedin.com/jobs/view/2",
            location: "Remote EU",
            match_score: 78,
            recommendation: "manual_review",
            confidence: "medium",
            summary: "Partial backend fit.",
            key_reasons: ["APIs"],
            matched_requirements: [],
            missing_or_unclear_requirements: [],
            red_flags: [],
            score_breakdown: {},
          },
        ],
        results_count: 20,
      }),
    });

    const response = await loadMoreAutoVacancySearch("search_1", 5, { mode: "api", fetcher });

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/auto_vacancy_searches/search_1/more", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vacancy_limit: 5 }),
    });
    expect("added_results" in response ? response.added_results[0]?.vacancy_id : "").toBe("vacancy_2");
  });

  it("prepends added results into the current detail", () => {
    const current = createMockAutoVacancySearchDetail({ name: "Current", hasResults: true });
    const merged = mergeAutoVacancySearchMoreResponse(current, {
      search_id: current.search_id,
      added_results: [
        {
          ...current.results[0],
          vacancy_id: "vacancy_added",
          provider_job_id: "provider_added",
          title: "Added vacancy",
        },
      ],
      results_count: current.results.length + 1,
    });

    expect(merged.results.at(0)?.vacancy_id).toBe("vacancy_added");
    expect(merged.results_count).toBe(current.results.length + 1);
  });
});
