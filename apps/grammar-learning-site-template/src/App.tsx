import type { GrammarReport } from "@mvl/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { loadSiteData, type BuildManifest } from "./data.js";
import { messages, type UiLanguage } from "./i18n/index.js";

type Sentence = GrammarReport["sentences"][number];
type Theme = "system" | "light" | "dark";
type ViewMode = "overview" | "study";

interface ArticleChapter {
  endIndex: number;
  number: string;
  sentenceId: string;
  startIndex: number;
  title: string;
  translation: string | null;
}

const STORAGE_KEY = "kotoba-atlas.preferences.v1";
const UI_LANGUAGES: UiLanguage[] = ["zh-CN", "ja-JP", "en"];
const THEMES: Theme[] = ["system", "light", "dark"];
const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
const FEATURED_ROUTE_HEADINGS = [
  "キャリアの正解の消失に“不安”が膨らむ時代。",
  "前職に不満なし、それでも募った焦り",
  "「手応え」と「成長」が納得感のあるキャリアに",
  "受託、SES、自社プロダクトの三本柱で多様な経験が可能に",
] as const;

function initialParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function initialUiLanguage(): UiLanguage {
  const value = initialParam("ui");
  return UI_LANGUAGES.includes(value as UiLanguage)
    ? (value as UiLanguage)
    : "zh-CN";
}

function initialTheme(): Theme {
  const value = initialParam("theme");
  if (THEMES.includes(value as Theme)) return value as Theme;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as { theme?: unknown };
    return THEMES.includes(stored.theme as Theme)
      ? (stored.theme as Theme)
      : "system";
  } catch {
    return "system";
  }
}

function initialView(): ViewMode {
  const value = initialParam("view");
  if (value === "overview" || value === "study") return value;
  return ["sentence", "grammar", "q", "language", "level"].some(
    (name) => initialParam(name) !== null,
  )
    ? "study"
    : "overview";
}

