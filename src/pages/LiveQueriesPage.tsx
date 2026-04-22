import { useEffect, useMemo, useRef, useState } from "react";
import { FiltersBar } from "../components/FiltersBar";
import { QueryDetailsPanel } from "../components/QueryDetailsPanel";
import { QueryTable } from "../components/QueryTable";
import { usePolling } from "../hooks/usePolling";
import { useQueryFilters } from "../hooks/useQueryFilters";
import {
  clearCapturedQueries,
  fetchCapturedQueries,
  getCaptureStatus,
  inspectCaptureSource,
  pickCaptureLogSource,
  startCapture,
  stopCapture,
} from "../lib/tauri";
import { DEFAULT_FILTERS } from "../types/queries";
import type {
  CaptureSourcePreview,
  CaptureStatus,
  CapturedQuery,
  PersistedQuery,
  QueryFilters,
  SourceProfile,
} from "../types/queries";

type LiveQueriesPageProps = {
  activeSource: SourceProfile | null;
  onAddSource: () => void;
  onDeleteSource: (sourceId: string) => void;
  onEditSource: () => void;
  onRunningSourceChange: (sourceId: string | null) => void;
  onSourcePathChange: (value: string) => void;
};

type SourceViewState = {
  readExisting: boolean;
  startAfterCaptureId: number;
};

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Could not load queries.";
}

