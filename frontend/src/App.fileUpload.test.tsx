// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

vi.mock("./env", () => ({
  apiBaseUrl: "http://localhost:8000",
  matchApiMode: "mock",
  normalizeApiBaseUrl: (value: string | undefined) => value?.trim() || "http://localhost:8000",
  normalizeMatchApiMode: (value: string | undefined) => (value === "api" ? "api" : "mock"),
}));

vi.mock("./api/health", () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: "ok", environment: "test" }),
}));

vi.mock("./api/appLog", () => ({
  writeAppLogEntry: vi.fn().mockResolvedValue(undefined),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

describe("App file uploads", () => {
  it("keeps only GPT-5 mini selectable in the Match model selector", async () => {
    const { container } = renderApp();
    await openMatchTab(container);

    expect(getButtonByText(container, "GPT-5 mini").disabled).toBe(false);
    expect(getButtonByText(container, "GPT-5.4 mini").disabled).toBe(true);
    expect(getButtonByText(container, "GPT-5.5").disabled).toBe(true);
  });

  it("shows the current career strategy guidance in the Match form", async () => {
    const { container } = renderApp();
    await openMatchTab(container);

    const careerStrategy = getTextarea(container, "careerStrategy");
    const help = getControl(container, "Подсказка Career strategy");

    expect(careerStrategy.placeholder).toContain(
      "Manual QA Engineer, fintech, удалённо, contractor/B2B ok",
    );
    expect(careerStrategy.placeholder).toContain("ИП/самозанятый/contractor/B2B");
    expect(careerStrategy.placeholder).not.toMatch(/\r|\n/);
    expect(careerStrategy.className).toContain("min-h-52");
    expect(help.getAttribute("title")).toBe(careerStrategy.placeholder);
  });

  it("attaches CV through the file input and vacancy through the vacancy textarea", async () => {
    const { container } = renderApp();
    await openMatchTab(container);
    const resumeFile = new File(["resume"], "resume.pdf", { type: "application/pdf" });
    const vacancyFile = new File(["vacancy"], "vacancy.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await selectFile(container, "Прикрепить файл резюме", resumeFile);
    expect(container.textContent).toContain("Файл: resume.pdf");

    const vacancyTextarea = getTextarea(container, "vacancyText");
    const dragOverEvent = createFileDragEvent("dragover", vacancyFile);
    const dropEvent = createFileDragEvent("drop", vacancyFile);

    await act(async () => {
      vacancyTextarea.dispatchEvent(dragOverEvent);
      vacancyTextarea.dispatchEvent(dropEvent);
    });

    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(container.textContent).toContain("Файл: vacancy.docx");
  });

  it("attaches CV through the CV textarea and vacancy through the file input", async () => {
    const { container } = renderApp();
    await openMatchTab(container);
    const resumeFile = new File(["resume"], "cv.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const vacancyFile = new File(["vacancy"], "vacancy.pdf", { type: "application/pdf" });

    const resumeTextarea = getTextarea(container, "resumeText");
    const dragOverEvent = createFileDragEvent("dragover", resumeFile);
    const dropEvent = createFileDragEvent("drop", resumeFile);

    await act(async () => {
      resumeTextarea.dispatchEvent(dragOverEvent);
      resumeTextarea.dispatchEvent(dropEvent);
    });

    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(container.textContent).toContain("Файл: cv.docx");

    await selectFile(container, "Прикрепить файл вакансии", vacancyFile);
    expect(container.textContent).toContain("Файл: vacancy.pdf");
  });

  it("prevents browser file handling when a CV is dropped directly into the textarea", async () => {
    const { container } = renderApp();
    await openMatchTab(container);
    const resumeFile = new File(["resume"], "resume-direct.pdf", { type: "application/pdf" });
    const resumeTextarea = getTextarea(container, "resumeText");
    const dragEnterEvent = createFileDragEvent("dragenter", resumeFile);
    const dragOverEvent = createFileDragEvent("dragover", resumeFile);
    const dropEvent = createFileDragEvent("drop", resumeFile);

    await act(async () => {
      resumeTextarea.dispatchEvent(dragEnterEvent);
      resumeTextarea.dispatchEvent(dragOverEvent);
      resumeTextarea.dispatchEvent(dropEvent);
    });

    expect(dragEnterEvent.defaultPrevented).toBe(true);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(container.textContent).toContain("Файл: resume-direct.pdf");
  });

  it("does not attach a file when it is dropped outside the text input field", async () => {
    const { container } = renderApp();
    await openMatchTab(container);
    const resumeFile = new File(["resume"], "resume-outside.pdf", { type: "application/pdf" });
    const uploadButton = getControl(container, "Прикрепить файл резюме");
    const dragOverEvent = createFileDragEvent("dragover", resumeFile);
    const dropEvent = createFileDragEvent("drop", resumeFile);

    await act(async () => {
      uploadButton.dispatchEvent(dragOverEvent);
      uploadButton.dispatchEvent(dropEvent);
    });

    expect(dragOverEvent.defaultPrevented).toBe(false);
    expect(dropEvent.defaultPrevented).toBe(false);
    expect(container.textContent).not.toContain("Файл: resume-outside.pdf");
  });
});

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

async function openMatchTab(container: HTMLElement) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Match",
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Match tab button not found.");
  }

  await act(async () => {
    button.click();
  });
}

async function selectFile(container: HTMLElement, label: string, file: File) {
  const input = getControl(container, label) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function getControl(container: HTMLElement, label: string): HTMLElement {
  const control = container.querySelector(`[aria-label="${label}"]`);

  if (!(control instanceof HTMLElement)) {
    throw new Error(`Control not found: ${label}`);
  }

  return control;
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function getTextarea(container: HTMLElement, id: string): HTMLTextAreaElement {
  const textarea = container.querySelector(`#${id}`);

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Textarea not found: ${id}`);
  }

  return textarea;
}

function createFileDragEvent(type: "dragenter" | "dragover" | "drop", file: File): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [file],
      types: ["Files"],
    },
  });
  return event;
}
