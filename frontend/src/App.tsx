import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileText,
  KeyRound,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import {
  createAutoVacancySearchDraft,
  fetchAutoVacancySearch,
  listAutoVacancySearches,
  loadMoreAutoVacancySearch,
  mergeAutoVacancySearchMoreResponse,
  runAutoVacancySearch,
  validateAutoVacancySearchRunDraft,
  type AutoMatchVacancyResult,
  type AutoVacancyLimit,
  type AutoVacancySearchDetail,
  type AutoVacancySearchListResponse,
  type AutoVacancySearchRunDraft,
  type AutoVacancySearchRunDraftErrors,
  type AutoVacancySearchSummary,
  type AutoVacancySource,
} from "./api/autoMatch";
import {
  fetchAdminFeedback,
  type AdminFeedbackSummary,
} from "./api/adminFeedback";
import { writeAppLogEntry, type AppLogEvent } from "./api/appLog";
import {
  authenticate,
  clearStoredAuthSession,
  readStoredAuthSession,
  type AuthSession,
} from "./api/auth";
import { fetchHealth } from "./api/health";
import { createFeedbackEntry, type FeedbackType } from "./api/feedback";
import {
  DEFAULT_OPENAI_MODEL,
  type MatchDraft,
  type MatchDraftErrors,
  type MatchResult,
  type OpenAiModel,
  type RedFlagItem,
  type RequirementItem,
  type ScoreBreakdown,
  openAiModelOptions,
  requestMatch,
  validateMatchDraft,
} from "./api/match";
import {
  createTestDataCase,
  loadTestDataCases,
  loadTestDataDraft,
  type CreateTestDataCaseDraft,
  type TestDataCase,
} from "./api/testData";
import { matchApiMode } from "./env";
import { resumeInputHint, vacancyInputHint } from "./matchFormCopy";

const initialDraft: MatchDraft = {
  resumeText: "",
  careerStrategy: "",
  redFlags: "",
  vacancyText: "",
  openaiModel: DEFAULT_OPENAI_MODEL,
  locale: "ru",
  runMode: "normal",
  promptMode: "template",
  manualPrompt: "",
};

const initialAutoDraft: AutoVacancySearchRunDraft = {
  resumeText: "",
  careerStrategy: "",
  redFlags: "",
  source: "linkedin",
  vacancyLimit: 3,
  openaiModel: DEFAULT_OPENAI_MODEL,
  locale: "ru",
};

const autoVacancyLimitOptions: AutoVacancyLimit[] = [3, 5];

const emptyCreateTestDataDraft: CreateTestDataCaseDraft = {
  careerStrategy: "",
  redFlags: "",
};

const DOCUMENT_FILE_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCUMENT_FILE_ERROR = "Можно прикрепить PDF или DOCX.";
const careerStrategyPlaceholder = [
  "Например: Manual QA Engineer, fintech, удалённо, contractor/B2B ok, Европа/UK timezones, английский B2, Middle.",
  "Укажите, готовы ли вы работать по договору как ИП/самозанятый/contractor/B2B, из какой страны или региона вы можете официально работать, и какие часовые пояса подходят.",
  "Можно добавить приоритеты с баллами: fintech:+10, remote:+8, UK timezone:+5.",
].join(" ");
const autoCareerStrategyHelp = [
  "Роль: 2–4 слова; технологии/домен — предпочтения.",
  "География: «только Германия» ограничит поиск Германией; «открыт к Европе» расширит. Для remote укажи регион, например Europe.",
  "Уровень: Entry level, Associate или Mid-Senior level сужает поиск. Если не указан, определяется по CV только для расчёта матча.",
  "Режим и занятость называй обязательными только если другие варианты неприемлемы.",
].join(" ");
const selectableOpenAiModel: OpenAiModel = DEFAULT_OPENAI_MODEL;
const autoRedFlagsHelp =
  "Укажи hard excludes и нежелательные условия: no crypto/gambling, no early-stage startups, no people management, salary minimum, no on-site. Не все red flags являются фильтрами Bright Data; часть применяется после поиска при scoring.";

type ActiveTab = "match" | "auto" | "test";
type AutoSearchComposerState = "idle" | "naming";

function isOpenAiModelSelectable(model: OpenAiModel): boolean {
  return model === selectableOpenAiModel;
}

function getSelectableOpenAiModel(model: OpenAiModel | undefined): OpenAiModel {
  return model && isOpenAiModelSelectable(model) ? model : selectableOpenAiModel;
}

function autoVacancySearchDetailQueryKey(searchId: string) {
  return ["auto-vacancy-search", searchId] as const;
}

