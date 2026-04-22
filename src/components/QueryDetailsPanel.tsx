import { useEffect } from "react";
import type { PersistedQuery } from "../types/queries";

type QueryDetailsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  query: PersistedQuery | null;
};

function displayValue(value: string | null) {
  return value && value.trim() ? value : "-";
}

export function QueryDetailsPanel({ isOpen, onClose, query }: QueryDetailsPanelProps) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !query) {
    return null;
  }

  return (
    <>
      <div className="monitor-drawer-backdrop" onClick={onClose} role="presentation" />
      <aside
        aria-label={`Details for query ${query.pid}`}
        className="monitor-drawer"
        role="dialog"
        aria-modal="true"
      >
        <div className="monitor-drawer-head">
          <div className="monitor-drawer-title">
            <span>PID {query.pid}</span>
            <span className="monitor-drawer-subtitle">
              {displayValue(query.user)}@{displayValue(query.database)} | {displayValue(query.applicationName)}
            </span>
          </div>

          <div className="monitor-drawer-actions">
            <button className="monitor-icon-button" onClick={onClose} title="Close details" type="button">
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          </div>
        </div>

        <div className="monitor-drawer-body">
          <dl className="monitor-drawer-grid">
            <div>
              <dt>State</dt>
              <dd>{query.displayState ?? query.state ?? "Logged"}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{displayValue(query.duration)}</dd>
            </div>
            <div>
              <dt>Logged At</dt>
              <dd>{displayValue(query.queryStart)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{displayValue(query.sourceLabel)}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{displayValue(query.database)}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd>{displayValue(query.sourcePath)}</dd>
            </div>
          </dl>

          <div className={`monitor-sql-block ${query.isError ? "is-error" : ""}`}>
            <div className="monitor-sql-block-head">SQL Text</div>
            <pre>{query.query?.trim() ? query.query : "No SQL text available."}</pre>
          </div>
        </div>
      </aside>
    </>
  );
}