function formatTime(value: number | null): string {
  if (value === null) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function hasValidTimeRange(sentence: Sentence): boolean {
  return sentence.start !== null && sentence.end !== null;
}

function sentenceSearchText(sentence: Sentence): string {
  return [
    sentence.text,
    sentence.reading ?? "",
    sentence.translation ?? "",
    ...sentence.grammar.flatMap((grammar) => [
      grammar.surface,
      grammar.pattern,
      grammar.meaning,
      grammar.explanation,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function buildArticleChapters(sentences: Sentence[]): ArticleChapter[] {
  const firstSentence = sentences[0];
  if (firstSentence === undefined) return [];

  const featuredStarts = FEATURED_ROUTE_HEADINGS.map((heading) =>
    sentences.findIndex((sentence) => sentence.text === heading),
  ).filter((index) => index >= 0);
  const fallbackStarts = [0, 0.25, 0.5, 0.75].map((position) =>
    Math.min(sentences.length - 1, Math.floor(sentences.length * position)),
  );
  const starts = [
    ...new Set(featuredStarts.length >= 3 ? featuredStarts : fallbackStarts),
  ]
    .toSorted((left, right) => left - right)
    .slice(0, 4);

  return starts.map((startIndex, index) => {
    const sentence = sentences[startIndex] ?? firstSentence;
    const nextStart = starts[index + 1] ?? sentences.length;
    return {
      endIndex: Math.max(startIndex, nextStart - 1),
      number: String(index + 1).padStart(2, "0"),
      sentenceId: sentence.id,
      startIndex,
      title: sentence.text,
      translation: sentence.translation,
    };
  });
}

function rangeLabel(chapter: ArticleChapter): string {
  const start = String(chapter.startIndex + 1).padStart(3, "0");
  const end = String(chapter.endIndex + 1).padStart(3, "0");
  return `S.${start}—${end}`;
}

export function App() {
  const [report, setReport] = useState<GrammarReport | null>(null);
  const [manifest, setManifest] = useState<BuildManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(initialUiLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [view, setView] = useState<ViewMode>(initialView);
  const [query, setQuery] = useState(() => initialParam("q") ?? "");
  const [language, setLanguage] = useState(
    () => initialParam("language") ?? "all",
  );
  const [level, setLevel] = useState(() => initialParam("level") ?? "all");
  const [selectedId, setSelectedId] = useState(
    () => initialParam("sentence") ?? "",
  );
  const [selectedGrammarId, setSelectedGrammarId] = useState(
    () => initialParam("grammar") ?? "",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sentenceDisplayRef = useRef<HTMLDivElement>(null);
  const sentenceStripRef = useRef<HTMLOListElement>(null);
  const activeSentenceButtonRef = useRef<HTMLButtonElement>(null);
  const grammarInspectorRef = useRef<HTMLElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const t = messages[uiLanguage];

  useEffect(() => {
    let active = true;
    void loadSiteData()
      .then((data) => {
        if (!active) return;
        setReport(data.report);
        setManifest(data.manifest);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const levels = useMemo(() => {
    if (report === null) return [];
    return [
      ...new Set(
        report.sentences.flatMap((sentence) =>
          sentence.grammar.map(
            (grammar) => `${grammar.levelSystem}:${grammar.level}`,
          ),
        ),
      ),
    ].toSorted();
  }, [report]);

  const filtered = useMemo(() => {
    if (report === null) return [];
    return report.sentences.filter((sentence) => {
      if (
        language !== "all" &&
        sentence.language !== language &&
        !sentence.languages.includes(language as Sentence["language"])
      ) {
        return false;
      }
      if (
        level !== "all" &&
        !sentence.grammar.some(
          (grammar) => `${grammar.levelSystem}:${grammar.level}` === level,
        )
      ) {
        return false;
      }
      return (
        normalizedQuery === "" ||
        sentenceSearchText(sentence).includes(normalizedQuery)
      );
    });
  }, [language, level, normalizedQuery, report]);

  useEffect(() => {
    const firstSentence = filtered[0];
    if (firstSentence === undefined) return;
    if (!filtered.some((sentence) => sentence.id === selectedId)) {
      setSelectedId(firstSentence.id);
      setSelectedGrammarId(firstSentence.grammar[0]?.id ?? "");
    }
  }, [filtered, selectedId]);

  const selected =
    filtered.find((sentence) => sentence.id === selectedId) ??
    filtered[0] ??
    null;
  const activeGrammar =
    selected?.grammar.find((grammar) => grammar.id === selectedGrammarId) ??
    selected?.grammar[0] ??
    null;
  const chapters = useMemo(
    () => buildArticleChapters(report?.sentences ?? []),
    [report],
  );
  const timedSentences = filtered.filter(hasValidTimeRange);
  const reportHasTimedSentences =
    report?.sentences.some(hasValidTimeRange) ?? false;

  useEffect(() => {
    const strip = sentenceStripRef.current;
    const activeButton = activeSentenceButtonRef.current;
    if (strip === null || activeButton === null) return;

    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeButton.getBoundingClientRect();
    const activeCenterInContent =
      activeRect.left -
      stripRect.left +
      strip.scrollLeft +
      activeRect.width / 2;
    const desiredLeft = activeCenterInContent - strip.clientWidth / 2;
    const maxLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
    strip.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      left: Math.min(maxLeft, Math.max(0, desiredLeft)),
    });
  }, [filtered.length, selected?.id]);

  useEffect(() => {
    document.documentElement.lang = uiLanguage;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));

    const params = new URLSearchParams();
    if (uiLanguage !== "zh-CN") params.set("ui", uiLanguage);
    if (theme !== "system") params.set("theme", theme);
    if (view === "study") {
      params.set("view", "study");
      if (query !== "") params.set("q", query);
      if (language !== "all") params.set("language", language);
      if (level !== "all") params.set("level", level);
      if (selected?.id !== undefined) params.set("sentence", selected.id);
      if (activeGrammar !== null) params.set("grammar", activeGrammar.id);
    }
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${suffix}`,
    );
  }, [
    activeGrammar,
    language,
    level,
    query,
    selected,
    theme,
    uiLanguage,
    view,
  ]);

  useEffect(() => {
    if (report === null) return;
    const pageTitle = report.source.title ?? report.sentences[0]?.text;
    document.title = pageTitle ? `${pageTitle} — Kotoba Atlas` : "Kotoba Atlas";
  }, [report]);

  const selectSentence = (sentence: Sentence, reveal = false): void => {
    setSelectedId(sentence.id);
    setSelectedGrammarId(sentence.grammar[0]?.id ?? "");
    if (videoRef.current !== null && sentence.start !== null) {
      videoRef.current.currentTime = sentence.start;
    }
    if (reveal) {
      window.requestAnimationFrame(() => {
        sentenceDisplayRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      });
    }
  };

  const selectGrammar = (grammarId: string): void => {
    setSelectedGrammarId(grammarId);
    if (window.matchMedia("(max-width: 980px)").matches) {
      window.requestAnimationFrame(() => {
        grammarInspectorRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      });
    }
  };

  const clearFilters = (): void => {
    setQuery("");
    setLanguage("all");
    setLevel("all");
  };

  const changeView = (nextView: ViewMode): void => {
    setView(nextView);
    window.scrollTo({ top: 0 });
  };

  const openChapter = (chapter: ArticleChapter): void => {
    clearFilters();
    const sentence = report?.sentences[chapter.startIndex];
    if (sentence !== undefined) selectSentence(sentence);
    changeView("study");
  };

  if (error !== null) {
    return (
      <main className="status-screen" role="alert">
        <p className="eyebrow">Kotoba Atlas / Error</p>
        <h1>{t.loadError}</h1>
        <code>{error}</code>
      </main>
    );
  }
  if (report === null || manifest === null) {
    return (
      <main className="status-screen" aria-live="polite">
        <p className="eyebrow">Kotoba Atlas / Loading</p>
        <h1>{t.loading}</h1>
      </main>
    );
  }

  const heroTitle = report.sentences[0]?.text ?? "Multilingual Grammar Study";
  const heroSubtitle = report.sentences[1]?.text ?? report.source.title;
  const heroDeck =
    report.sentences[1]?.translation ??
    report.sentences[0]?.translation ??
    t.tagline;
  const selectedPosition =
    selected === null
      ? 0
      : report.sentences.findIndex((item) => item.id === selected.id) + 1;
  const filteredPosition =
    selected === null
      ? -1
      : filtered.findIndex((item) => item.id === selected.id);
  const currentChapter =
    chapters.find(
      (chapter) =>
        selectedPosition - 1 >= chapter.startIndex &&
        selectedPosition - 1 <= chapter.endIndex,
    ) ?? chapters[0];
  const activeGrammarPosition =
    activeGrammar === null || selected === null
      ? 0
      : selected.grammar.findIndex((item) => item.id === activeGrammar.id) + 1;
  const maxJlptCount = Math.max(
    1,
    ...JLPT_LEVELS.map(
      (item) => report.summary.levelCounts[`JLPT:${item}`] ?? 0,
    ),
  );
  const unmappedCount = report.summary.levelCounts["unknown:unmapped"] ?? 0;
  const dominantLanguage = Object.entries(
    report.summary.languageCounts,
  ).toSorted((left, right) => right[1] - left[1])[0]?.[0];
  const languageProfile =
    dominantLanguage === "ja"
      ? t.japaneseLed
      : `${dominantLanguage ?? "—"} · ${report.languages.join(" / ")}`;
  const sentenceDensity =
    selected === null
      ? "standard"
      : selected.text.length >= 80
        ? "compact"
        : selected.text.length >= 45
          ? "long"
          : "standard";

  const moveSentence = (offset: -1 | 1): void => {
    const sentence = filtered[filteredPosition + offset];
    if (sentence !== undefined) selectSentence(sentence, true);
  };

  return (
    <div className="app-shell" data-view={view}>
      <a className="skip-link" href="#main-content">
        {t.skipToContent}
      </a>

      <header className="topbar">
        <button
          className="wordmark"
          type="button"
          onClick={() => changeView("overview")}
          aria-label="Kotoba Atlas home"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
          </span>
          <span className="brand-copy">
            <strong>KOTOBA / ATLAS</strong>
            <small>{t.tagline}</small>
          </span>
        </button>

        <nav aria-label="Primary">
          <button
            type="button"
            className={view === "overview" ? "active" : ""}
            aria-current={view === "overview" ? "page" : undefined}
            onClick={() => changeView("overview")}
          >
            {t.overview}
          </button>
          <button
            type="button"
            className={view === "study" ? "active" : ""}
            aria-current={view === "study" ? "page" : undefined}
            onClick={() => changeView("study")}
          >
            {t.grammarNotes}
          </button>
          {view === "study" && timedSentences.length > 0 ? (
            <a href="#timeline">{t.timeline}</a>
          ) : null}
        </nav>

        <div className="top-controls">
          <label>
            <span className="sr-only">UI language</span>
            <select
              data-testid="ui-language"
              aria-label="UI language"
              value={uiLanguage}
              onChange={(event) =>
                setUiLanguage(event.target.value as UiLanguage)
              }
            >
              <option value="zh-CN">中</option>
              <option value="ja-JP">日</option>
              <option value="en">EN</option>
            </select>
          </label>
          <label>
            <span className="sr-only">{t.theme}</span>
            <select
              data-testid="theme"
              aria-label={t.theme}
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="system">{t.system}</option>
              <option value="light">{t.light}</option>
              <option value="dark">{t.dark}</option>
            </select>
          </label>
        </div>
      </header>

      {view === "overview" ? (
        <main className="overview-page" id="main-content">
          <div
            className="registration-mark registration-mark-a"
            aria-hidden="true"
          />
          <div
            className="registration-mark registration-mark-b"
            aria-hidden="true"
          />

          <section className="overview-hero" aria-labelledby="article-title">
            <div className="hero-copy">
              <div className="hero-notation">
                <span>
                  FIELD NOTE / {report.analysis.generatedAt.slice(0, 4)}
                </span>
                <span>
                  {report.source.type.toUpperCase()} ·{" "}
                  {report.explanationLanguage}
                </span>
              </div>
              <h1 id="article-title">{heroTitle}</h1>
              {heroSubtitle === null ? null : (
                <p className="hero-subtitle">{heroSubtitle}</p>
              )}
              <p className="hero-deck">{heroDeck}</p>
              <button
                className="primary-action"
                type="button"
                onClick={() => changeView("study")}
              >
                <span>{t.startReading}</span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>

            <section className="route-map" aria-labelledby="route-title">
              <header>
                <p className="eyebrow" id="route-title">
                  {t.articleRoute}
                </p>
                <span>01—{String(chapters.length).padStart(2, "0")}</span>
              </header>
              <ol>
                {chapters.map((chapter) => (
                  <li key={chapter.sentenceId}>
                    <button type="button" onClick={() => openChapter(chapter)}>
                      <span className="route-number">{chapter.number}</span>
                      <span className="route-copy">
                        <strong>{chapter.title}</strong>
                        <small>{chapter.translation}</small>
                      </span>
                      <span className="route-range">{rangeLabel(chapter)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </section>

          <section className="overview-ledger" aria-label={t.articleFacts}>
            <div className="metric-pair">
              <article>
                <span className="metric-code">SENTENCE / TOTAL</span>
                <strong>
                  {String(report.summary.sentenceCount).padStart(3, "0")}
                </strong>
                <p>{t.sentences}</p>
              </article>
              <article>
                <span className="metric-code">GRAMMAR / TOTAL</span>
                <strong>
                  {String(report.summary.grammarPointCount).padStart(3, "0")}
                </strong>
                <p>{t.grammarNotes}</p>
              </article>
            </div>

            <section className="article-facts">
              <p className="eyebrow">{t.articleFacts}</p>
              <dl>
                <div>
                  <dt>{t.articleFormat}</dt>
                  <dd>{t.interviewArticle}</dd>
                </div>
                <div>
                  <dt>{t.primaryLanguage}</dt>
                  <dd>{languageProfile}</dd>
                </div>
                <div>
                  <dt>{t.topics}</dt>
                  <dd>{t.topicSummary}</dd>
                </div>
                <div>
                  <dt>{t.difficultyRange}</dt>
                  <dd>JLPT N5—N1</dd>
                </div>
              </dl>
            </section>

            <section className="level-distribution">
              <header>
                <p className="eyebrow">{t.grammarDistribution}</p>
                <span>{report.summary.grammarPointCount} PT</span>
              </header>
              <ol>
                {JLPT_LEVELS.map((item) => {
                  const count = report.summary.levelCounts[`JLPT:${item}`] ?? 0;
                  return (
                    <li key={item}>
                      <span>{item}</span>
                      <div aria-hidden="true">
                        <i
                          style={{ width: `${(count / maxJlptCount) * 100}%` }}
                        />
                      </div>
                      <strong>{String(count).padStart(2, "0")}</strong>
                    </li>
                  );
                })}
              </ol>
              <p className="unmapped-note">
                {t.unmapped} / {String(unmappedCount).padStart(2, "0")}
              </p>
            </section>
          </section>
        </main>
      ) : (
        <main className="study-page" id="main-content">
          <section className="study-command" aria-label={t.filters}>
            <div className="command-identity">
              <p className="eyebrow">{t.studyDesk}</p>
              <strong>{heroTitle}</strong>
            </div>
            <div
              className={`command-fields${filtersOpen ? " filters-open" : ""}`}
            >
              <label className="search-control">
                <span>{t.search}</span>
                <input
                  data-testid="search"
                  type="search"
                  value={query}
                  placeholder={t.searchPlaceholder}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="filter-options" id="study-filter-options">
                <label>
                  <span>{t.language}</span>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    <option value="all">{t.all}</option>
                    {report.languages.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t.level}</span>
                  <select
                    value={level}
                    onChange={(event) => setLevel(event.target.value)}
                  >
                    <option value="all">{t.all}</option>
                    {levels.map((item) => (
                      <option key={item} value={item}>
                        {item.replace(":", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="clear-command"
                  type="button"
                  onClick={clearFilters}
                  title={t.clearFilters}
                >
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">{t.clearFilters}</span>
                </button>
              </div>
            </div>
            <button
              className="mobile-filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="study-filter-options"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <span>{t.filters}</span>
              <strong>
                {t.filterSummary(filtered.length, report.sentences.length)}
              </strong>
              <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
            </button>
            <div className="command-pagination">
              <span aria-live="polite">
                {t.filterSummary(filtered.length, report.sentences.length)}
              </span>
              <div>
                <button
                  type="button"
                  disabled={filteredPosition <= 0}
                  onClick={() => moveSentence(-1)}
                  aria-label={t.previous}
                >
                  <span aria-hidden="true">←</span>
                  <span className="pagination-label">{t.previous}</span>
                </button>
                <span className="pagination-position" aria-live="polite">
                  {String(selectedPosition).padStart(3, "0")} /{" "}
                  {String(report.sentences.length).padStart(3, "0")}
                </span>
                <button
                  type="button"
                  disabled={
                    filteredPosition < 0 ||
                    filteredPosition >= filtered.length - 1
                  }
                  onClick={() => moveSentence(1)}
                  aria-label={t.next}
                >
                  <span className="pagination-label">{t.next}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </section>

          {selected === null ? (
            <div className="empty-state">
              <p>{t.noMatches}</p>
              <button type="button" onClick={clearFilters}>
                {t.clearFilters}
              </button>
            </div>
          ) : (
            <>
              <div className="study-layout">
                <aside
                  className="article-route-rail"
                  aria-label={t.articleNavigator}
                >
                  <p>{t.articleNavigator}</p>
                  <ol>
                    {chapters.map((chapter) => (
                      <li key={chapter.sentenceId}>
                        <button
                          type="button"
                          className={
                            chapter.sentenceId === currentChapter?.sentenceId
                              ? "active"
                              : ""
                          }
                          onClick={() => openChapter(chapter)}
                          aria-current={
                            chapter.sentenceId === currentChapter?.sentenceId
                              ? "step"
                              : undefined
                          }
                          aria-label={`${t.openChapter}: ${chapter.title}`}
                          title={chapter.title}
                        >
                          <span>{chapter.number}</span>
                          <i aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <span className="rail-coordinate">
                    {String(selectedPosition).padStart(3, "0")}
                  </span>
                </aside>

                <article className="reader-canvas">
                  <header className="sentence-meta">
                    <p>
                      {t.sentence} {String(selectedPosition).padStart(3, "0")} /{" "}
                      {String(report.sentences.length).padStart(3, "0")}
                    </p>
                    <p>
                      {hasValidTimeRange(selected)
                        ? `${formatTime(selected.start)}—${formatTime(selected.end)} · `
                        : ""}
                      {selected.languages.join(" · ")}
                    </p>
                  </header>

                  {manifest.videoRelativePath === null ||
                  !reportHasTimedSentences ? null : (
                    <video
                      ref={videoRef}
                      className="source-video"
                      controls
                      preload="metadata"
                      src={manifest.videoRelativePath}
                    />
                  )}

                  <div
                    className="sentence-display"
                    data-density={sentenceDensity}
                    ref={sentenceDisplayRef}
                  >
                    <p className="chapter-label">
                      {t.chapter} {currentChapter?.number ?? "—"} /{" "}
                      {currentChapter?.title ?? heroTitle}
                    </p>
                    <p className="reading-line">
                      {selected.reading ?? t.noReading}
                    </p>
                    <h1>{selected.text}</h1>
                    <div
                      className="grammar-strip"
                      aria-label={t.notesForSentence}
                    >
                      {selected.grammar.map((grammar, index) => (
                        <button
                          key={grammar.id}
                          type="button"
                          className={
                            grammar.id === activeGrammar?.id ? "active" : ""
                          }
                          aria-pressed={grammar.id === activeGrammar?.id}
                          onClick={() => selectGrammar(grammar.id)}
                        >
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{grammar.surface}</strong>
                          <small>{grammar.category}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  <dl className="translation-block">
                    <div>
                      <dt>{t.translation}</dt>
                      <dd>{selected.translation ?? t.noTranslation}</dd>
                    </div>
                    <div>
                      <dt>{t.reading}</dt>
                      <dd>{selected.reading ?? t.noReading}</dd>
                    </div>
                  </dl>

                  {selected.needsReview ? (
                    <p className="warning" role="status">
                      {t.reconstructionReview}
                    </p>
                  ) : null}
                  {selected.reconstructionConfidence < 0.75 ? (
                    <p className="warning" role="status">
                      {t.lowConfidence}
                    </p>
                  ) : null}

                  <nav className="sentence-strip" aria-label={t.sentences}>
                    <span>{t.sentences}</span>
                    <ol ref={sentenceStripRef}>
                      {filtered.map((sentence) => {
                        const position =
                          report.sentences.findIndex(
                            (item) => item.id === sentence.id,
                          ) + 1;
                        return (
                          <li key={sentence.id}>
                            <button
                              ref={
                                sentence.id === selected.id
                                  ? activeSentenceButtonRef
                                  : undefined
                              }
                              type="button"
                              className={
                                sentence.id === selected.id ? "selected" : ""
                              }
                              aria-current={
                                sentence.id === selected.id ? "true" : undefined
                              }
                              onClick={() => selectSentence(sentence, true)}
                              aria-label={`${t.sentence} ${position}: ${sentence.text}`}
                              title={sentence.text}
                            >
                              {String(position).padStart(3, "0")}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </nav>
                </article>

                <aside
                  className="grammar-inspector"
                  aria-label={t.grammarNotes}
                  ref={grammarInspectorRef}
                >
                  <header className="inspector-heading">
                    <div>
                      <p className="eyebrow">{t.notesForSentence}</p>
                      <span>{selected.grammar.length} PT</span>
                    </div>
                    <strong>
                      {String(activeGrammarPosition).padStart(2, "0")} /{" "}
                      {String(selected.grammar.length).padStart(2, "0")}
                    </strong>
                  </header>

                  {activeGrammar === null ? (
                    <div className="inspector-empty">
                      <span>00</span>
                      <p>{t.noExamples}</p>
                    </div>
                  ) : (
                    <article className="grammar-card" id={activeGrammar.id}>
                      <header>
                        <span className="grammar-coordinate">
                          G.{String(activeGrammarPosition).padStart(2, "0")}
                        </span>
                        <div>
                          <h2>{activeGrammar.surface}</h2>
                          <p>
                            {activeGrammar.pattern} ·{" "}
                            {activeGrammar.levelSystem} {activeGrammar.level}
                          </p>
                        </div>
                      </header>
                      <p className="grammar-explanation">
                        {activeGrammar.explanation}
                      </p>
                      <dl>
                        <div>
                          <dt>{t.formation}</dt>
                          <dd>{activeGrammar.formation}</dd>
                        </div>
                        <div>
                          <dt>{t.meaning}</dt>
                          <dd>{activeGrammar.meaning}</dd>
                        </div>
                        <div>
                          <dt>{t.nuance}</dt>
                          <dd>{activeGrammar.nuance ?? "—"}</dd>
                        </div>
                        {activeGrammar.context === null ? null : (
                          <div>
                            <dt>{t.context}</dt>
                            <dd>{activeGrammar.context}</dd>
                          </div>
                        )}
                        <div>
                          <dt>{t.confidence}</dt>
                          <dd>{Math.round(activeGrammar.confidence * 100)}%</dd>
                        </div>
                      </dl>
                      {activeGrammar.confidence < 0.7 ? (
                        <p className="warning">{t.lowConfidence}</p>
                      ) : null}
                      <section className="examples-panel">
                        <h3>{t.examples}</h3>
                        {activeGrammar.examples.length === 0 ? (
                          <p className="muted">{t.noExamples}</p>
                        ) : (
                          <ul>
                            {activeGrammar.examples.map((example) => (
                              <li key={`${activeGrammar.id}-${example.text}`}>
                                <strong>{example.text}</strong>
                                {example.reading === null ? null : (
                                  <small>{example.reading}</small>
                                )}
                                <span>{example.translation ?? "—"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </article>
                  )}

                  <section className="vocabulary-panel">
                    <h3>{t.vocabulary}</h3>
                    {selected.vocabulary.length === 0 ? (
                      <p className="muted">{t.noVocabulary}</p>
                    ) : (
                      <dl>
                        {selected.vocabulary.map((word) => (
                          <div key={`${word.language}-${word.surface}`}>
                            <dt>{word.surface}</dt>
                            <dd>
                              {word.reading ?? "—"} · {word.meaning}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                </aside>
              </div>

              <nav className="mobile-reading-dock" aria-label={t.sentences}>
                <button
                  type="button"
                  disabled={filteredPosition <= 0}
                  onClick={() => moveSentence(-1)}
                >
                  <span aria-hidden="true">←</span>
                  <span>{t.previous}</span>
                </button>
                <button
                  className="dock-position"
                  type="button"
                  onClick={() => changeView("overview")}
                  aria-label={t.overview}
                >
                  <strong>
                    {String(selectedPosition).padStart(3, "0")} /{" "}
                    {String(report.sentences.length).padStart(3, "0")}
                  </strong>
                  <small>{t.overview}</small>
                </button>
                <button
                  type="button"
                  disabled={
                    filteredPosition < 0 ||
                    filteredPosition >= filtered.length - 1
                  }
                  onClick={() => moveSentence(1)}
                >
                  <span>{t.next}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </nav>
            </>
          )}

          {timedSentences.length === 0 ? null : (
            <footer className="timeline" id="timeline" aria-label={t.timeline}>
              <strong>{t.timeline}</strong>
              <ol>
                {timedSentences.map((sentence, index) => (
                  <li key={sentence.id}>
                    <button
                      type="button"
                      className={sentence.id === selected?.id ? "selected" : ""}
                      onClick={() => selectSentence(sentence, true)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{sentence.text}</strong>
                      <small>{formatTime(sentence.start)}</small>
                    </button>
                  </li>
                ))}
              </ol>
            </footer>
          )}
        </main>
      )}
    </div>
  );
}