export function App() {
  const queryClient = useQueryClient();
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readStoredAuthSession());
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("auto");
  const [draft, setDraft] = useState<MatchDraft>(initialDraft);
  const [errors, setErrors] = useState<MatchDraftErrors>({});
  const [autoDraft, setAutoDraft] = useState<AutoVacancySearchRunDraft>(initialAutoDraft);
  const [autoErrors, setAutoErrors] = useState<AutoVacancySearchRunDraftErrors>({});
  const [autoSearchComposerState, setAutoSearchComposerState] =
    useState<AutoSearchComposerState>("idle");
  const [autoSearchNameDraft, setAutoSearchNameDraft] = useState("");
  const [autoSearchNameError, setAutoSearchNameError] = useState<string | null>(null);
  const [selectedAutoSearchId, setSelectedAutoSearchId] = useState<string | null>(null);
  const [selectedAutoVacancyId, setSelectedAutoVacancyId] = useState<string | null>(null);
  const [testDataEnabled, setTestDataEnabled] = useState(false);
  const [testDataCases, setTestDataCases] = useState<TestDataCase[]>([]);
  const [selectedTestDataCase, setSelectedTestDataCase] = useState("");
  const [testDataError, setTestDataError] = useState<string | null>(null);
  const [createTestDataOpen, setCreateTestDataOpen] = useState(true);
  const [createTestDataDraft, setCreateTestDataDraft] =
    useState<CreateTestDataCaseDraft>(emptyCreateTestDataDraft);
  const [createTestDataError, setCreateTestDataError] = useState<string | null>(null);
  const [createTestDataStatus, setCreateTestDataStatus] = useState<string | null>(null);
  const [createTestDataPending, setCreateTestDataPending] = useState(false);
  const [createTestDataFormKey, setCreateTestDataFormKey] = useState(0);
  const [lastSubmittedDraft, setLastSubmittedDraft] = useState<MatchDraft>(initialDraft);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("other");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackExpected, setFeedbackExpected] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [adminFeedbackItems, setAdminFeedbackItems] = useState<AdminFeedbackSummary[]>([]);
  const [adminFeedbackCount, setAdminFeedbackCount] = useState<number | null>(null);
  const [adminFeedbackError, setAdminFeedbackError] = useState<string | null>(null);
  const [adminFeedbackPending, setAdminFeedbackPending] = useState(false);
  const [expandedFeedbackId, setExpandedFeedbackId] = useState<string | null>(null);
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });
  const autoSearchesQueryKey = [
    "auto-vacancy-searches",
    authSession?.username ?? "local",
    matchApiMode,
  ] as const;
  const autoSearchesQuery = useQuery({
    queryKey: autoSearchesQueryKey,
    queryFn: () => listAutoVacancySearches({ mode: matchApiMode }),
    enabled: matchApiMode !== "api" || Boolean(authSession),
    retry: false,
  });
  const selectedAutoSearchSummary = autoSearchesQuery.data?.searches.find(
    (search) => search.search_id === selectedAutoSearchId,
  );
  const shouldFetchSelectedAutoSearch =
    Boolean(selectedAutoSearchId) && (selectedAutoSearchSummary?.results_count ?? 1) > 0;
  const selectedAutoSearchQuery = useQuery({
    queryKey: autoVacancySearchDetailQueryKey(selectedAutoSearchId ?? ""),
    queryFn: () => fetchAutoVacancySearch(selectedAutoSearchId ?? "", { mode: matchApiMode }),
    enabled: shouldFetchSelectedAutoSearch,
    retry: false,
    staleTime: Infinity,
  });
  const matchMutation = useMutation({
    mutationFn: (input: MatchDraft) => requestMatch(input, { mode: matchApiMode }),
    onMutate: (input) => {
      writeSafeAppLog("match_started", input);
    },
    onSuccess: (data, input) => {
      writeSafeAppLog("match_succeeded", input, data);
    },
    onError: (error, input) => {
      writeSafeAppLog("match_failed", input, undefined, error);
    },
  });
  const createAutoSearchDraftMutation = useMutation({
    mutationFn: (input: { name: string }) =>
      createAutoVacancySearchDraft(input, { mode: matchApiMode }),
    onSuccess: (data) => {
      queryClient.setQueryData(autoVacancySearchDetailQueryKey(data.search_id), data);
      queryClient.setQueryData<AutoVacancySearchListResponse>(
        autoSearchesQueryKey,
        (current) => upsertAutoVacancySearchSummary(current, data),
      );
      if (matchApiMode === "api") {
        void queryClient.invalidateQueries({ queryKey: autoSearchesQueryKey });
      }
      setSelectedAutoSearchId(data.search_id);
      setSelectedAutoVacancyId(null);
      setAutoSearchComposerState("idle");
      setAutoDraft(createRunDraftFromSearch(data, draft));
      setAutoErrors({});
    },
  });
  const runAutoSearchMutation = useMutation({
    mutationFn: ({ draft: runDraft, search }: { draft: AutoVacancySearchRunDraft; search: AutoVacancySearchDetail }) =>
      runAutoVacancySearch(search.search_id, runDraft, { mode: matchApiMode }),
    onSuccess: (data) => {
      queryClient.setQueryData(autoVacancySearchDetailQueryKey(data.search_id), data);
      queryClient.setQueryData<AutoVacancySearchListResponse>(
        autoSearchesQueryKey,
        (current) => upsertAutoVacancySearchSummary(current, data),
      );
      if (matchApiMode === "api") {
        void queryClient.invalidateQueries({ queryKey: autoSearchesQueryKey });
      }
      setSelectedAutoSearchId(data.search_id);
      setSelectedAutoVacancyId(null);
    },
  });
  const loadMoreAutoSearchMutation = useMutation({
    mutationFn: (currentSearch: AutoVacancySearchDetail) =>
      loadMoreAutoVacancySearch(currentSearch.search_id, currentSearch.vacancy_limit, { mode: matchApiMode }),
    onSuccess: (data, currentSearch) => {
      const nextSearch = mergeAutoVacancySearchMoreResponse(currentSearch, data);
      queryClient.setQueryData(autoVacancySearchDetailQueryKey(nextSearch.search_id), nextSearch);
      queryClient.setQueryData<AutoVacancySearchListResponse>(
        autoSearchesQueryKey,
        (current) => upsertAutoVacancySearchSummary(current, nextSearch),
      );
      if (matchApiMode === "api") {
        void queryClient.invalidateQueries({ queryKey: autoSearchesQueryKey });
      }
      setSelectedAutoVacancyId((currentId) =>
        currentId && nextSearch.results.some((item) => item.vacancy_id === currentId)
          ? currentId
          : null,
      );
    },
  });

  const selectedAutoSearchFallback = useMemo(
    () =>
      selectedAutoSearchSummary
        ? createAutoSearchDetailFromSummary(selectedAutoSearchSummary, draft)
        : undefined,
    [draft.locale, selectedAutoSearchSummary],
  );
  const selectedAutoSearchDetail = selectedAutoSearchQuery.data ?? selectedAutoSearchFallback;

  useEffect(() => {
    if (!selectedAutoSearchDetail) {
      return;
    }

    setAutoDraft(createRunDraftFromSearch(selectedAutoSearchDetail, draft));
    setAutoErrors({});
    setSelectedAutoVacancyId((currentId) =>
      currentId && selectedAutoSearchDetail.results.some((item) => item.vacancy_id === currentId)
        ? currentId
        : null,
    );
  }, [draft.locale, draft.openaiModel, selectedAutoSearchDetail]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthPending(true);

    try {
      const session = await authenticate(authUsername, authPassword);
      setAuthSession(session);
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не удалось войти.");
    } finally {
      setAuthPending(false);
    }
  }

  function logout() {
    clearStoredAuthSession();
    setAuthSession(null);
    setAuthPassword("");
    setTestDataEnabled(false);
    setTestDataCases([]);
    setSelectedTestDataCase("");
    setSelectedAutoSearchId(null);
    setSelectedAutoVacancyId(null);
    setAutoSearchComposerState("idle");
  }

  function updateDraft(field: keyof MatchDraft, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
    setErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
  }

  function updateAutoDraft<K extends keyof AutoVacancySearchRunDraft>(
    field: K,
    value: AutoVacancySearchRunDraft[K],
  ) {
    setAutoDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
    setAutoErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
  }

  function updateMatchDocumentFile(
    fileField: "resumeFile" | "vacancyFile",
    errorField: "resumeText" | "vacancyText",
    files: FileList | File[] | null,
  ) {
    const file = findSupportedDocumentFile(files);

    if (!file) {
      if (files && files.length > 0) {
        setErrors((currentErrors) => ({
          ...currentErrors,
          [errorField]: DOCUMENT_FILE_ERROR,
        }));
      }
      return;
    }

    setDraft((currentDraft) => ({
      ...currentDraft,
      [fileField]: file,
    }));
    setErrors((currentErrors) => ({
      ...currentErrors,
      [errorField]: undefined,
    }));
  }

  function clearMatchDocumentFile(
    fileField: "resumeFile" | "vacancyFile",
    errorField: "resumeText" | "vacancyText",
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fileField]: undefined,
    }));
    setErrors((currentErrors) => ({
      ...currentErrors,
      [errorField]: undefined,
    }));
  }

  function updateAutoDocumentFile(files: FileList | File[] | null) {
    const file = findSupportedDocumentFile(files);

    if (!file) {
      if (files && files.length > 0) {
        setAutoErrors((currentErrors) => ({
          ...currentErrors,
          resumeText: DOCUMENT_FILE_ERROR,
        }));
      }
      return;
    }

    setAutoDraft((currentDraft) => ({
      ...currentDraft,
      resumeFile: file,
    }));
    setAutoErrors((currentErrors) => ({
      ...currentErrors,
      resumeText: undefined,
    }));
  }

  function clearAutoDocumentFile() {
    setAutoDraft((currentDraft) => ({
      ...currentDraft,
      resumeFile: undefined,
    }));
    setAutoErrors((currentErrors) => ({
      ...currentErrors,
      resumeText: undefined,
    }));
  }

  function submitMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const requestDraft: MatchDraft =
      testDataEnabled
        ? {
            ...draft,
            runMode: "test",
          }
        : {
            ...draft,
            runMode: "normal",
            promptMode: "template",
            manualPrompt: "",
          };

    const nextErrors = validateMatchDraft(requestDraft);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      writeSafeAppLog("match_validation_failed", requestDraft, undefined, undefined, Object.keys(nextErrors));
      return;
    }

    setLastSubmittedDraft(requestDraft);
    setFeedbackError(null);
    setFeedbackStatus(null);
    matchMutation.mutate(requestDraft);
  }

  function beginCreateAutoSearch() {
    setSelectedAutoSearchId(null);
    setSelectedAutoVacancyId(null);
    setAutoSearchComposerState("naming");
    setAutoSearchNameDraft("");
    setAutoSearchNameError(null);
    setAutoErrors({});
    createAutoSearchDraftMutation.reset();
    runAutoSearchMutation.reset();
    loadMoreAutoSearchMutation.reset();
  }

  function cancelCreateAutoSearch() {
    setAutoSearchComposerState("idle");
    setAutoSearchNameDraft("");
    setAutoSearchNameError(null);
    setAutoErrors({});
  }

  function confirmCreateAutoSearchName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = autoSearchNameDraft.trim();

    if (!nextName) {
      setAutoSearchNameError("Добавь название поиска.");
      return;
    }

    setAutoErrors({});
    setAutoSearchNameError(null);
    createAutoSearchDraftMutation.mutate({ name: nextName });
  }

  function selectAutoSearch(searchId: string) {
    setSelectedAutoSearchId(searchId);
    setSelectedAutoVacancyId(null);
    setAutoSearchComposerState("idle");
    setAutoSearchNameDraft("");
    setAutoSearchNameError(null);
    setAutoErrors({});
    createAutoSearchDraftMutation.reset();
    runAutoSearchMutation.reset();
    loadMoreAutoSearchMutation.reset();
  }

  function submitAutoSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedAutoSearchDetail) {
      return;
    }

    const requestDraft: AutoVacancySearchRunDraft = {
      ...autoDraft,
      locale: draft.locale,
    };
    const nextErrors = validateAutoVacancySearchRunDraft(requestDraft);
    setAutoErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSelectedAutoVacancyId(null);
    runAutoSearchMutation.mutate({ draft: requestDraft, search: selectedAutoSearchDetail });
  }

  async function updateTestDataEnabled(enabled: boolean) {
    setTestDataEnabled(enabled);
    setTestDataError(null);

    if (!enabled) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        resumeFile: undefined,
        vacancyFile: undefined,
        careerStrategy: "",
        redFlags: "",
        runMode: "normal",
        promptMode: "template",
        manualPrompt: "",
      }));
      return;
    }

    try {
      const cases = await loadTestDataCases();
      setTestDataCases(cases);

      if (cases.length === 0) {
        throw new Error("В test_data нет подпапок с тестовыми данными.");
      }

      await loadSelectedTestDataCase(selectedTestDataCase || cases[0].name);
    } catch (error) {
      setTestDataEnabled(false);
      setTestDataError(error instanceof Error ? error.message : "Не удалось загрузить test_data.");
    }
  }

  async function loadSelectedTestDataCase(caseName: string) {
    setSelectedTestDataCase(caseName);
    setTestDataError(null);

    try {
      const testDraft = await loadTestDataDraft(caseName);
      setDraft((currentDraft) => ({
        ...currentDraft,
        resumeText: testDraft.resumeText,
        resumeFile: testDraft.resumeFile,
        careerStrategy: testDraft.careerStrategy,
        redFlags: testDraft.redFlags,
        vacancyText: testDraft.vacancyText,
        vacancyFile: testDraft.vacancyFile,
        runMode: "test",
        promptMode: currentDraft.promptMode === "manual" ? "manual" : "template",
        manualPrompt: testDraft.manualPrompt,
      }));
      setErrors({});
    } catch (error) {
      setTestDataError(error instanceof Error ? error.message : "Не удалось загрузить test_data.");
    }
  }

  function updateCreateTestDataFile(
    field: "cvFile" | "vacancyFile" | "promptFile",
    files: FileList | null,
  ) {
    setCreateTestDataDraft((currentDraft) => ({
      ...currentDraft,
      [field]: files?.[0],
    }));
    setCreateTestDataError(null);
    setCreateTestDataStatus(null);
  }

  function updateCreateTestDataText(
    field: "careerStrategy" | "redFlags",
    value: string,
  ) {
    setCreateTestDataDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
    setCreateTestDataError(null);
    setCreateTestDataStatus(null);
  }

  async function submitCreateTestDataCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateTestDataError(null);
    setCreateTestDataStatus(null);
    setCreateTestDataPending(true);

    try {
      const createdCase = await createTestDataCase(createTestDataDraft);
      const cases = await loadTestDataCases();

      setTestDataEnabled(true);
      setTestDataCases(cases);
      setSelectedTestDataCase(createdCase.name);
      await loadSelectedTestDataCase(createdCase.name);
      setCreateTestDataDraft(emptyCreateTestDataDraft);
      setCreateTestDataFormKey((currentKey) => currentKey + 1);
      setCreateTestDataStatus(`Создан набор test_data/${createdCase.name}.`);
    } catch (error) {
      setCreateTestDataError(
        error instanceof Error ? error.message : "Не удалось создать test_data набор.",
      );
    } finally {
      setCreateTestDataPending(false);
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const feedbackDraft = result || matchMutation.isError ? lastSubmittedDraft : draft;

    setFeedbackError(null);
    setFeedbackStatus(null);
    setFeedbackPending(true);

    try {
      const savedFeedback = await createFeedbackEntry(
        {
          type: feedbackType,
          message: feedbackMessage,
          expected: feedbackExpected,
        },
        {
          draft: feedbackDraft,
          result: result ?? undefined,
          apiMode: matchApiMode,
        },
      );

      setFeedbackMessage("");
      setFeedbackExpected("");
      setFeedbackType("other");
      setFeedbackStatus(`Обратная связь сохранена: ${savedFeedback.id}`);
      writeSafeAppLog("feedback_saved", feedbackDraft, result ?? undefined);
    } catch (error) {
      setFeedbackError(
        error instanceof Error ? error.message : "Не удалось сохранить обратную связь.",
      );
      writeSafeAppLog("feedback_failed", feedbackDraft, result ?? undefined, error);
    } finally {
      setFeedbackPending(false);
    }
  }

  async function loadAdminFeedback() {
    setAdminFeedbackError(null);
    setAdminFeedbackPending(true);

    try {
      const feedback = await fetchAdminFeedback();
      setAdminFeedbackItems(feedback.items);
      setAdminFeedbackCount(feedback.count);
      setExpandedFeedbackId((currentId) =>
        feedback.items.some((item) => item.id === currentId) ? currentId : null,
      );
    } catch (error) {
      setAdminFeedbackError(
        error instanceof Error ? error.message : "Не удалось загрузить feedback.",
      );
    } finally {
      setAdminFeedbackPending(false);
    }
  }

  function writeSafeAppLog(
    event: AppLogEvent,
    logDraft: MatchDraft,
    logResult?: MatchResult,
    error?: unknown,
    validationFields?: string[],
  ) {
    void writeAppLogEntry(event, {
      apiMode: matchApiMode,
      draft: logDraft,
      result: logResult,
      error,
      validationFields,
    }).catch(() => undefined);
  }

  const result = matchMutation.data;
  const scoreTone =
    result?.recommendation === "apply"
      ? "text-emerald-700"
      : result?.recommendation === "manual_review"
        ? "text-amber-700"
        : "text-rose-700";
  const selectedModelValue = getSelectableOpenAiModel(draft.openaiModel);
  const selectedModel =
    openAiModelOptions.find((option) => option.value === selectedModelValue) ?? openAiModelOptions[0];
  const visiblePromptMode = testDataEnabled ? draft.promptMode : "template";

  if (matchApiMode === "api" && !authSession) {
    return (
      <AuthScreen
        backendStatus={
          healthQuery.data
            ? `${healthQuery.data.status} / ${healthQuery.data.environment}`
            : healthQuery.isError
              ? "offline"
              : "checking"
        }
        error={authError}
        isPending={authPending}
        onPasswordChange={setAuthPassword}
        onSubmit={submitAuth}
        onUsernameChange={setAuthUsername}
        password={authPassword}
        username={authUsername}
      />
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-700">Job Match Assistant</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
              Первый match-поток
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
            <label className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1">
              <span>Язык</span>
              <span
                aria-label="Выбор языка влияет на язык результата и на работу ИИ при оценке."
                className="inline-flex h-4 w-4 items-center justify-center text-zinc-500"
                title="Выбор языка влияет на язык результата и на работу ИИ при оценке."
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </span>
              <select
                className="bg-transparent text-sm font-medium outline-none"
                onChange={(event) => {
                  const locale = event.target.value;
                  setDraft((currentDraft) => ({ ...currentDraft, locale }));
                  setAutoDraft((currentDraft) => ({ ...currentDraft, locale }));
                }}
                value={draft.locale}
              >
                <option value="ru">RU</option>
              </select>
            </label>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1">
              API mode: {matchApiMode}
            </span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1">
              Backend:{" "}
              {healthQuery.data
                ? `${healthQuery.data.status} / ${healthQuery.data.environment}`
                : healthQuery.isError
                  ? "offline"
                  : "checking"}
            </span>
            {authSession && (
              <button
                className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-zinc-700 hover:bg-zinc-100"
                onClick={logout}
                type="button"
              >
                <LogOut className="h-3.5 w-3.5" />
                {authSession.username}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between lg:col-span-2">
          <div className="inline-flex rounded-md border border-zinc-200 bg-white p-1 shadow-sm">
            <button
              className={`rounded px-3 py-2 text-sm font-medium ${activeTab === "auto" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
              onClick={() => setActiveTab("auto")}
              type="button"
            >
              Auto
            </button>
            <button
              className={`rounded px-3 py-2 text-sm font-medium ${activeTab === "match" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
              onClick={() => setActiveTab("match")}
              type="button"
            >
              Match
            </button>
            <button
              className={`rounded px-3 py-2 text-sm font-medium ${activeTab === "test" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
              onClick={() => setActiveTab("test")}
              type="button"
            >
              Тест
            </button>
          </div>
          <button
            aria-expanded={feedbackOpen}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium shadow-sm transition ${
              feedbackOpen
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
            onClick={() => setFeedbackOpen((isOpen) => !isOpen)}
            type="button"
          >
            <MessageSquare className="h-4 w-4" />
            Обратная связь
          </button>
        </div>

        {feedbackOpen && (
          <section className="lg:col-span-2">
            <FeedbackPanel
              error={feedbackError}
              expected={feedbackExpected}
              isPending={feedbackPending}
              message={feedbackMessage}
              onExpectedChange={setFeedbackExpected}
              onMessageChange={setFeedbackMessage}
              onSubmit={submitFeedback}
              onTypeChange={setFeedbackType}
              status={feedbackStatus}
              type={feedbackType}
            />
          </section>
        )}

        {activeTab === "test" ? (
          <>
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-zinc-700" />
              <h2 className="text-lg font-semibold">Тестовые настройки</h2>
            </div>

            <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-2">
              <div className="grid gap-2 lg:grid-cols-[minmax(320px,1fr)_minmax(260px,0.55fr)]">
                <label className="flex min-h-12 items-center gap-3 rounded bg-white px-3 text-sm text-zinc-800">
                  <input
                    checked={testDataEnabled}
                    className="h-4 w-4"
                    onChange={(event) => void updateTestDataEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Подтягивать данные из выбранной папки{" "}
                    <span className="font-mono">test_data</span>
                  </span>
                </label>

                <label className="grid min-h-12 grid-cols-[auto_minmax(120px,1fr)] items-center gap-3 rounded bg-white px-3 text-sm font-medium text-zinc-800">
                  <span>Используемый промт</span>
                  <select
                    className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500"
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        promptMode: event.target.value as MatchDraft["promptMode"],
                      }))
                    }
                    value={draft.promptMode}
                  >
                    <option value="template">Шаблон</option>
                    <option value="manual">Из тестовых данных</option>
                    <option className="text-zinc-400" disabled value="generated">
                      Генерация
                    </option>
                  </select>
                </label>

                {testDataEnabled && !testDataError && (
                  <label className="grid min-h-12 grid-cols-[auto_minmax(120px,1fr)] items-center gap-3 rounded bg-white px-3 text-sm font-medium text-zinc-800">
                    <span>Набор тестовых данных</span>
                    <select
                      className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500"
                      onChange={(event) => void loadSelectedTestDataCase(event.target.value)}
                      value={selectedTestDataCase}
                    >
                      {testDataCases.map((testCase) => (
                        <option key={testCase.name} value={testCase.name}>
                          {testCase.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {testDataError && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {testDataError}
                </div>
              )}

              {testDataEnabled && !testDataError && (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Тестовые данные{draft.manualPrompt ? " и prompt" : ""} загружены в форму.
                </div>
              )}

              <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3">
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                  onClick={() => setCreateTestDataOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                  Добавить тестовые данные
                </button>

                {createTestDataOpen && (
                  <form
                    className="mt-4 grid gap-3"
                    key={createTestDataFormKey}
                    onSubmit={(event) => void submitCreateTestDataCase(event)}
                  >
                    <p className="text-sm leading-6 text-zinc-600">
                      Backend извлечет текст, обезличит CV и сохранит тестовый набор без raw CV.
                      Vacancy и prompt сохраняются как текстовые поля набора.
                    </p>

                    <div className="grid gap-3 md:grid-cols-3">
                      <TestDataFileField
                        accept=".pdf,.docx"
                        description="PDF или DOCX, сохранится как cv.pdf/cv.docx"
                        label="CV"
                        onChange={(files) => updateCreateTestDataFile("cvFile", files)}
                        required
                      />
                      <TestDataFileField
                        accept=".pdf,.docx"
                        description="PDF или DOCX, сохранится как vacancy.pdf/vacancy.docx"
                        label="Vacancy"
                        onChange={(files) => updateCreateTestDataFile("vacancyFile", files)}
                        required
                      />
                      <TestDataFileField
                        accept=".md,.txt"
                        description="Необязательно, сохранится как prompt.md/prompt.txt"
                        label="Prompt"
                        onChange={(files) => updateCreateTestDataFile("promptFile", files)}
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium text-zinc-800">
                        <span>Career strategy</span>
                        <textarea
                          className="min-h-24 rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                          onChange={(event) =>
                            updateCreateTestDataText("careerStrategy", event.target.value)
                          }
                          placeholder="Необязательно при создании, но нужно перед запуском оценки."
                          value={createTestDataDraft.careerStrategy}
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-zinc-800">
                        <span>Red flags</span>
                        <textarea
                          className="min-h-24 rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                          onChange={(event) =>
                            updateCreateTestDataText("redFlags", event.target.value)
                          }
                          placeholder="Необязательно."
                          value={createTestDataDraft.redFlags}
                        />
                      </label>
                    </div>

                    {createTestDataError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                        {createTestDataError}
                      </div>
                    )}
                    {createTestDataStatus && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {createTestDataStatus}
                      </div>
                    )}

                    <div>
                      <button
                        className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                        disabled={createTestDataPending}
                        type="submit"
                      >
                        {createTestDataPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        Создать набор
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </section>
          <AdminFeedbackPanel
            count={adminFeedbackCount}
            error={adminFeedbackError}
            expandedId={expandedFeedbackId}
            items={adminFeedbackItems}
            onLoad={() => void loadAdminFeedback()}
            onToggle={(id) =>
              setExpandedFeedbackId((currentId) => (currentId === id ? null : id))
            }
            pending={adminFeedbackPending}
          />
          </>
        ) : activeTab === "auto" ? (
          <AutoVacancyMatchingView
            composerState={autoSearchComposerState}
            createNameError={autoSearchNameError}
            createNameValue={autoSearchNameDraft}
            draft={autoDraft}
            errors={autoErrors}
            createError={
              createAutoSearchDraftMutation.error instanceof Error
                ? createAutoSearchDraftMutation.error.message
                : null
            }
            isCreatingSearch={createAutoSearchDraftMutation.isPending}
            isLoadingMore={loadMoreAutoSearchMutation.isPending}
            isLoadingSelectedSearch={shouldFetchSelectedAutoSearch && selectedAutoSearchQuery.isFetching}
            isLoadingSearches={autoSearchesQuery.isFetching}
            isRunningSearch={runAutoSearchMutation.isPending}
            loadMoreError={
              loadMoreAutoSearchMutation.error instanceof Error
                ? loadMoreAutoSearchMutation.error.message
                : null
            }
            onCancelCreateSearch={cancelCreateAutoSearch}
            onClearResumeFile={clearAutoDocumentFile}
            onConfirmCreateName={confirmCreateAutoSearchName}
            onCreateNameChange={(value) => {
              setAutoSearchNameDraft(value);
              setAutoSearchNameError(null);
            }}
            onCreateNewSearch={beginCreateAutoSearch}
            onLoadMore={(search) => loadMoreAutoSearchMutation.mutate(search)}
            onResumeFileChange={updateAutoDocumentFile}
            onSelectSearch={selectAutoSearch}
            onSelectedVacancyChange={(id) =>
              setSelectedAutoVacancyId((currentId) => (currentId === id ? null : id))
            }
            onSubmit={submitAutoSearch}
            onUpdateDraft={updateAutoDraft}
            savedSearches={autoSearchesQuery.data?.searches ?? []}
            searchListError={
              autoSearchesQuery.error instanceof Error ? autoSearchesQuery.error.message : null
            }
            selectedSearch={selectedAutoSearchDetail}
            selectedSearchError={
              selectedAutoSearchQuery.error instanceof Error
                ? selectedAutoSearchQuery.error.message
                : null
            }
            selectedSearchId={selectedAutoSearchId}
            selectedVacancyId={selectedAutoVacancyId}
            submitError={
              runAutoSearchMutation.error instanceof Error ? runAutoSearchMutation.error.message : null
            }
          />
        ) : (
          <>
        <form className="grid gap-4" onSubmit={submitMatch}>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold" htmlFor="openaiModel">
              <Sparkles className="h-4 w-4 text-violet-700" />
              Модель ИИ
            </label>
            <div
              aria-label="Модель ИИ"
              className="flex flex-wrap gap-2"
              id="openaiModel"
              role="radiogroup"
            >
              {openAiModelOptions.map((option) => {
                const isSelectable = isOpenAiModelSelectable(option.value);
                const isSelected = selectedModelValue === option.value;

                return (
                  <button
                    aria-checked={isSelected}
                    aria-disabled={!isSelectable}
                    className={`min-h-10 rounded-full px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-violet-200 ${
                      !isSelectable
                        ? "cursor-not-allowed bg-zinc-100 text-zinc-400 shadow-none"
                        : isSelected
                          ? "bg-blue-600 text-white shadow-md shadow-blue-200"
                          : "bg-indigo-100 text-zinc-700 hover:bg-indigo-200"
                    }`}
                    disabled={!isSelectable}
                    key={option.value}
                    onClick={() => {
                      if (isSelectable) {
                        updateDraft("openaiModel", option.value);
                      }
                    }}
                    role="radio"
                    title={!isSelectable ? "Временно недоступно для выбора" : undefined}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{selectedModel.description}</p>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label
                className="flex items-center gap-2 text-sm font-semibold"
                htmlFor="careerStrategy"
              >
                <Sparkles className="h-4 w-4 text-violet-700" />
                Career strategy
                <FieldHelp label="Подсказка Career strategy" text={careerStrategyPlaceholder} />
              </label>
              {errors.careerStrategy && (
                <span className="text-sm text-rose-700">{errors.careerStrategy}</span>
              )}
            </div>
            <textarea
              className="min-h-52 w-full resize-y rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm leading-6 outline-none transition focus:border-violet-600 focus:bg-white focus:ring-2 focus:ring-violet-100"
              id="careerStrategy"
              onChange={(event) => updateDraft("careerStrategy", event.target.value)}
              placeholder={careerStrategyPlaceholder}
              value={draft.careerStrategy}
            />
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold" htmlFor="redFlags">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              Red flags
            </label>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition focus:border-amber-600 focus:bg-white focus:ring-2 focus:ring-amber-100"
              id="redFlags"
              onChange={(event) => updateDraft("redFlags", event.target.value)}
              placeholder="Пример: не рассматривать early-stage startups, crypto/gambling, Big Tech, people management"
              value={draft.redFlags}
            />
          </div>

          <MatchDocumentField
            error={errors.resumeText}
            file={draft.resumeFile}
            fileInputLabel="Прикрепить файл резюме"
            icon={<FileText className="h-4 w-4 text-emerald-700" />}
            id="resumeText"
            label="Резюме"
            onChange={(value) => updateDraft("resumeText", value)}
            onClearFile={() => clearMatchDocumentFile("resumeFile", "resumeText")}
            onFileChange={(files) => updateMatchDocumentFile("resumeFile", "resumeText", files)}
            placeholder={resumeInputHint}
            tone="emerald"
            value={draft.resumeText}
          />

          <MatchDocumentField
            error={errors.vacancyText}
            file={draft.vacancyFile}
            fileInputLabel="Прикрепить файл вакансии"
            icon={<BriefcaseBusiness className="h-4 w-4 text-sky-700" />}
            id="vacancyText"
            label="Вакансия"
            onChange={(value) => updateDraft("vacancyText", value)}
            onClearFile={() => clearMatchDocumentFile("vacancyFile", "vacancyText")}
            onFileChange={(files) => updateMatchDocumentFile("vacancyFile", "vacancyText", files)}
            placeholder={vacancyInputHint}
            tone="sky"
            value={draft.vacancyText}
          />

          <div className="flex justify-end">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              disabled={matchMutation.isPending}
              type="submit"
            >
              {matchMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
              Посчитать match
            </button>
          </div>
        </form>

        <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Результат</p>
              <h2 className="mt-1 text-xl font-semibold">Оценка совпадения</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Используемый промт: {promptModeLabel(visiblePromptMode)}
              </p>
            </div>
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>

          {matchMutation.isError && (
            <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <span>{matchMutation.error.message}</span>
              </div>
            </div>
          )}

          {matchMutation.isPending && (
            <div className="mt-8 flex min-h-80 flex-col items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <span className="absolute h-14 w-14 animate-ping rounded-full bg-emerald-200" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </span>
              </div>
              <p className="mt-4 text-sm font-semibold text-emerald-900">Ожидаем ответ от ИИ</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-emerald-800">
                Backend обрабатывает входные данные и возвращает результат оценки.
              </p>
            </div>
          )}

          {!result && !matchMutation.isError && !matchMutation.isPending && (
            <div className="mt-8 flex min-h-80 flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
              <BadgeCheck className="h-8 w-8 text-zinc-400" />
              <p className="mt-3 text-sm font-medium text-zinc-700">
                Результат появится после расчета.
              </p>
            </div>
          )}

          {result && !matchMutation.isPending && (
            <div className="mt-6 space-y-5">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm text-zinc-600">Score</p>
                    <p className={`mt-1 text-5xl font-semibold ${scoreTone}`}>
                      {result.match_score}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm font-medium">
                      {result.recommendation}
                    </span>
                    <span className="text-xs font-medium uppercase text-zinc-500">
                      уверенность: {confidenceLabel(result.confidence)}
                    </span>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-700">{result.summary}</p>
              </div>

              <RequirementList
                empty="Пока нет."
                items={result.matched_requirements}
                title="Matched requirements"
              />
              <RequirementList
                empty="Пробелов не найдено."
                items={result.missing_or_unclear_requirements}
                title="Missing / unclear requirements"
              />
              <RedFlagList items={result.red_flags} />
              <ScoreBreakdownView breakdown={result.score_breakdown} />
            </div>
          )}
        </aside>
          </>
        )}
      </section>
    </main>
  );
}

function AuthScreen({
  backendStatus,
  error,
  isPending,
  onPasswordChange,
  onSubmit,
  onUsernameChange,
  password,
  username,
}: {
  backendStatus: string;
  error: string | null;
  isPending: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUsernameChange: (value: string) => void;
  password: string;
  username: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-8 text-zinc-950">
      <section className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-950 text-white">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-700">Job Match Assistant</p>
            <h1 className="text-xl font-semibold">Вход в MVP</h1>
          </div>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-2 text-sm font-medium text-zinc-800">
            <span>Логин</span>
            <input
              autoComplete="username"
              className="h-10 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-500 focus:bg-white"
              onChange={(event) => onUsernameChange(event.target.value)}
              required
              value={username}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-zinc-800">
            <span>Пароль</span>
            <input
              autoComplete="current-password"
              className="h-10 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-500 focus:bg-white"
              onChange={(event) => onPasswordChange(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </div>
          )}

          <button
            className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={isPending}
            type="submit"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Войти
          </button>
        </form>

        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          Backend: {backendStatus}
        </div>
      </section>
    </main>
  );
}

function AutoVacancyMatchingView({
  composerState,
  createError,
  createNameError,
  createNameValue,
  draft,
  errors,
  isCreatingSearch,
  isLoadingMore,
  isLoadingSearches,
  isLoadingSelectedSearch,
  isRunningSearch,
  loadMoreError,
  onCancelCreateSearch,
  onClearResumeFile,
  onConfirmCreateName,
  onCreateNameChange,
  onCreateNewSearch,
  onLoadMore,
  onResumeFileChange,
  onSelectSearch,
  onSelectedVacancyChange,
  onSubmit,
  onUpdateDraft,
  savedSearches,
  searchListError,
  selectedSearch,
  selectedSearchError,
  selectedSearchId,
  selectedVacancyId,
  submitError,
}: {
  composerState: AutoSearchComposerState;
  createError: string | null;
  createNameError: string | null;
  createNameValue: string;
  draft: AutoVacancySearchRunDraft;
  errors: AutoVacancySearchRunDraftErrors;
  isCreatingSearch: boolean;
  isLoadingMore: boolean;
  isLoadingSearches: boolean;
  isLoadingSelectedSearch: boolean;
  isRunningSearch: boolean;
  loadMoreError: string | null;
  onCancelCreateSearch: () => void;
  onClearResumeFile: () => void;
  onConfirmCreateName: (event: FormEvent<HTMLFormElement>) => void;
  onCreateNameChange: (value: string) => void;
  onCreateNewSearch: () => void;
  onLoadMore: (search: AutoVacancySearchDetail) => void;
  onResumeFileChange: (files: FileList | File[] | null) => void;
  onSelectSearch: (searchId: string) => void;
  onSelectedVacancyChange: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateDraft: <K extends keyof AutoVacancySearchRunDraft>(
    field: K,
    value: AutoVacancySearchRunDraft[K],
  ) => void;
  savedSearches: AutoVacancySearchSummary[];
  searchListError: string | null;
  selectedSearch?: AutoVacancySearchDetail;
  selectedSearchError: string | null;
  selectedSearchId: string | null;
  selectedVacancyId: string | null;
  submitError: string | null;
}) {
  const selectedModelValue = getSelectableOpenAiModel(draft.openaiModel);
  const selectedModel =
    openAiModelOptions.find((option) => option.value === selectedModelValue) ?? openAiModelOptions[0];
  const showRunForm = selectedSearch?.results.length === 0;
  const showSelectedInputs = (selectedSearch?.results.length ?? 0) > 0;

  return (
    <>
      <AutoSavedSearchesPanel
        composerState={composerState}
        error={searchListError}
        isLoading={isLoadingSearches}
        onCreateNewSearch={onCreateNewSearch}
        onSelectSearch={onSelectSearch}
        savedSearches={savedSearches}
        selectedSearchId={selectedSearchId}
      />

      {composerState === "naming" && (
        <AutoSearchNamePrompt
          error={createNameError}
          isPending={isCreatingSearch}
          name={createNameValue}
          onCancel={onCancelCreateSearch}
          onChange={onCreateNameChange}
          onSubmit={onConfirmCreateName}
        />
      )}

      {createError && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 shadow-sm lg:col-span-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{createError}</span>
          </div>
        </section>
      )}

      {showRunForm && selectedSearch && (
        <>
          <form className="grid gap-4 lg:col-span-2" onSubmit={onSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
              <div className="grid gap-4">
                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500">Проект поиска</p>
                      <h2 className="mt-1 text-lg font-semibold text-zinc-950">{selectedSearch.name}</h2>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
                    <BriefcaseBusiness className="h-4 w-4 text-zinc-500" />
                    <span>
                      Проект уже создан. Start search отправит CV и параметры в run endpoint.
                    </span>
                  </div>
                </section>

                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <label className="mb-3 flex items-center gap-2 text-sm font-semibold" htmlFor="autoOpenaiModel">
                    <Sparkles className="h-4 w-4 text-violet-700" />
                    Модель ИИ
                  </label>
                  <div
                    aria-label="Модель ИИ для auto matching"
                    className="flex flex-wrap gap-2"
                    id="autoOpenaiModel"
                    role="radiogroup"
                  >
                    {openAiModelOptions.map((option) => {
                      const isSelectable = isOpenAiModelSelectable(option.value);
                      const isSelected = selectedModelValue === option.value;

                      return (
                        <button
                          aria-checked={isSelected}
                          aria-disabled={!isSelectable}
                          className={`min-h-10 rounded-full px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-violet-200 ${
                            !isSelectable
                              ? "cursor-not-allowed bg-zinc-100 text-zinc-400 shadow-none"
                              : isSelected
                                ? "bg-blue-600 text-white shadow-md shadow-blue-200"
                                : "bg-indigo-100 text-zinc-700 hover:bg-indigo-200"
                          }`}
                          disabled={!isSelectable}
                          key={option.value}
                          onClick={() => {
                            if (isSelectable) {
                              onUpdateDraft("openaiModel", option.value);
                            }
                          }}
                          role="radio"
                          title={!isSelectable ? "Временно недоступно для выбора" : undefined}
                          type="button"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{selectedModel.description}</p>
                </section>

                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label
                      className="flex items-center gap-2 text-sm font-semibold"
                      htmlFor="autoCareerStrategy"
                    >
                      <Sparkles className="h-4 w-4 text-violet-700" />
                      Career strategy
                      <FieldHelp label="Подсказка Career strategy" text={autoCareerStrategyHelp} />
                    </label>
                    {errors.careerStrategy && (
                      <span className="text-sm text-rose-700">{errors.careerStrategy}</span>
                    )}
                  </div>
                  <textarea
                    className="min-h-52 w-full resize-y rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm leading-6 outline-none transition focus:border-violet-600 focus:bg-white focus:ring-2 focus:ring-violet-100"
                    id="autoCareerStrategy"
                    onChange={(event) => onUpdateDraft("careerStrategy", event.target.value)}
                    placeholder={careerStrategyPlaceholder}
                    value={draft.careerStrategy}
                  />
                </section>

                <MatchDocumentField
                  dropLabel="резюме"
                  error={errors.resumeText}
                  file={draft.resumeFile}
                  fileInputLabel="Прикрепить файл резюме для auto matching"
                  icon={<FileText className="h-4 w-4 text-emerald-700" />}
                  id="autoResumeText"
                  label="Резюме"
                  onChange={(value) => onUpdateDraft("resumeText", value)}
                  onClearFile={onClearResumeFile}
                  onFileChange={onResumeFileChange}
                  placeholder={resumeInputHint}
                  tone="emerald"
                  value={draft.resumeText}
                />
              </div>

              <div className="grid content-start gap-4">
                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-sky-700" />
                    <h2 className="text-sm font-semibold">Источник вакансий</h2>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2 text-sm font-medium text-zinc-800">
                      <span>Источник</span>
                      <select
                        className="h-11 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onUpdateDraft("source", event.target.value as AutoVacancySource)
                        }
                        value={draft.source}
                      >
                        <option value="linkedin">Linkedin</option>
                      </select>
                    </label>

                    <label className="grid gap-2 text-sm font-medium text-zinc-800" htmlFor="autoVacancyLimit">
                      <span>Количество вакансий</span>
                      <select
                        className="h-11 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-2 focus:ring-sky-100"
                        id="autoVacancyLimit"
                        onChange={(event) =>
                          onUpdateDraft("vacancyLimit", Number(event.target.value) as AutoVacancyLimit)
                        }
                        value={draft.vacancyLimit}
                      >
                        {autoVacancyLimitOptions.map((limit) => (
                          <option key={limit} value={limit}>
                            {limit}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">
                    Frontend передает только параметры поиска. Получение вакансий и соблюдение
                    ограничений источника остаются на стороне backend provider.
                  </p>
                </section>

                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <label className="mb-3 flex items-center gap-2 text-sm font-semibold" htmlFor="autoRedFlags">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                    Red flags
                    <FieldHelp label="Подсказка Red flags" text={autoRedFlagsHelp} />
                  </label>
                  <input
                    className="h-11 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition focus:border-amber-600 focus:bg-white focus:ring-2 focus:ring-amber-100"
                    id="autoRedFlags"
                    onChange={(event) => onUpdateDraft("redFlags", event.target.value)}
                    placeholder="Пример: не рассматривать early-stage startups, crypto/gambling, Big Tech, people management"
                    value={draft.redFlags}
                  />
                </section>

                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <ListChecks className="mt-0.5 h-4 w-4 text-emerald-700" />
                    <div>
                      <h2 className="text-sm font-semibold">Auto vacancy matching</h2>
                      <p className="mt-1 text-sm leading-6 text-zinc-600">
                        Backend сохранит inputs в существующий проект и запустит matching.
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-600">
                        Поиск пока запускается с фиксированными настройками: вакансии за Past
                        week, узкий поиск по ключам включён, хороший match считается от 79 баллов.
                      </p>
                    </div>
                  </div>

                  <button
                    className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    disabled={isRunningSearch}
                    type="submit"
                  >
                    {isRunningSearch ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Start search
                  </button>
                </section>
              </div>
            </div>
          </form>

          <AutoMatchResultsPanel
            isError={Boolean(submitError)}
            isLoadingMore={false}
            isPending={isRunningSearch}
            loadMoreError={null}
            onLoadMore={undefined}
            onSelectedVacancyChange={onSelectedVacancyChange}
            response={undefined}
            selectedVacancyId={selectedVacancyId}
            submitError={submitError}
          />
        </>
      )}

      {selectedSearchId && isLoadingSelectedSearch && !selectedSearch && (
        <section className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm lg:col-span-2">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm font-semibold text-emerald-900">
            Загружаем сохраненный поиск
          </p>
        </section>
      )}

      {selectedSearchError && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 shadow-sm lg:col-span-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{selectedSearchError}</span>
          </div>
        </section>
      )}

      {showSelectedInputs && selectedSearch && (
        <>
          <AutoSelectedSearchInputs search={selectedSearch} />
          <AutoMatchResultsPanel
            isError={false}
            isLoadingMore={isLoadingMore}
            isPending={false}
            loadMoreError={loadMoreError}
            onLoadMore={
              canLoadMoreAutoSearch(selectedSearch) ? () => onLoadMore(selectedSearch) : undefined
            }
            onSelectedVacancyChange={onSelectedVacancyChange}
            response={selectedSearch}
            selectedVacancyId={selectedVacancyId}
            submitError={null}
          />
        </>
      )}
    </>
  );
}

function AutoSavedSearchesPanel({
  composerState,
  error,
  isLoading,
  onCreateNewSearch,
  onSelectSearch,
  savedSearches,
  selectedSearchId,
}: {
  composerState: AutoSearchComposerState;
  error: string | null;
  isLoading: boolean;
  onCreateNewSearch: () => void;
  onSelectSearch: (searchId: string) => void;
  savedSearches: AutoVacancySearchSummary[];
  selectedSearchId: string | null;
}) {
  const [isProjectListExpanded, setIsProjectListExpanded] = useState(false);
  const canCollapseProjectList = savedSearches.length > 4;
  const isProjectListCollapsed = canCollapseProjectList && !isProjectListExpanded;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Auto vacancy search</p>
          <h2 className="mt-1 text-xl font-semibold">Проекты поиска</h2>
        </div>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={composerState === "naming"}
          onClick={onCreateNewSearch}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Создать новый проект поиска
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading saved searches
        </div>
      )}

      {!isLoading && savedSearches.length === 0 && !error && (
        <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4">
          <p className="text-sm font-medium text-zinc-800">Нет сохраненных проектов поиска.</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Создай новый проект, чтобы сохранить его и запустить matching.
          </p>
        </div>
      )}

      {savedSearches.length > 0 && (
        <div className="relative mt-4">
          <div
            aria-label="Список проектов поиска"
            className={isProjectListCollapsed ? "max-h-[314px] overflow-hidden" : undefined}
          >
            <ul className="grid gap-2">
              {savedSearches.map((search) => {
                const isSelected = selectedSearchId === search.search_id;

                return (
                  <li key={search.search_id}>
                    <button
                      className={`grid min-h-20 w-full gap-2 rounded-md border px-3 py-3 text-left text-sm transition md:grid-cols-[minmax(200px,1fr)_120px] md:items-center ${
                        isSelected
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                      }`}
                      onClick={() => onSelectSearch(search.search_id)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-zinc-950">{search.name}</span>
                        <span className="mt-1 block text-xs text-zinc-500">
                          {formatSearchDate(search.created_at)}
                        </span>
                      </span>
                      <span className="text-zinc-700">{search.results_count} results</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {canCollapseProjectList && (
            <div
              className={
                isProjectListCollapsed
                  ? "pointer-events-none absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-b from-white/0 via-white/80 to-white pb-1"
                  : "mt-3 flex justify-center"
              }
            >
              <button
                className="pointer-events-auto inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
                onClick={() => setIsProjectListExpanded((current) => !current)}
                type="button"
              >
                {isProjectListExpanded ? "Свернуть" : "Показать больше"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AutoSearchNamePrompt({
  error,
  isPending,
  name,
  onCancel,
  onChange,
  onSubmit,
}: {
  error: string | null;
  isPending: boolean;
  name: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2"
      onSubmit={onSubmit}
    >
      <div>
        <p className="text-xs font-semibold uppercase text-zinc-500">Новый проект</p>
        <h2 className="mt-1 text-lg font-semibold">Название проекта поиска</h2>
      </div>

      <label className="grid gap-2 text-sm font-medium text-zinc-800" htmlFor="autoSearchNamePrompt">
        <span>Название</span>
        <input
          className="h-11 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition focus:border-zinc-600 focus:bg-white focus:ring-2 focus:ring-zinc-100"
          id="autoSearchNamePrompt"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Например: Berlin backend July"
          value={name}
        />
      </label>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={isPending}
          type="submit"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Продолжить
        </button>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AutoSelectedSearchInputs({ search }: { search: AutoVacancySearchDetail }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Selected search</p>
          <h2 className="mt-1 text-xl font-semibold">{search.name}</h2>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <AutoSearchInputFact label="Vacancy limit" value={`${search.vacancy_limit}`} />
        <AutoSearchInputFact label="Locale" value={search.locale || "unknown"} />
        <AutoSearchInputFact
          label="LLM confidence"
          value={confidenceLabel(search.llm_meta.confidence)}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <AutoSearchInputText label="Career strategy" value={search.career_strategy} />
        <AutoSearchInputText label="Red flags" value={search.red_flags || "Не указаны."} />
      </div>

      <AutoSearchCvPreview resume={search.resume} />
    </section>
  );
}

function AutoSearchInputFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-xs uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-zinc-900">{value}</p>
    </div>
  );
}

function AutoSearchInputText({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-xs uppercase text-zinc-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{value}</p>
    </div>
  );
}

function AutoSearchCvPreview({ resume }: { resume: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const normalizedResume = resume.trim();
  const previewLines = normalizedResume.split(/\r?\n/).slice(0, 3).join("\n");
  const hasMore = normalizedResume.length > previewLines.length;
  const visibleResume = isExpanded || !hasMore ? normalizedResume : previewLines;

  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase text-zinc-500">CV</p>
        {hasMore && (
          <button
            className="text-xs font-semibold text-zinc-700 underline-offset-2 transition hover:text-zinc-950 hover:underline"
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? "Скрыть CV" : "Показать CV полностью"}
          </button>
        )}
      </div>
      {visibleResume ? (
        <div className="relative mt-2">
          <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{visibleResume}</p>
          {hasMore && !isExpanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-zinc-50/0 to-zinc-50" />
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">CV не сохранено.</p>
      )}
    </div>
  );
}

function AutoMatchResultsPanel({
  isError,
  isLoadingMore,
  isPending,
  loadMoreError,
  onLoadMore,
  onSelectedVacancyChange,
  response,
  selectedVacancyId,
  submitError,
}: {
  isError: boolean;
  isLoadingMore: boolean;
  isPending: boolean;
  loadMoreError: string | null;
  onLoadMore?: () => void;
  onSelectedVacancyChange: (id: string) => void;
  response?: AutoVacancySearchDetail;
  selectedVacancyId: string | null;
  submitError: string | null;
}) {
  const results = response?.results ?? [];
  const effectiveSelectedVacancyId = selectedVacancyId ?? results[0]?.vacancy_id ?? null;
  const selectedVacancy = results.find((item) => item.vacancy_id === effectiveSelectedVacancyId);
  const resultsCount = response?.results_count ?? results.length;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Результаты</p>
          <h2 className="mt-1 text-xl font-semibold">Auto vacancy matching</h2>
        </div>
        {response && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-600">
              Найдено: {resultsCount}
            </span>
            {onLoadMore && (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                disabled={isLoadingMore}
                onClick={onLoadMore}
                type="button"
              >
                {isLoadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Load more
              </button>
            )}
          </div>
        )}
      </div>

      {isError && (
        <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{submitError ?? "Не удалось запустить auto matching."}</span>
          </div>
        </div>
      )}

      {isPending && (
        <div className="mt-5 flex min-h-52 flex-col items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm font-semibold text-emerald-900">
            Ищем вакансии и считаем match score
          </p>
          <p className="mt-2 max-w-md text-sm leading-6 text-emerald-800">
            Frontend ожидает список от backend API. Raw CV не пишется в console или app logs.
          </p>
        </div>
      )}

      {loadMoreError && (
        <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{loadMoreError}</span>
          </div>
        </div>
      )}

      {!response && !isPending && !isError && (
        <div className="mt-5 flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
          <Search className="h-8 w-8 text-zinc-400" />
          <p className="mt-3 text-sm font-medium text-zinc-700">
            Результаты появятся после запуска поиска.
          </p>
        </div>
      )}

      {response && results.length === 0 && !isPending && (
        <div className="mt-5 flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
          <BadgeCheck className="h-8 w-8 text-zinc-400" />
          <p className="mt-3 text-sm font-medium text-zinc-700">Вакансии не найдены.</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Можно изменить career strategy или red flags и запустить поиск заново.
          </p>
        </div>
      )}

      {results.length > 0 && !isPending && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(440px,1fr)] lg:items-start">
          <div className="min-w-0">
            <div className="hidden grid-cols-[minmax(160px,1.3fr)_minmax(110px,0.8fr)_82px_76px_48px] gap-3 border-b border-zinc-200 px-3 pb-2 text-xs font-semibold uppercase text-zinc-500 lg:grid">
              <span>Вакансия</span>
              <span>Компания</span>
              <span>Источник</span>
              <span>Score</span>
              <span className="sr-only">Link</span>
            </div>

            <ul className="space-y-2 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
              {results.map((vacancy) => {
                const isSelected = effectiveSelectedVacancyId === vacancy.vacancy_id;

                return (
                  <li
                    className={`rounded-md border transition ${
                      isSelected
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 bg-white hover:border-zinc-300"
                    }`}
                    key={vacancy.vacancy_id}
                  >
                    <div className="grid gap-2 p-3 lg:grid-cols-[minmax(0,1fr)_48px] lg:items-start">
                      <button
                        aria-expanded={isSelected}
                        aria-label={`Открыть детали ${vacancy.title}`}
                        className="grid w-full gap-x-3 gap-y-2 text-left text-sm lg:grid-cols-[minmax(160px,1.3fr)_minmax(110px,0.8fr)_82px_76px] lg:items-start"
                        onClick={() => onSelectedVacancyChange(vacancy.vacancy_id)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-zinc-950">
                            {vacancy.title}
                          </span>
                          {vacancy.location && (
                            <span className="mt-1 block truncate text-xs text-zinc-500">
                              {vacancy.location}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 truncate text-zinc-700">{vacancy.company}</span>
                        <span className="min-w-0 truncate text-zinc-700">{sourceLabel(vacancy.source)}</span>
                        <span className="min-w-0">
                          <span
                            className={`block text-lg font-semibold leading-5 ${scoreToneClass(
                              vacancy.recommendation,
                            )}`}
                          >
                            {vacancy.match_score}
                          </span>
                          <span className="mt-1 block max-w-[72px] break-words text-xs font-medium leading-4 text-zinc-500">
                            {vacancy.recommendation}
                          </span>
                        </span>
                        <span className="min-w-0 text-xs leading-5 text-zinc-600 lg:col-span-4">
                          <span className="font-medium text-zinc-800">Key reasons: </span>
                          <span className="break-words [overflow-wrap:anywhere]">
                            {vacancy.key_reasons.length > 0
                              ? vacancy.key_reasons.slice(0, 2).join("; ")
                              : "нет кратких причин"}
                          </span>
                        </span>
                      </button>

                      {vacancy.source_url ? (
                        <a
                          aria-label={`Открыть вакансию ${vacancy.title}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600 transition hover:bg-zinc-100 lg:justify-self-end"
                          href={vacancy.source_url}
                          rel="noreferrer"
                          target="_blank"
                          title="Открыть ссылку на позицию"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : (
                        <span className="hidden h-10 w-10 lg:block" />
                      )}
                    </div>

                    {isSelected && (
                      <div
                        aria-label={`Детали вакансии в строке ${vacancy.title}`}
                        className="border-t border-zinc-200 p-3 lg:hidden"
                      >
                        <AutoVacancyDetails embedded vacancy={vacancy} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <aside aria-label="Детали выбранной вакансии" className="hidden lg:block">
            <div className="sticky top-4">
              {selectedVacancy ? (
                <AutoVacancyDetails vacancy={selectedVacancy} />
              ) : (
                <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
                  Нет выбранной вакансии.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function AutoVacancyDetails({
  embedded = false,
  vacancy,
}: {
  embedded?: boolean;
  vacancy: AutoMatchVacancyResult;
}) {
  const finalScore = vacancy.score_breakdown.final_score;

  return (
    <section className={embedded ? "bg-white" : "rounded-md border border-zinc-200 bg-zinc-50 p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Детали вакансии</p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-950">{vacancy.title}</h3>
          <p className="mt-1 text-sm text-zinc-600">
            {vacancy.company} {vacancy.location ? `· ${vacancy.location}` : ""}
          </p>
        </div>
        <span className={`rounded-md border border-zinc-200 bg-white px-4 py-2 text-base font-semibold shadow-sm ${scoreToneClass(vacancy.recommendation)}`}>
          <span className="text-2xl font-bold leading-none">{finalScore}</span>
          <span className="ml-2 align-baseline text-sm font-semibold"> / {vacancy.recommendation}</span>
        </span>
      </div>

      {vacancy.summary && <p className="mt-4 text-sm leading-6 text-zinc-700">{vacancy.summary}</p>}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <RequirementList
          empty="Совпадений не найдено."
          items={vacancy.matched_requirements}
          title="Matched requirements"
        />
        <RequirementList
          empty="Пробелов не найдено."
          items={vacancy.missing_or_unclear_requirements}
          title="Missing / unclear requirements"
        />
        <RedFlagList items={vacancy.red_flags} />
        <ScoreBreakdownView breakdown={vacancy.score_breakdown} />
      </div>
    </section>
  );
}

function FeedbackPanel({
  error,
  expected,
  isPending,
  message,
  onExpectedChange,
  onMessageChange,
  onSubmit,
  onTypeChange,
  status,
  type,
}: {
  error: string | null;
  expected: string;
  isPending: boolean;
  message: string;
  onExpectedChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTypeChange: (value: FeedbackType) => void;
  status: string | null;
  type: FeedbackType;
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-zinc-700" />
        <h3 className="text-sm font-semibold text-zinc-900">Обратная связь</h3>
      </div>
      <form className="mt-3 grid gap-3" onSubmit={onSubmit}>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          <span>Комментарий *</span>
          <textarea
            className="min-h-24 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-zinc-500"
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Что в оценке неверно или что нужно проверить?"
            required
            value={message}
          />
          <span className="text-xs leading-5 text-zinc-500">
            Не вставляй raw CV целиком: результат и технические поля добавятся автоматически.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-zinc-800">
            <span>Тип</span>
            <select
              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500"
              onChange={(event) => onTypeChange(event.target.value as FeedbackType)}
              value={type}
            >
              <option value="other">Другое</option>
              <option value="wrong_score">Score неверный</option>
              <option value="wrong_recommendation">Recommendation неверный</option>
              <option value="missed_requirement">Пропущено требование</option>
              <option value="wrong_red_flag">Red flag неверный</option>
              <option value="ui_bug">Проблема интерфейса</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm font-medium text-zinc-800">
            <span>Ожидание</span>
            <input
              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500"
              onChange={(event) => onExpectedChange(event.target.value)}
              placeholder="Необязательно"
              value={expected}
            />
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </div>
        )}
        {status && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {status}
          </div>
        )}

        <div>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={isPending}
            type="submit"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
            Отправить
          </button>
        </div>
      </form>
    </section>
  );
}

type MatchDocumentTone = "emerald" | "sky";

const matchDocumentToneClasses: Record<
  MatchDocumentTone,
  {
    fileName: string;
    drag: string;
    focus: string;
    iconButton: string;
    ring: string;
  }
> = {
  emerald: {
    fileName: "text-emerald-700",
    drag: "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100",
    focus: "focus:border-emerald-600 focus:ring-emerald-100",
    iconButton: "text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50",
    ring: "focus-within:border-emerald-300",
  },
  sky: {
    fileName: "text-sky-700",
    drag: "border-sky-500 bg-sky-50 ring-2 ring-sky-100",
    focus: "focus:border-sky-600 focus:ring-sky-100",
    iconButton: "text-sky-700 hover:border-sky-300 hover:bg-sky-50",
    ring: "focus-within:border-sky-300",
  },
};

function MatchDocumentField({
  dropLabel: customDropLabel,
  error,
  file,
  fileInputLabel,
  icon,
  id,
  label,
  onChange,
  onClearFile,
  onFileChange,
  placeholder,
  tone,
  value,
}: {
  dropLabel?: string;
  error?: string;
  file?: File;
  fileInputLabel: string;
  icon: ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onClearFile: () => void;
  onFileChange: (files: FileList | File[] | null) => void;
  placeholder: string;
  tone: MatchDocumentTone;
  value: string;
}) {
  const classes = matchDocumentToneClasses[tone];
  const dropLabel = customDropLabel ?? (id === "resumeText" ? "резюме" : "вакансии");
  const [isFileDragActive, setIsFileDragActive] = useState(false);

  function handleTextareaFileDrag(event: DragEvent<HTMLTextAreaElement>) {
    if (!hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDragActive(true);
  }

  function handleTextareaFileDragLeave(event: DragEvent<HTMLTextAreaElement>) {
    if (!hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsFileDragActive(false);
  }

  function handleTextareaFileDrop(event: DragEvent<HTMLTextAreaElement>) {
    if (!hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsFileDragActive(false);
    onFileChange(event.dataTransfer.files);
  }

  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition ${classes.ring}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={id}>
          {icon}
          {label}
        </label>
        <div className="flex items-center gap-2">
          {error && <span className="text-sm text-rose-700">{error}</span>}
          <label
            className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 transition ${classes.iconButton}`}
            title={fileInputLabel}
          >
            <Upload className="h-4 w-4" />
            <input
              accept={DOCUMENT_FILE_ACCEPT}
              aria-label={fileInputLabel}
              className="sr-only"
              onChange={(event) => onFileChange(event.target.files)}
              type="file"
            />
          </label>
        </div>
      </div>
      {file && (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <p className={`min-w-0 truncate text-xs font-medium ${classes.fileName}`}>
            Файл: {file.name}
          </p>
          <button
            aria-label={`Убрать файл ${dropLabel}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 transition hover:bg-zinc-100"
            onClick={onClearFile}
            title={`Убрать файл ${dropLabel}`}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <textarea
        className={`min-h-64 w-full resize-y rounded-md border px-3 py-3 text-sm leading-6 outline-none transition focus:bg-white focus:ring-2 ${
          isFileDragActive
            ? classes.drag
            : `border-zinc-200 bg-zinc-50 ${classes.focus}`
        }`}
        id={id}
        onDragEnter={handleTextareaFileDrag}
        onDragLeave={handleTextareaFileDragLeave}
        onDragOver={handleTextareaFileDrag}
        onDrop={handleTextareaFileDrop}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

function findSupportedDocumentFile(files: FileList | File[] | null): File | undefined {
  if (!files) {
    return undefined;
  }

  return Array.from(files).find(isSupportedDocumentFile);
}

function hasFileDragPayload(dataTransfer: DataTransfer): boolean {
  return dataTransfer.files.length > 0 || Array.from(dataTransfer.types).includes("Files");
}

function isSupportedDocumentFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".pdf") || lowerName.endsWith(".docx")) {
    return true;
  }

  return (
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function TestDataFileField({
  accept,
  description,
  label,
  onChange,
  required = false,
}: {
  accept: string;
  description: string;
  label: string;
  onChange: (files: FileList | null) => void;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
      <span className="font-medium">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        accept={accept}
        className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
        onChange={(event) => onChange(event.target.files)}
        required={required}
        type="file"
      />
      <span className="text-xs leading-5 text-zinc-500">{description}</span>
    </label>
  );
}

function AdminFeedbackPanel({
  count,
  error,
  expandedId,
  items,
  onLoad,
  onToggle,
  pending,
}: {
  count: number | null;
  error: string | null;
  expandedId: string | null;
  items: AdminFeedbackSummary[];
  onLoad: () => void;
  onToggle: (id: string) => void;
  pending: boolean;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zinc-700" />
          <h2 className="text-lg font-semibold">Feedback</h2>
        </div>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={pending}
          onClick={onLoad}
          type="button"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Загрузить
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {count !== null && !error && (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          Всего записей: <span className="font-semibold text-zinc-950">{count}</span>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-md border border-zinc-200">
        {items.length === 0 ? (
          <div className="bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
            Feedback не загружен.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {items.map((item) => {
              const isExpanded = expandedId === item.id;

              return (
                <li key={item.id}>
                  <button
                    className="grid w-full gap-2 bg-white px-3 py-3 text-left text-sm hover:bg-zinc-50 md:grid-cols-[minmax(180px,1fr)_120px_120px_80px_auto]"
                    onClick={() => onToggle(item.id)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-zinc-950">{item.id}</span>
                      <span className="block text-xs text-zinc-500">{formatFeedbackDate(item.created_at)}</span>
                    </span>
                    <span className="text-zinc-700">{item.type || "unknown"}</span>
                    <span className="text-zinc-700">{item.api_mode || "unknown"}</span>
                    <span className="text-zinc-700">{item.message_length} симв.</span>
                    <ChevronDown
                      className={`h-4 w-4 justify-self-end text-zinc-500 transition ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="grid gap-3 bg-zinc-50 px-3 py-3 text-sm text-zinc-700 md:grid-cols-2">
                      <FeedbackDetail label="Page" value={item.page} />
                      <FeedbackDetail label="Expected length" value={`${item.expected_length}`} />
                      <FeedbackDetail label="Resume source" value={item.input.resume_source} />
                      <FeedbackDetail label="Vacancy source" value={item.input.vacancy_source} />
                      <FeedbackDetail
                        label="Career strategy"
                        value={item.input.has_career_strategy ? "yes" : "no"}
                      />
                      <FeedbackDetail
                        label="Red flags"
                        value={item.input.has_red_flags ? "yes" : "no"}
                      />
                      <FeedbackDetail
                        label="Match score"
                        value={item.match?.match_score === undefined ? "none" : `${item.match.match_score}`}
                      />
                      <FeedbackDetail
                        label="Recommendation"
                        value={item.match?.recommendation ?? "none"}
                      />
                      <FeedbackDetail
                        label="Matched requirements"
                        value={formatOptionalNumber(item.match?.matched_requirements_count)}
                      />
                      <FeedbackDetail
                        label="Red flags count"
                        value={formatOptionalNumber(item.match?.red_flags_count)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function FeedbackDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs uppercase text-zinc-500">{label}</p>
      <p className="mt-1 break-words font-medium text-zinc-900">{value || "unknown"}</p>
    </div>
  );
}

function FieldHelp({ label, text }: { label: string; text: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-100"
      role="img"
      tabIndex={0}
      title={text}
    >
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  );
}

function upsertAutoVacancySearchSummary(
  current: AutoVacancySearchListResponse | undefined,
  detail: AutoVacancySearchDetail,
): AutoVacancySearchListResponse {
  const summary = toAutoVacancySearchSummary(detail);
  const searches = current?.searches ?? [];
  const existingIndex = searches.findIndex((item) => item.search_id === summary.search_id);

  if (existingIndex === -1) {
    return { searches: [summary, ...searches] };
  }

  return {
    searches: searches.map((item, index) => (index === existingIndex ? summary : item)),
  };
}

function createRunDraftFromSearch(
  search: AutoVacancySearchDetail,
  globalDraft: MatchDraft,
): AutoVacancySearchRunDraft {
  return {
    resumeText: search.resume,
    careerStrategy: search.career_strategy,
    redFlags: search.red_flags,
    source: "linkedin",
    vacancyLimit: search.vacancy_limit,
    locale: search.locale || globalDraft.locale,
    openaiModel: globalDraft.openaiModel,
  };
}

function createAutoSearchDetailFromSummary(
  summary: AutoVacancySearchSummary,
  globalDraft: MatchDraft,
): AutoVacancySearchDetail {
  return {
    search_id: summary.search_id,
    name: summary.name,
    resume: "",
    career_strategy: "",
    red_flags: "",
    vacancy_limit: initialAutoDraft.vacancyLimit,
    locale: globalDraft.locale,
    llm_meta: {
      assumptions: [],
      confidence: "medium",
      missing_inputs: [],
      negative_preferences: [],
    },
    results: [],
    results_count: summary.results_count,
    can_load_more: false,
  };
}

function toAutoVacancySearchSummary(detail: AutoVacancySearchDetail): AutoVacancySearchSummary {
  return {
    search_id: detail.search_id,
    name: detail.name,
    created_at: "",
    results_count: detail.results_count ?? detail.results.length,
  };
}

function canLoadMoreAutoSearch(search: AutoVacancySearchDetail): boolean {
  if (typeof search.can_load_more === "boolean") {
    return search.can_load_more;
  }

  return search.results.length > 0;
}

function formatSearchDate(value: string): string {
  if (!value) {
    return "unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatFeedbackDate(value: string): string {
  if (!value) {
    return "unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "none" : `${value}`;
}

function sourceLabel(source: string): string {
  if (source.toLowerCase() === "linkedin") {
    return "Linkedin";
  }

  return source || "unknown";
}

function scoreToneClass(recommendation: string): string {
  if (recommendation === "apply") {
    return "text-emerald-700";
  }

  if (recommendation === "manual_review") {
    return "text-amber-700";
  }

  return "text-rose-700";
}

function RequirementList({
  title,
  items,
  empty,
}: {
  title: string;
  items: RequirementItem[];
  empty: string;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li
              className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
              key={`${title}-${item.requirement}`}
            >
              <p className="font-medium text-zinc-900">{item.requirement}</p>
              {item.evidence && <p className="mt-1 text-zinc-600">Evidence: {item.evidence}</p>}
              {item.explanation && (
                <p className="mt-1 text-zinc-600">Explanation: {item.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RedFlagList({ items }: { items: RedFlagItem[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-900">Red flags</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Red flags не найдены.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li className="rounded-md bg-amber-50 px-3 py-2 text-sm text-zinc-700" key={item.flag}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-zinc-900">{item.flag}</p>
                <span className="rounded border border-amber-200 bg-white px-2 py-0.5 text-xs font-medium text-amber-800">
                  {item.severity}
                </span>
              </div>
              {item.evidence && <p className="mt-1 text-zinc-600">Evidence: {item.evidence}</p>}
              {item.explanation && (
                <p className="mt-1 text-zinc-600">Explanation: {item.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScoreBreakdownView({ breakdown }: { breakdown: ScoreBreakdown }) {
  const items = [
    ["Base", breakdown.base_match_score],
    ["Red flags", breakdown.red_flags_modifier],
    ["Freshness", breakdown.freshness_modifier],
    ["Final", breakdown.final_score],
  ];

  return (
    <section>
      <h3 className="text-sm font-semibold text-zinc-900">Score breakdown</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {items.map(([label, value]) => (
          <div className="rounded-md bg-zinc-50 px-3 py-2" key={label}>
            <p className="text-xs uppercase text-zinc-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function promptModeLabel(promptMode: MatchDraft["promptMode"]): string {
  if (promptMode === "template") {
    return "Шаблон оценки CV";
  }

  if (promptMode === "manual") {
    return "Промт из test_data";
  }

  return "Генерация промта";
}

function confidenceLabel(confidence: string): string {
  if (confidence === "high") {
    return "высокая";
  }

  if (confidence === "medium") {
    return "средняя";
  }

  return "низкая";
}
