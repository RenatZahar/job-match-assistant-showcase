import { describe, expect, it } from "vitest";

import { resumeInputHint, vacancyInputHint } from "./matchFormCopy";

describe("match form copy", () => {
  it("shows a resume example and keeps file upload guidance", () => {
    expect(resumeInputHint).toContain("Пример:");
    expect(resumeInputHint).toContain("Python backend developer");
    expect(resumeInputHint).toContain("Вставьте текст резюме");
    expect(resumeInputHint).toContain("перетащите файл");
    expect(resumeInputHint).toContain("PDF или DOCX");
    expect(resumeInputHint).not.toContain("DOC или DOCX");
  });

  it("shows a vacancy example and keeps file upload guidance", () => {
    expect(vacancyInputHint).toContain("Пример:");
    expect(vacancyInputHint).toContain("Python Backend Engineer");
    expect(vacancyInputHint).toContain("Вставьте текст вакансии");
    expect(vacancyInputHint).toContain("перетащите файл");
    expect(vacancyInputHint).toContain("PDF или DOCX");
    expect(vacancyInputHint).not.toContain("DOC или DOCX");
  });
});
