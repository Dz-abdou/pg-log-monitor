import { useState } from "react";
import type { CaptureLogFormat, QueryFilters, SourceProfile } from "../types/queries";

type FiltersBarProps = {
  activeSource: SourceProfile;
  canStart: boolean;
  canClear: boolean;
  captureResolvedFileModifiedAtMs: number | null;
  captureResolvedFileSizeBytes: number | null;
  captureResolvedLogFormat: CaptureLogFormat | null;
  captureResolvedLogPath: string | null;
  captureSourceError: string | null;
  filters: QueryFilters;
  isCaptureBusy: boolean;
  isRunning: boolean;
  isPaused: boolean;
  lastUpdatedAt: string | null;
  onBrowseSourcePath: () => void;
  onClear: () => void;
  onFiltersChange: (filters: QueryFilters) => void;
  onReadExistingFileChange: (value: boolean) => void;
  onRefreshIntervalChange: (intervalMs: number) => void;
  onSourcePathChange: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  onTogglePaused: () => void;
  readExistingFile: boolean;
  refreshIntervalMs: number;
  resultCount: number;
};

function getCaptureFormatLabel(format: CaptureLogFormat) {
  switch (format) {
    case "jsonlog":
      return "JSON";
    case "csvlog":
      return "CSV";
    case "stderr":
      return "STDERR";
    default:
      return format;
  }
}

function formatFileSize(bytes: number | null) {
  if (bytes === null) {
    return null;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatFileModifiedAt(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FiltersBar({
  activeSource,
  canStart,
  canClear,
  captureResolvedFileModifiedAtMs,
  captureResolvedFileSizeBytes,
  captureResolvedLogFormat,
  captureResolvedLogPath,
  captureSourceError,
  filters,
  isCaptureBusy,
  isRunning,
  isPaused,
  lastUpdatedAt,
  onBrowseSourcePath,
  onClear,
  onFiltersChange,
  onReadExistingFileChange,
  onRefreshIntervalChange,
  onSourcePathChange,
  onStart,
  onStop,
  onTogglePaused,
  readExistingFile,
  refreshIntervalMs,
  resultCount,
}: FiltersBarProps) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const fileSizeLabel = formatFileSize(captureResolvedFileSizeBytes);
  const modifiedAtLabel = formatFileModifiedAt(captureResolvedFileModifiedAtMs);

  function updateField<K extends keyof QueryFilters>(field: K, value: QueryFilters[K]) {
    onFiltersChange({
      ...filters,
      [field]: value,
    });
  }

  return (
    <section className="monitor-controlstrip">
      <div className="monitor-controlstrip-row">
        <div className="monitor-capture-source">
          <span className="monitor-source-chip">{activeSource.label}</span>
          <input
            className="monitor-control-input"
            disabled={isRunning}
            onChange={(event) => onSourcePathChange(event.target.value)}
            placeholder="C:\Program Files\PostgreSQL\17\data\current_logfiles"
            type="text"
            value={activeSource.logPath}
          />
          <button
            className="monitor-icon-button"
            disabled={isRunning}
            onClick={onBrowseSourcePath}
            title="Browse log file"
            type="button"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              folder_open
            </span>
          </button>
        </div>

        <button
          className="monitor-icon-button"
          onClick={() => setIsHelpOpen((current) => !current)}
          title="Log setup help"
          type="button"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            help
          </span>
        </button>

        <div className="monitor-actions-group">
          <label className="monitor-choice-toggle">
            <input
              checked={readExistingFile}
              disabled={isRunning}
              onChange={(event) => onReadExistingFileChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Include lines already in this file</strong>
              <small>
                {readExistingFile
                  ? "Imports lines already present in the single file shown below."
                  : "Starts at the current end of the single file shown below."}
              </small>
            </span>
          </label>

          {isRunning ? (
            <button className="monitor-action-button is-danger" disabled={isCaptureBusy} onClick={onStop} type="button">
              <span className="material-symbols-outlined" aria-hidden="true">
                stop
              </span>
              <span>{isCaptureBusy ? "Stopping..." : "Stop"}</span>
            </button>
          ) : (
            <button
              className="monitor-action-button is-primary"
              disabled={isCaptureBusy || !canStart}
              onClick={onStart}
              type="button"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                play_arrow
              </span>
              <span>{isCaptureBusy ? "Starting..." : "Start"}</span>
            </button>
          )}

          <button className="monitor-action-button" onClick={onTogglePaused} type="button">
            <span className="material-symbols-outlined" aria-hidden="true">
              {isPaused ? "play_arrow" : "pause"}
            </span>
            <span>{isPaused ? "Resume" : "Pause"}</span>
          </button>

          <button className="monitor-action-button" disabled={!canClear} onClick={onClear} type="button">
            <span className="material-symbols-outlined" aria-hidden="true">
              delete_sweep
            </span>
            <span>Clear</span>
          </button>
        </div>
      </div>

      <div className="monitor-controlstrip-row">
        <div className="monitor-control-meta">
          <span>{resultCount} rows</span>
          <span>{lastUpdatedAt ? `updated ${lastUpdatedAt}` : "waiting for data"}</span>
          <span>{readExistingFile ? "single file import" : "tail from now"}</span>
          {isRunning ? <span>stop to change file</span> : null}
          {captureResolvedLogFormat ? (
            <span>{getCaptureFormatLabel(captureResolvedLogFormat)}</span>
          ) : (
            <span>current_logfiles or direct log file</span>
          )}
          {fileSizeLabel ? <span>{fileSizeLabel}</span> : null}
          {modifiedAtLabel ? <span>{modifiedAtLabel}</span> : null}
          {captureResolvedLogPath ? (
            <span className="monitor-control-path" title={captureResolvedLogPath}>
              {captureResolvedLogPath}
            </span>
          ) : null}
          {captureSourceError ? <span className="monitor-control-warning">{captureSourceError}</span> : null}
        </div>

        <div className="monitor-search-row">
          <div className="monitor-search-input">
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input
              className="monitor-control-input"
              onChange={(event) => updateField("queryText", event.target.value)}
              placeholder="Filter SQL, user, db, app, pid..."
              type="text"
              value={filters.queryText}
            />
          </div>

          <div className="monitor-refresh-input">
            <span className="material-symbols-outlined" aria-hidden="true">
              refresh
            </span>
            <input
              className="monitor-control-input monitor-control-input-mono"
              min={250}
              onChange={(event) => onRefreshIntervalChange(Math.max(250, Number(event.target.value) || 1000))}
              step={250}
              type="number"
              value={refreshIntervalMs}
            />
            <span>ms</span>
          </div>
        </div>
      </div>

      {isHelpOpen ? (
        <div className="monitor-help-panel" role="note">
          <p>How file scope works</p>
          <ul>
            <li><code>Start</code> reads one file only: the resolved file shown above.</li>
            <li>If the source is <code>current_logfiles</code>, that resolves to PostgreSQL&apos;s active log file.</li>
            <li>Older rotated log files are not scanned automatically.</li>
            <li>How far back import can go depends on how much is already inside that one file.</li>
          </ul>
          <p className="monitor-help-subtitle">Recommended PostgreSQL logging</p>
          <ol>
            <li>Open <code>postgresql.conf</code>.</li>
            <li>Turn on JSON logging.</li>
            <li>Restart PostgreSQL.</li>
            <li>Point this app at <code>current_logfiles</code>.</li>
          </ol>
          <pre>
{`logging_collector = on
log_destination = 'stderr,jsonlog'
log_statement = 'all'
log_duration = on
log_min_error_statement = error
log_line_prefix = '%m [%p] %q%u@%d/%a '`}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