function formatObservedAt(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseSortTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getQuerySortRank(query: PersistedQuery) {
  const queryStart = parseSortTimestamp(query.queryStart);
  if (queryStart !== null) {
    return queryStart;
  }

  const captureId = Number(query.id.split(":")[1] ?? 0);
  if (!Number.isNaN(captureId)) {
    return captureId;
  }

  return query.pid;
}

function mapCapturedQuery(query: CapturedQuery): PersistedQuery {
  const displayState = query.state?.trim() ? query.state : "Logged";

  return {
    ...query,
    id: `captured:${query.captureId}`,
    isError: /error|fatal|panic/i.test(displayState),
    displayState,
    sourceId: query.sourceId,
    sourceLabel: query.sourceLabel,
    sourcePath: query.sourcePath,
  };
}

function parseDurationMs(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  const msMatch = trimmed.match(/^([\d.]+)\s*ms$/);
  if (msMatch) {
    return Number(msMatch[1]);
  }

  const secondsMatch = trimmed.match(/^([\d.]+)\s*s(ec)?$/);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  const dayMatch = trimmed.match(/^(?:(\d+)\s+day[s]?\s+)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (dayMatch) {
    const days = Number(dayMatch[1] ?? 0);
    const hours = Number(dayMatch[2]);
    const minutes = Number(dayMatch[3]);
    const seconds = Number(dayMatch[4]);

    return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  }

  return null;
}

function formatMetricDuration(value: number | null) {
  if (value === null) {
    return "-";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }

  return `${value.toFixed(1)}ms`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function LiveQueriesPage({
  activeSource,
  onAddSource,
  onDeleteSource,
  onEditSource,
  onRunningSourceChange,
  onSourcePathChange,
}: LiveQueriesPageProps) {
  const [queries, setQueries] = useState<PersistedQuery[]>([]);
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [filters, setFilters] = useState<QueryFilters>(DEFAULT_FILTERS);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(1000);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [readExistingFile, setReadExistingFile] = useState(false);
  const [sourceViewState, setSourceViewState] = useState<Record<string, SourceViewState>>({});
  const [sourcePreview, setSourcePreview] = useState<CaptureSourcePreview | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>({
    isRunning: false,
    logPath: null,
    resolvedLogPath: null,
    resolvedLogFormat: null,
    resolvedFileSizeBytes: null,
    resolvedFileModifiedAtMs: null,
    sourceId: null,
    sourceLabel: null,
    readExisting: false,
    startAfterCaptureId: null,
  });
  const [isCaptureBusy, setIsCaptureBusy] = useState(false);
  const [isDeletingSource, setIsDeletingSource] = useState(false);
  const capturedFetchingRef = useRef(false);
  const hasLoadedSourceRef = useRef(false);
  const activeSourceIdRef = useRef<string | null>(activeSource?.id ?? null);

  useEffect(() => {
    activeSourceIdRef.current = activeSource?.id ?? null;
  }, [activeSource?.id]);

  function applyCaptureStatus(status: CaptureStatus) {
    setCaptureStatus(status);
    onRunningSourceChange(status.isRunning ? status.sourceId : null);

    if (status.isRunning) {
      setReadExistingFile(status.readExisting);
    }

    if (status.sourceId && status.startAfterCaptureId !== null) {
      const sourceId = status.sourceId;
      const startAfterCaptureId = status.startAfterCaptureId;

      setSourceViewState((current) => ({
        ...current,
        [sourceId]: {
          readExisting: status.readExisting,
          startAfterCaptureId,
        },
      }));
    }
  }

  const isCurrentSourceRunning = Boolean(
    activeSource &&
      captureStatus.isRunning &&
      captureStatus.sourceId === activeSource.id,
  );

  async function loadSourceQueries() {
    if (!activeSource || capturedFetchingRef.current) {
      return;
    }

    const sourceId = activeSource.id;
    capturedFetchingRef.current = true;
    if (!hasLoadedSourceRef.current) {
      setIsLoading(true);
    }

    try {
      const nextQueries = await fetchCapturedQueries(sourceId);
      const observedAt = formatObservedAt(new Date());

      if (activeSourceIdRef.current !== sourceId) {
        return;
      }

      setQueries((currentQueries) => {
        return nextQueries.map(mapCapturedQuery);
      });

      hasLoadedSourceRef.current = true;
      setLastUpdatedAt(observedAt);
      setLoadError(null);
    } catch (error) {
      setLoadError(toErrorMessage(error));
    } finally {
      capturedFetchingRef.current = false;
      setIsLoading(false);
    }
  }

  usePolling(loadSourceQueries, {
    enabled: Boolean(activeSource) && !isPaused,
    intervalMs: refreshIntervalMs,
  });

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      try {
        const status = await getCaptureStatus();

        if (!isMounted) {
          return;
        }

        applyCaptureStatus(status);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setLoadError(toErrorMessage(error));
      }
    }

    void loadStatus();

    return () => {
      isMounted = false;
    };
  }, [onRunningSourceChange]);

  useEffect(() => {
    if (!activeSource) {
      setQueries([]);
      setSelectedQueryId(null);
      setIsDetailsOpen(false);
      setLastUpdatedAt(null);
      setLoadError(null);
      setSourcePreview(null);
      setSourcePreviewError(null);
      hasLoadedSourceRef.current = false;
      return;
    }

    hasLoadedSourceRef.current = false;
    void loadSourceQueries();
  }, [activeSource?.id]);

  useEffect(() => {
    let isMounted = true;

    async function loadPreview() {
      if (!activeSource?.logPath.trim()) {
        if (!isMounted) {
          return;
        }

        setSourcePreview(null);
        setSourcePreviewError(null);
        return;
      }

      try {
        const preview = await inspectCaptureSource(activeSource.logPath.trim());

        if (!isMounted) {
          return;
        }

        setSourcePreview(preview);
        setSourcePreviewError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setSourcePreview(null);
        setSourcePreviewError(toErrorMessage(error));
      }
    }

    void loadPreview();

    return () => {
      isMounted = false;
    };
  }, [activeSource?.id, activeSource?.logPath]);

  useEffect(() => {
    let isMounted = true;

    async function refreshStatus() {
      try {
        const status = await getCaptureStatus();

        if (!isMounted) {
          return;
        }

        applyCaptureStatus(status);
      } catch {
        // keep the last known status if status refresh fails during source switches
      }
    }

    void refreshStatus();

    return () => {
      isMounted = false;
    };
  }, [activeSource?.id]);

  const latestFirstQueries = useMemo(() => {
    return [...queries].sort((left, right) => {
      const rankDelta = getQuerySortRank(right) - getQuerySortRank(left);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      return right.pid - left.pid;
    });
  }, [queries]);

  const sessionVisibleQueries = useMemo(() => {
    if (!activeSource) {
      return latestFirstQueries;
    }

    const currentViewState = sourceViewState[activeSource.id];

    if (!currentViewState || currentViewState.readExisting) {
      return latestFirstQueries;
    }

    return latestFirstQueries.filter((query) => {
      const captureId = Number(query.id.split(":")[1] ?? 0);
      return !Number.isNaN(captureId) && captureId > currentViewState.startAfterCaptureId;
    });
  }, [activeSource, latestFirstQueries, sourceViewState]);

  useEffect(() => {
    if (sessionVisibleQueries.length === 0) {
      setSelectedQueryId(null);
      setIsDetailsOpen(false);
      return;
    }

    if (selectedQueryId === null) {
      setSelectedQueryId(sessionVisibleQueries[0].id);
      return;
    }

    if (!sessionVisibleQueries.some((query) => query.id === selectedQueryId)) {
      setSelectedQueryId(sessionVisibleQueries[0].id);
      setIsDetailsOpen(false);
    }
  }, [selectedQueryId, sessionVisibleQueries]);

  async function handleBrowseSourcePath() {
    if (!activeSource) {
      return;
    }

    try {
      const selectedPath = await pickCaptureLogSource(activeSource.logPath || undefined);

      if (typeof selectedPath === "string" && selectedPath.trim()) {
        onSourcePathChange(selectedPath);
      }
    } catch (error) {
      setLoadError(toErrorMessage(error));
    }
  }

  async function handleStartCapture() {
    if (!activeSource) {
      return;
    }

    setIsCaptureBusy(true);
    setLoadError(null);

    try {
      const status = await startCapture({
        sourceId: activeSource.id,
        sourceLabel: activeSource.label,
        logPath: activeSource.logPath.trim(),
        readExisting: readExistingFile,
      });
      applyCaptureStatus(status);
      await loadSourceQueries();
    } catch (error) {
      setLoadError(toErrorMessage(error));
    } finally {
      setIsCaptureBusy(false);
    }
  }

  async function handleStopCapture() {
    setIsCaptureBusy(true);
    setLoadError(null);

    try {
      const status = await stopCapture();
      applyCaptureStatus(status);
    } catch (error) {
      setLoadError(toErrorMessage(error));
    } finally {
      setIsCaptureBusy(false);
    }
  }

  function handleOpenQueryDetails(queryId: string) {
    setSelectedQueryId(queryId);
    setIsDetailsOpen(true);
  }

  async function handleClearQueries() {
    if (!activeSource) {
      return;
    }

    try {
      await clearCapturedQueries(activeSource.id);
      setQueries([]);
      setSelectedQueryId(null);
      setIsDetailsOpen(false);
    } catch (error) {
      setLoadError(toErrorMessage(error));
    }
  }

  async function handleDeleteCurrentSource() {
    if (!activeSource) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${activeSource.label}" and clear its stored query history?`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingSource(true);
    setLoadError(null);

    try {
      if (isCurrentSourceRunning) {
        const status = await stopCapture();
        applyCaptureStatus(status);
      }

      await clearCapturedQueries(activeSource.id);
      setQueries([]);
      setSelectedQueryId(null);
      setIsDetailsOpen(false);
      setLastUpdatedAt(null);
      setSourcePreview(null);
      setSourcePreviewError(null);
      setSourceViewState((current) => {
        const nextState = { ...current };
        delete nextState[activeSource.id];
        return nextState;
      });
      onDeleteSource(activeSource.id);
    } catch (error) {
      setLoadError(toErrorMessage(error));
    } finally {
      setIsDeletingSource(false);
    }
  }

  const filteredQueries = useQueryFilters(sessionVisibleQueries, filters);
  const selectedQuery = sessionVisibleQueries.find((query) => query.id === selectedQueryId) ?? null;
  const effectiveResolvedLogPath =
    isCurrentSourceRunning ? captureStatus.resolvedLogPath : sourcePreview?.resolvedLogPath ?? null;
  const effectiveResolvedLogFormat =
    isCurrentSourceRunning ? captureStatus.resolvedLogFormat : sourcePreview?.resolvedLogFormat ?? null;
  const effectiveResolvedFileSizeBytes =
    isCurrentSourceRunning ? captureStatus.resolvedFileSizeBytes : sourcePreview?.resolvedFileSizeBytes ?? null;
  const effectiveResolvedFileModifiedAtMs =
    isCurrentSourceRunning
      ? captureStatus.resolvedFileModifiedAtMs
      : sourcePreview?.resolvedFileModifiedAtMs ?? null;
  const canStartCapture = Boolean(activeSource?.logPath.trim()) && !sourcePreviewError;

  const emptyMessage = !activeSource
    ? "Add a log source to start loading PostgreSQL statements."
    : isCurrentSourceRunning
      ? effectiveResolvedLogFormat === "jsonlog"
        ? "Waiting for PostgreSQL to write statements to this source."
        : "Waiting for new log lines from this source."
      : "Start reading this source to populate the table.";

  const metrics = useMemo(() => {
    const durationValues = filteredQueries
      .map((query) => parseDurationMs(query.duration))
      .filter((value): value is number => value !== null);

    const averageDuration =
      durationValues.length > 0
        ? durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length
        : null;

    const errorRate =
      filteredQueries.length > 0
        ? (filteredQueries.filter((query) => query.isError).length / filteredQueries.length) * 100
        : 0;

    return {
      averageDuration,
      errorRate,
      rowCount: filteredQueries.length,
    };
  }, [filteredQueries]);

  const statusLabel = !activeSource
    ? "No Source"
    : isCurrentSourceRunning
      ? isPaused
        ? "Paused"
        : "Watching"
      : "Idle";

  return (
    <section className="monitor-screen">
      <header className="monitor-topbar">
        <div className="monitor-topbar-main">
          <button className="monitor-topbar-connection" type="button">
            <span className="monitor-topbar-dot" aria-hidden="true" />
            <span>{activeSource?.label ?? "No source selected"}</span>
          </button>
          <span className="monitor-topbar-meta" title={activeSource?.logPath ?? undefined}>
            {activeSource?.logPath ?? "Add a PostgreSQL log file to begin."}
          </span>
          <span className={`monitor-mode-badge ${isPaused && isCurrentSourceRunning ? "is-warning" : ""}`}>
            {statusLabel}
          </span>
        </div>

        <div className="monitor-topbar-actions">
          <div className="monitor-metric-pill">
            <span>rows</span>
            <strong>{metrics.rowCount.toLocaleString()}</strong>
          </div>
          <div className="monitor-metric-pill">
            <span>avg</span>
            <strong>{formatMetricDuration(metrics.averageDuration)}</strong>
          </div>
          <div className="monitor-metric-pill">
            <span>err</span>
            <strong>{formatPercent(metrics.errorRate)}</strong>
          </div>
          {activeSource ? (
            <button className="monitor-action-button" onClick={onEditSource} type="button">
              <span className="material-symbols-outlined" aria-hidden="true">
                edit
              </span>
              <span>Edit</span>
            </button>
          ) : null}
          {activeSource ? (
            <button
              className="monitor-action-button is-danger"
              disabled={isDeletingSource}
              onClick={() => {
                void handleDeleteCurrentSource();
              }}
              type="button"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                delete
              </span>
              <span>{isDeletingSource ? "Deleting..." : "Delete"}</span>
            </button>
          ) : null}
          <button className="monitor-action-button" onClick={onAddSource} type="button">
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            <span>Add Source</span>
          </button>
        </div>
      </header>

      <div className="monitor-content">
        {loadError ? <div className="monitor-banner monitor-banner-error">{loadError}</div> : null}

        {activeSource ? (
          <>
            <FiltersBar
              activeSource={activeSource}
              canStart={canStartCapture}
              canClear={queries.length > 0}
              captureResolvedFileModifiedAtMs={effectiveResolvedFileModifiedAtMs}
              captureResolvedFileSizeBytes={effectiveResolvedFileSizeBytes}
              captureResolvedLogFormat={effectiveResolvedLogFormat}
              captureResolvedLogPath={effectiveResolvedLogPath}
              captureSourceError={sourcePreviewError}
              filters={filters}
              isCaptureBusy={isCaptureBusy}
              isRunning={isCurrentSourceRunning}
              isPaused={isPaused}
              lastUpdatedAt={lastUpdatedAt}
              onBrowseSourcePath={() => {
                void handleBrowseSourcePath();
              }}
              onClear={() => {
                void handleClearQueries();
              }}
              onFiltersChange={setFilters}
              onReadExistingFileChange={setReadExistingFile}
              onRefreshIntervalChange={setRefreshIntervalMs}
              onSourcePathChange={onSourcePathChange}
              onStart={() => {
                void handleStartCapture();
              }}
              onStop={() => {
                void handleStopCapture();
              }}
              onTogglePaused={() => setIsPaused((current) => !current)}
              readExistingFile={readExistingFile}
              refreshIntervalMs={refreshIntervalMs}
              resultCount={filteredQueries.length}
            />

            <div className="monitor-table-slot">
              <QueryTable
                emptyMessage={emptyMessage}
                filters={filters}
                isLoading={isLoading}
                lastUpdatedAt={lastUpdatedAt}
                onFiltersChange={setFilters}
                onSelect={handleOpenQueryDetails}
                queries={filteredQueries}
                refreshIntervalMs={refreshIntervalMs}
                selectedQueryId={selectedQueryId}
                summary={{
                  averageDuration: formatMetricDuration(metrics.averageDuration),
                  errorRate: formatPercent(metrics.errorRate),
                  rowCount: metrics.rowCount,
                  totalCount: queries.length,
                }}
              />
            </div>

            <QueryDetailsPanel isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} query={selectedQuery} />
          </>
        ) : (
          <section className="monitor-empty-panel">
            <div className="monitor-empty-panel-copy">
              <span className="connect-kicker">Source Setup</span>
              <h1>Add a PostgreSQL log source</h1>
              <p>
                Point the app at <code>current_logfiles</code> or a concrete PostgreSQL log file. Each source keeps its
                own query history inside the local SQLite cache.
              </p>
            </div>

            <button className="monitor-action-button is-primary" onClick={onAddSource} type="button">
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
              <span>Add Source</span>
            </button>
          </section>
        )}
      </div>
    </section>
  );
}
