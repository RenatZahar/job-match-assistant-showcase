import { describe, expect, it, vi } from "vitest";

import { createTestDataCase, loadTestDataCases, loadTestDataDraft } from "./testData";

describe("loadTestDataCases", () => {
  it("loads available test data cases", async () => {
    const cases = [{ name: "1", cvFile: "cv.docx", vacancyFile: "vacancy.docx" }];
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(cases));

    await expect(loadTestDataCases({ fetcher })).resolves.toEqual(cases);
    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/test_data/cases");
  });
});

describe("loadTestDataDraft", () => {
  it("loads anonymized texts from a selected backend test data case", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      Response.json({
        resumeText: "[CANDIDATE_NAME] Python",
        vacancyText: "Python vacancy",
        manualPrompt: "Manual prompt",
        redFlags: "english c1",
        careerStrategy: "Senior Java backend, Germany",
      }),
    );

    const draft = await loadTestDataDraft("1", { fetcher });

    expect(draft.resumeText).toBe("[CANDIDATE_NAME] Python");
    expect(draft.careerStrategy).toBe("Senior Java backend, Germany");
    expect(draft.redFlags).toBe("english c1");
    expect(draft.resumeFile).toBeUndefined();
    expect(draft.vacancyText).toBe("Python vacancy");
    expect(draft.vacancyFile).toBeUndefined();
    expect(draft.locale).toBe("ru");
    expect(draft.runMode).toBe("test");
    expect(draft.promptMode).toBe("template");
    expect(draft.manualPrompt).toBe("Manual prompt");
    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/test_data/cases/1");
  });

  it("keeps optional fields empty when a backend test data case omits them", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      Response.json({
        resumeText: "[CANDIDATE_NAME] Python",
        vacancyText: "Python vacancy",
      }),
    );

    const draft = await loadTestDataDraft("1", { fetcher });

    expect(draft.manualPrompt).toBe("");
    expect(draft.redFlags).toBe("");
    expect(draft.careerStrategy).toBe("");
  });

  it("throws a readable error when a test data file is missing", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 }));

    await expect(loadTestDataDraft("1", { fetcher })).rejects.toThrow(
      "Не удалось загрузить test_data/1: 404",
    );
  });
});

describe("createTestDataCase", () => {
  it("posts files and optional metadata to the dev test_data endpoint", async () => {
    const createdCase = {
      name: "2",
      cvFile: "cv.docx",
      vacancyFile: "vacancy.pdf",
      promptFile: "prompt.md",
      careerStrategyFile: "career_strategy.txt",
      redFlagsFile: "red_flags.txt",
    };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(createdCase));
    const cvFile = new File(["cv"], "candidate.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const vacancyFile = new File(["vacancy"], "role.pdf", { type: "application/pdf" });
    const promptFile = new File(["prompt"], "case.md", { type: "text/markdown" });

    const result = await createTestDataCase(
      {
        cvFile,
        vacancyFile,
        promptFile,
        careerStrategy: " Senior Java backend ",
        redFlags: " No German-only roles ",
      },
      { fetcher },
    );

    expect(result).toEqual(createdCase);
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/test_data/cases",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );

    const body = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("cv")).toBe(cvFile);
    expect(body.get("vacancy")).toBe(vacancyFile);
    expect(body.get("prompt")).toBe(promptFile);
    expect(body.get("career_strategy")).toBe("Senior Java backend");
    expect(body.get("red_flags")).toBe("No German-only roles");
  });

  it("requires cv and vacancy before sending a create request", async () => {
    const fetcher = vi.fn();

    await expect(
      createTestDataCase({
        careerStrategy: "",
        redFlags: "",
      }),
    ).rejects.toThrow("Добавь CV и вакансию для нового test_data набора.");

    expect(fetcher).not.toHaveBeenCalled();
  });
});
