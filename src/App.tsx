import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { SourceDialog } from "./components/SourceDialog";
import { pickCaptureLogSource } from "./lib/tauri";
import { LiveQueriesPage } from "./pages/LiveQueriesPage";
import { DEFAULT_SOURCE_DRAFT } from "./types/queries";
import type { SourceDraft, SourceProfile } from "./types/queries";

const SAVED_SOURCES_KEY = "postgres-profiler.saved-sources";

function loadSavedSources(): SourceProfile[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(SAVED_SOURCES_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is SourceProfile => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        typeof item.logPath === "string" &&
        typeof item.lastUsedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function sortSources(sources: SourceProfile[]) {
  return [...sources].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
}

function buildSourceProfile(draft: SourceDraft): SourceProfile {
  return {
    id: draft.id ?? crypto.randomUUID(),
    label: draft.label.trim(),
    logPath: draft.logPath.trim(),
    lastUsedAt: new Date().toISOString(),
  };
}

export default function App() {
  const [savedSources, setSavedSources] = useState<SourceProfile[]>(() => sortSources(loadSavedSources()));
  const [activeSourceId, setActiveSourceId] = useState<string | null>(savedSources[0]?.id ?? null);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [isSourceDialogOpen, setIsSourceDialogOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>(DEFAULT_SOURCE_DRAFT);
  const [sourceDialogError, setSourceDialogError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(SAVED_SOURCES_KEY, JSON.stringify(savedSources));
  }, [savedSources]);

  useEffect(() => {
    if (savedSources.length === 0) {
      setActiveSourceId(null);
      return;
    }

    if (!activeSourceId || !savedSources.some((source) => source.id === activeSourceId)) {
      setActiveSourceId(savedSources[0].id);
    }
  }, [activeSourceId, savedSources]);

  const activeSource = useMemo(
    () => savedSources.find((source) => source.id === activeSourceId) ?? null,
    [activeSourceId, savedSources],
  );

  function handleOpenNewSource() {
    setSourceDraft(DEFAULT_SOURCE_DRAFT);
    setSourceDialogError(null);
    setIsSourceDialogOpen(true);
  }

  function handleOpenEditSource() {
    if (!activeSource) {
      return;
    }

    setSourceDraft({
      id: activeSource.id,
      label: activeSource.label,
      logPath: activeSource.logPath,
    });
    setSourceDialogError(null);
    setIsSourceDialogOpen(true);
  }

  async function handleBrowseSourcePath() {
    try {
      const selectedPath = await pickCaptureLogSource(sourceDraft.logPath || undefined);

      if (typeof selectedPath === "string" && selectedPath.trim()) {
        setSourceDraft((current) => ({
          ...current,
          logPath: selectedPath,
        }));
      }
    } catch (error) {
      setSourceDialogError(error instanceof Error ? error.message : "Could not browse for a log file.");
    }
  }

  async function handleSaveSource(draft: SourceDraft) {
    const nextLabel = draft.label.trim();
    const nextPath = draft.logPath.trim();

    if (!nextLabel) {
      setSourceDialogError("Source name is required.");
      return;
    }

    if (!nextPath) {
      setSourceDialogError("Log file path is required.");
      return;
    }

    const nextSource = buildSourceProfile({
      ...draft,
      label: nextLabel,
      logPath: nextPath,
    });

    setSavedSources((current) =>
      sortSources([nextSource, ...current.filter((source) => source.id !== nextSource.id)]),
    );
    setActiveSourceId(nextSource.id);
    setSourceDialogError(null);
    setIsSourceDialogOpen(false);
  }

  function handleSelectSource(source: SourceProfile) {
    setActiveSourceId(source.id);
  }

  function handleUpdateActiveSourcePath(logPath: string) {
    if (!activeSourceId) {
      return;
    }

    setSavedSources((current) =>
      current.map((source) =>
        source.id === activeSourceId
          ? {
              ...source,
              logPath,
            }
          : source,
      ),
    );
  }

  function handleDeleteSource(sourceId: string) {
    setSavedSources((current) => current.filter((source) => source.id !== sourceId));

    if (activeSourceId === sourceId) {
      setActiveSourceId(null);
    }

    if (runningSourceId === sourceId) {
      setRunningSourceId(null);
    }
  }

  return (
    <main className="monitor-shell">
      <AppSidebar
        activeSource={activeSource}
        onNewSource={handleOpenNewSource}
        onSelectSource={handleSelectSource}
        runningSourceId={runningSourceId}
        savedSources={savedSources}
      />

      <div className="monitor-main-pane">
        <LiveQueriesPage
          activeSource={activeSource}
          onAddSource={handleOpenNewSource}
          onDeleteSource={handleDeleteSource}
          onEditSource={handleOpenEditSource}
          onRunningSourceChange={setRunningSourceId}
          onSourcePathChange={handleUpdateActiveSourcePath}
        />
      </div>

      <SourceDialog
        errorMessage={sourceDialogError}
        isOpen={isSourceDialogOpen}
        onBrowse={() => {
          void handleBrowseSourcePath();
        }}
        onChange={setSourceDraft}
        onClose={() => {
          setIsSourceDialogOpen(false);
          setSourceDialogError(null);
        }}
        onSubmit={handleSaveSource}
        value={sourceDraft}
      />
    </main>
  );
}
