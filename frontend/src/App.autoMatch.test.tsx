// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const autoMatchMocks = vi.hoisted(() => ({
  createAutoVacancySearchDraft: vi.fn(),
  fetchAutoVacancySearch: vi.fn(),
  listAutoVacancySearches: vi.fn(),
  loadMoreAutoVacancySearch: vi.fn(),
  mergeAutoVacancySearchMoreResponse: vi.fn(),
  runAutoVacancySearch: vi.fn(),
  validateAutoVacancySearchRunDraft: vi.fn(),
}));

vi.mock("./env", () => ({
  apiBaseUrl: "http://localhost:8000",
  matchApiMode: "mock",
  normalizeApiBaseUrl: (value: string | undefined) => value?.trim() || "http://localhost:8000",
  normalizeMatchApiMode: (value: string | undefined) => (value === "api" ? "api" : "mock"),
}));

vi.mock("./api/autoMatch", () => autoMatchMocks);

vi.mock("./api/health", () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: "ok", environment: "test" }),
}));

vi.mock("./api/appLog", () => ({
  writeAppLogEntry: vi.fn().mockResolvedValue(undefined),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  autoMatchMocks.listAutoVacancySearches.mockResolvedValue({ searches: [] });
  autoMatchMocks.createAutoVacancySearchDraft.mockImplementation(async (draft) =>
    createSearchDetail({
      searchId: "created_draft",
      name: draft.name,
      results: [],
    }),
  );
  autoMatchMocks.fetchAutoVacancySearch.mockImplementation(async (searchId) => {
    if (searchId === "draft_1") {
      return createSearchDetail({
        searchId,
        name: "Draft project",
        careerStrategy: "Saved strategy",
        redFlags: "Saved red flags",
        results: [],
      });
    }

    if (searchId === "completed_1") {
      return createSearchDetail({
        searchId,
        name: "Completed project",
        resume: `Python backend developer
FastAPI and PostgreSQL
Docker and production support
Cloud integrations`,
        results: [baseVacancy],
      });
    }

    return createSearchDetail({
      searchId,
      name: "Created project",
      results: [],
    });
  });
  autoMatchMocks.runAutoVacancySearch.mockImplementation(async (searchId, draft) =>
    createSearchDetail({
      searchId,
      name: "Backend Germany",
      resume: draft.resumeText,
      careerStrategy: draft.careerStrategy,
      redFlags: draft.redFlags,
      results: [baseVacancy],
    }),
  );
  autoMatchMocks.loadMoreAutoVacancySearch.mockResolvedValue({
    search_id: "completed_1",
    added_results: [addedVacancy],
    results_count: 2,
  });
  autoMatchMocks.mergeAutoVacancySearchMoreResponse.mockImplementation((current, response) => {
    if ("added_results" in response) {
      return {
        ...current,
        results: [...current.results, ...response.added_results],
        results_count: response.results_count,
      };
    }

    return response;
  });
  autoMatchMocks.validateAutoVacancySearchRunDraft.mockImplementation((draft) => {
    const errors: Record<string, string> = {};

    if (!draft.resumeText.trim() && !draft.resumeFile) {
      errors.resumeText = "Добавь текст резюме или файл.";
    }

    if (!draft.careerStrategy.trim()) {
      errors.careerStrategy = "Добавь карьерную стратегию кандидата.";
    }

    return errors;
  });
});

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }

  vi.clearAllMocks();
});

