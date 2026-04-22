import type { SourceProfile } from "../types/queries";

type AppSidebarProps = {
  activeSource: SourceProfile | null;
  onNewSource: () => void;
  onSelectSource: (source: SourceProfile) => void;
  runningSourceId: string | null;
  savedSources: SourceProfile[];
};

export function AppSidebar({
  activeSource,
  onNewSource,
  onSelectSource,
  runningSourceId,
  savedSources,
}: AppSidebarProps) {
  return (
    <aside className="monitor-sidebar">
      <div className="monitor-sidebar-brandbar">
        <div className="monitor-sidebar-brandmark">
          <span className="material-symbols-outlined" aria-hidden="true">
            analytics
          </span>
        </div>
        <div className="monitor-sidebar-brandcopy">
          <strong>pg Monitor</strong>
          <span>Query Log</span>
        </div>
      </div>

      <div className="monitor-sidebar-sectionhead">
        <span>Sources</span>
        <button className="monitor-icon-button" onClick={onNewSource} title="Add source" type="button">
          <span className="material-symbols-outlined" aria-hidden="true">
            add
          </span>
        </button>
      </div>

      <div className="monitor-sidebar-connections">
        {savedSources.length === 0 ? (
          <div className="monitor-sidebar-empty">
            <span className="material-symbols-outlined" aria-hidden="true">
              folder_open
            </span>
            <p>Add a PostgreSQL log file source to start loading statements.</p>
          </div>
        ) : (
          savedSources.map((source) => {
            const isCurrent = activeSource?.id === source.id;
            const isRunning = runningSourceId === source.id;

            return (
              <button
                className={`monitor-connection-card ${isCurrent ? "is-current" : ""}`}
                key={source.id}
                onClick={() => onSelectSource(source)}
                type="button"
              >
                <div className="monitor-connection-card-head">
                  <span className="monitor-connection-name">{source.label}</span>
                  <span className={`monitor-connection-status ${isRunning ? "is-live" : ""}`}>
                    {isRunning ? "Watching" : "Saved"}
                  </span>
                </div>
                <span className="monitor-connection-meta" title={source.logPath}>
                  {source.logPath}
                </span>
              </button>
            );
          })
        )}
      </div>

      <button className="monitor-sidebar-primary" onClick={onNewSource} type="button">
        <span className="material-symbols-outlined" aria-hidden="true">
          add
        </span>
        <span>Add Source</span>
      </button>

      <div className="monitor-sidebar-footer">
        <span>v0.1.0</span>
        <span>{activeSource?.label ?? "No source selected"}</span>
      </div>
    </aside>
  );
}
