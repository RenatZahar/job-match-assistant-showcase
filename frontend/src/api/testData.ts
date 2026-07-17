import { DEFAULT_OPENAI_MODEL, type MatchDraft } from "./match";
import { apiBaseUrl } from "../env";
import { fetchWithAuth } from "./auth";

type TestDataOptions = {
  fetcher?: typeof fetch;
};

export type TestDataCase = {
  name: string;
  cvFile?: string;
  vacancyFile?: string;
  promptFile?: string;
  redFlagsFile?: string;
  careerStrategyFile?: string;
};

export type CreateTestDataCaseDraft = {
  cvFile?: File;
  vacancyFile?: File;
  promptFile?: File;
  careerStrategy: string;
  redFlags: string;
};

export async function loadTestDataCases(options: TestDataOptions = {}): Promise<TestDataCase[]> {
  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}/test_data/cases`);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить список test_data: ${response.status}`);
  }

  return response.json() as Promise<TestDataCase[]>;
}

export async function createTestDataCase(
  draft: CreateTestDataCaseDraft,
  options: TestDataOptions = {},
): Promise<TestDataCase> {
  if (!draft.cvFile || !draft.vacancyFile) {
    throw new Error("Добавь CV и вакансию для нового test_data набора.");
  }

  const formData = new FormData();
  formData.append("cv", draft.cvFile);
  formData.append("vacancy", draft.vacancyFile);

  if (draft.promptFile) {
    formData.append("prompt", draft.promptFile);
  }

  const careerStrategy = draft.careerStrategy.trim();
  const redFlags = draft.redFlags.trim();

  if (careerStrategy) {
    formData.append("career_strategy", careerStrategy);
  }

  if (redFlags) {
    formData.append("red_flags", redFlags);
  }

  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}/test_data/cases`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Не удалось создать test_data набор: ${response.status}`);
  }

  return response.json() as Promise<TestDataCase>;
}

export async function loadTestDataDraft(caseName: string, options: TestDataOptions = {}): Promise<MatchDraft> {
  const fetcher = options.fetcher ?? fetchWithAuth;
  const response = await fetcher(`${apiBaseUrl}/test_data/cases/${encodeURIComponent(caseName)}`);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить test_data/${caseName}: ${response.status}`);
  }

  const testData = (await response.json()) as {
    resumeText?: string;
    vacancyText?: string;
    manualPrompt?: string;
    redFlags?: string;
    careerStrategy?: string;
  };

  return {
    resumeText: testData.resumeText ?? "",
    careerStrategy: testData.careerStrategy ?? "",
    redFlags: testData.redFlags ?? "",
    vacancyText: testData.vacancyText ?? "",
    openaiModel: DEFAULT_OPENAI_MODEL,
    locale: "ru",
    runMode: "test",
    promptMode: "template",
    manualPrompt: testData.manualPrompt ?? "",
  };
}