describe("App auto vacancy search projects", () => {
  it("shows project entry state without auto form fields initially", async () => {
    const { container } = renderApp();

    await waitForText(container, "Нет сохраненных проектов поиска.");

    expect(container.textContent).toContain("Проекты поиска");
    expect(container.textContent).toContain("Нет сохраненных проектов поиска.");
    expect(container.querySelector("#autoResumeText")).toBeNull();
    expect(container.querySelector("#autoCareerStrategy")).toBeNull();
    expect(container.querySelector("#autoRedFlags")).toBeNull();
  });

  it("collapses long saved project lists and can expand them", async () => {
    autoMatchMocks.listAutoVacancySearches.mockResolvedValue({
      searches: Array.from({ length: 6 }, (_, index) => ({
        search_id: `search_${index + 1}`,
        name: `Project ${index + 1}`,
        created_at: "2026-07-14T10:00:00Z",
        results_count: index,
      })),
    });
    const { container } = renderApp();

    await clickButton(container, "Auto");
    await waitForText(container, "Project 6");

    const listRegion = container.querySelector('[aria-label="Список проектов поиска"]');
    expect(listRegion).toBeInstanceOf(HTMLElement);
    expect(listRegion?.className).toContain("max-h-[314px]");
    expect(container.textContent).toContain("Показать больше");

    await clickButton(container, "Показать больше");

    expect(listRegion?.className).not.toContain("max-h-[314px]");
    expect(container.textContent).toContain("Свернуть");
  });

  it("creates a draft project before revealing the run form", async () => {
    const { container } = renderApp();

    await clickButton(container, "Auto");
    await clickButton(container, "Создать новый проект поиска");

    expect(container.querySelector("#autoSearchNamePrompt")).toBeInstanceOf(HTMLInputElement);
    expect(container.querySelector("#autoResumeText")).toBeNull();

    await clickButton(container, "Продолжить");
    expect(container.textContent).toContain("Добавь название поиска.");

    setInputValue(container, "autoSearchNamePrompt", "Backend Germany");
    await clickButton(container, "Продолжить");
    await waitForElement(container, "#autoResumeText");

    expect(autoMatchMocks.createAutoVacancySearchDraft).toHaveBeenCalledWith(
      { name: "Backend Germany" },
      { mode: "mock" },
    );
    expect(container.querySelector("#autoSearchName")).toBeNull();
    expect(container.querySelector("#autoResumeText")).toBeInstanceOf(HTMLTextAreaElement);
    expect(container.querySelector("#autoCareerStrategy")).toBeInstanceOf(HTMLTextAreaElement);
    expect(container.querySelector("#autoRedFlags")).toBeInstanceOf(HTMLInputElement);
    expect(getButton(container, "GPT-5 mini").disabled).toBe(false);
    expect(getButton(container, "GPT-5.4 mini").disabled).toBe(true);
    expect(getButton(container, "GPT-5.5").disabled).toBe(true);

    const careerStrategy = container.querySelector("#autoCareerStrategy");
    expect(careerStrategy).toBeInstanceOf(HTMLTextAreaElement);
    expect((careerStrategy as HTMLTextAreaElement).placeholder).toContain(
      "Manual QA Engineer, fintech, удалённо, contractor/B2B ok",
    );
    expect((careerStrategy as HTMLTextAreaElement).placeholder).toContain("ИП/самозанятый/contractor/B2B");
    expect((careerStrategy as HTMLTextAreaElement).placeholder).not.toMatch(/\r|\n/);
    expect((careerStrategy as HTMLTextAreaElement).className).toContain("min-h-52");
    const help = container.querySelector('[aria-label="Подсказка Career strategy"]');
    expect(help).toBeInstanceOf(HTMLElement);
    expect(help?.getAttribute("title")).toContain("Роль: 2–4 слова");
    expect(help?.getAttribute("title")).toContain("«только Германия» ограничит поиск Германией");
    expect(help?.getAttribute("title")).toContain("Для remote укажи регион, например Europe");
    expect(help?.getAttribute("title")).toContain("Entry level, Associate или Mid-Senior level сужает поиск");
    expect(help?.getAttribute("title")).toContain("определяется по CV только для расчёта матча");
    expect(help?.getAttribute("title")?.length).toBeLessThan(400);
    expect(container.textContent).toContain(
      "Поиск пока запускается с фиксированными настройками: вакансии за Past week, узкий поиск по ключам включён, хороший match считается от 79 баллов.",
    );

    const limitSelect = getSelectByLabel(container, "Количество вакансий");
    expect(Array.from(limitSelect.options).map((option) => option.value)).toEqual(["3", "5"]);
    expect(limitSelect.value).toBe("3");
  });

  it("runs an existing draft search, shows results, expands rows and loads more", async () => {
    const { container } = renderApp();

    await clickButton(container, "Auto");
    await clickButton(container, "Создать новый проект поиска");
    setInputValue(container, "autoSearchNamePrompt", "Backend Germany");
    await clickButton(container, "Продолжить");
    await waitForElement(container, "#autoResumeText");

    setTextareaValue(container, "autoResumeText", "Python FastAPI PostgreSQL Docker API");
    setTextareaValue(container, "autoCareerStrategy", "Senior backend in Germany");
    setInputValue(container, "autoRedFlags", "no crypto");

    const sourceSelect = getSelectByLabel(container, "Источник");
    expect(sourceSelect.value).toBe("linkedin");

    await clickButton(container, "Start search");
    await waitForText(container, "Python Backend Engineer");

    expect(autoMatchMocks.runAutoVacancySearch).toHaveBeenCalledWith(
      "created_draft",
      expect.objectContaining({
        resumeText: "Python FastAPI PostgreSQL Docker API",
        careerStrategy: "Senior backend in Germany",
        redFlags: "no crypto",
        source: "linkedin",
        vacancyLimit: 3,
        openaiModel: "gpt-5-mini",
      }),
      { mode: "mock" },
    );
    expect(container.textContent).toContain("Linkedin");
    expect(container.textContent).toContain("Key reasons");
    await waitForElement(container, '[aria-label="Детали выбранной вакансии"]');
    await waitForElement(container, '[aria-label="Детали вакансии в строке Python Backend Engineer"]');
    expect(container.querySelector('[aria-label="Детали выбранной вакансии"]')).toBeInstanceOf(HTMLElement);
    expect(
      container.querySelector('[aria-label="Детали вакансии в строке Python Backend Engineer"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(container.textContent).toContain("Детали вакансии");
    expect(container.textContent).toContain("Score breakdown");
    expect(container.textContent).toContain("84 / apply");

    await clickButton(container, "Открыть детали Python Backend Engineer");

    expect(container.textContent).toContain("84 / apply");

    await clickButton(container, "Load more");
    await waitForText(container, "API Platform Developer");

    await clickButton(container, "Открыть детали API Platform Developer");

    expect(container.textContent).toContain("78 / manual_review");

    expect(autoMatchMocks.loadMoreAutoVacancySearch).toHaveBeenCalledWith("created_draft", 3, {
      mode: "mock",
    });
  });

  it("selects an existing empty project and shows the run form without loading details", async () => {
    autoMatchMocks.listAutoVacancySearches.mockResolvedValue({
      searches: [
        {
          search_id: "draft_1",
          name: "Draft project",
          created_at: "2026-07-06T10:00:00Z",
          results_count: 0,
        },
      ],
    });
    const { container } = renderApp();

    await clickButton(container, "Auto");
    await clickButtonContaining(container, "Draft project");
    await waitForElement(container, "#autoResumeText");

    expect(autoMatchMocks.fetchAutoVacancySearch).not.toHaveBeenCalled();
    expect(container.querySelector("#autoResumeText")).toBeInstanceOf(HTMLTextAreaElement);
    expect(container.textContent).toContain("Draft project");
    expect(container.textContent).not.toContain("Python Backend Engineer");
  });

  it("selects an existing completed project and shows results without the run form", async () => {
    autoMatchMocks.listAutoVacancySearches.mockResolvedValue({
      searches: [
        {
          search_id: "completed_1",
          name: "Completed project",
          created_at: "2026-07-06T10:00:00Z",
          results_count: 1,
        },
      ],
    });
    const { container } = renderApp();

    await clickButton(container, "Auto");
    await clickButtonContaining(container, "Completed project");
    await waitForText(container, "Python Backend Engineer");

    expect(autoMatchMocks.fetchAutoVacancySearch).toHaveBeenCalledWith("completed_1", {
      mode: "mock",
    });
    expect(container.querySelector("#autoResumeText")).toBeNull();
    expect(container.textContent).toContain("Key reasons");
    expect(container.textContent?.match(/Key reasons/g) ?? []).toHaveLength(1);
    expect(container.textContent).toContain("CV");
    expect(container.textContent).toContain("Python backend developer");
    expect(container.textContent).not.toContain("Cloud integrations");

    await clickButton(container, "Показать CV полностью");

    expect(container.textContent).toContain("Cloud integrations");

    await clickButton(container, "Скрыть CV");

    expect(container.textContent).not.toContain("Cloud integrations");
  });

  it("validates required CV and career strategy only after a draft form is open", async () => {
    const { container } = renderApp();

    await clickButton(container, "Auto");
    await clickButton(container, "Создать новый проект поиска");
    setInputValue(container, "autoSearchNamePrompt", "Validation search");
    await clickButton(container, "Продолжить");
    await waitForElement(container, "#autoResumeText");
    await clickButton(container, "Start search");

    expect(container.textContent).toContain("Добавь текст резюме или файл.");
    expect(container.textContent).toContain("Добавь карьерную стратегию кандидата.");
    expect(autoMatchMocks.runAutoVacancySearch).not.toHaveBeenCalled();
  });
});

const baseVacancy = {
  vacancy_id: "vacancy_1",
  provider_job_id: "provider_1",
  title: "Python Backend Engineer",
  company: "Example Cloud GmbH",
  source: "linkedin",
  source_url: "https://www.linkedin.com/jobs/view/mock-linkedin-1",
  location: "Berlin, Germany",
  match_score: 84,
  recommendation: "apply",
  confidence: "high",
  summary: "Good backend fit.",
  key_reasons: ["Python", "FastAPI"],
  matched_requirements: [{ requirement: "Python", evidence: "", explanation: "" }],
  missing_or_unclear_requirements: [],
  red_flags: [],
  score_breakdown: {
    base_match_score: 84,
    red_flags_modifier: 0,
    freshness_modifier: 0,
    final_score: 84,
  },
};

const addedVacancy = {
  ...baseVacancy,
  vacancy_id: "vacancy_2",
  provider_job_id: "provider_2",
  title: "API Platform Developer",
  company: "Northstar Systems",
  match_score: 78,
  recommendation: "manual_review",
  confidence: "medium",
  score_breakdown: {
    base_match_score: 78,
    red_flags_modifier: 0,
    freshness_modifier: 0,
    final_score: 78,
  },
};

function createSearchDetail({
  careerStrategy = "",
  name,
  redFlags = "",
  resume = "",
  results,
  searchId,
}: {
  careerStrategy?: string;
  name: string;
  redFlags?: string;
  resume?: string;
  results: typeof baseVacancy[];
  searchId: string;
}) {
  return {
    search_id: searchId,
    name,
    resume,
    career_strategy: careerStrategy,
    red_flags: redFlags,
    vacancy_limit: 3,
    locale: "ru",
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

function renderApp() {
  const container = document.createElement("div");
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  document.body.append(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
  });

  return { container };
}

async function clickButton(container: HTMLElement, name: string) {
  const button = getButton(container, name);

  await act(async () => {
    button.click();
  });

  await flushAsync();
}

function getButton(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`);
  }

  return button;
}

async function clickButtonContaining(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button containing text not found: ${text}`);
  }

  await act(async () => {
    button.click();
  });

  await flushAsync();
}

function setTextareaValue(container: HTMLElement, id: string, value: string) {
  const textarea = container.querySelector(`#${id}`);

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Textarea not found: ${id}`);
  }

  act(() => {
    setNativeValue(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setInputValue(container: HTMLElement, id: string, value: string) {
  const input = container.querySelector(`#${id}`);

  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Input not found: ${id}`);
  }

  act(() => {
    setNativeValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function getSelectByLabel(container: HTMLElement, labelText: string) {
  const label = Array.from(container.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const select = label?.querySelector("select");

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Select not found: ${labelText}`);
  }

  return select;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (!valueSetter) {
    throw new Error("Native value setter not found.");
  }

  valueSetter.call(element, value);
}

async function waitForElement(container: HTMLElement, selector: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.querySelector(selector)) {
      return;
    }

    await flushAsync();
  }

  throw new Error(`Element not found: ${selector}`);
}

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(text)) {
      return;
    }

    await flushAsync();
  }

  throw new Error(`Text not found: ${text}`);
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}
