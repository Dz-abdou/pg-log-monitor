import { useEffect, type FormEvent } from "react";
import type { SourceDraft } from "../types/queries";

type SourceDialogProps = {
  errorMessage: string | null;
  isOpen: boolean;
  onBrowse: () => void;
  onChange: (nextValue: SourceDraft) => void;
  onClose: () => void;
  onSubmit: (draft: SourceDraft) => Promise<void> | void;
  value: SourceDraft;
};

export function SourceDialog({
  errorMessage,
  isOpen,
  onBrowse,
  onChange,
  onClose,
  onSubmit,
  value,
}: SourceDialogProps) {
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

  if (!isOpen) {
    return null;
  }

  function updateField<K extends keyof SourceDraft>(field: K, fieldValue: SourceDraft[K]) {
    onChange({
      ...value,
      [field]: fieldValue,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(value);
  }

  return (
    <>
      <div className="monitor-modal-backdrop" onClick={onClose} role="presentation" />

      <div aria-modal="true" className="monitor-modal" role="dialog">
        <div className="monitor-modal-head">
          <div>
            <span className="connect-kicker">Source</span>
            <strong>{value.id ? "Edit log source" : "Add log source"}</strong>
          </div>

          <button className="monitor-icon-button" onClick={onClose} title="Close source editor" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {errorMessage ? <div className="monitor-banner monitor-banner-error">{errorMessage}</div> : null}

        <form className="monitor-modal-form" onSubmit={handleSubmit}>
          <label className="connect-field">
            <span>Name</span>
            <input
              autoFocus
              className="connect-input"
              onChange={(event) => updateField("label", event.target.value)}
              placeholder="Production Cluster"
              type="text"
              value={value.label}
            />
          </label>

          <label className="connect-field">
            <span>Log File</span>
            <div className="monitor-source-dialog-path">
              <input
                className="connect-input connect-input-mono"
                onChange={(event) => updateField("logPath", event.target.value)}
                placeholder="C:\Program Files\PostgreSQL\17\data\current_logfiles"
                type="text"
                value={value.logPath}
              />
              <button className="monitor-icon-button" onClick={onBrowse} title="Browse log file" type="button">
                <span className="material-symbols-outlined" aria-hidden="true">
                  folder_open
                </span>
              </button>
            </div>
          </label>

          <div className="monitor-form-note">
            Use PostgreSQL <code>current_logfiles</code> or a concrete log file path. The app stores queries in its local
            SQLite cache per source name.
          </div>

          <div className="monitor-modal-actions">
            <button className="monitor-action-button" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="monitor-action-button is-primary" type="submit">
              <span className="material-symbols-outlined" aria-hidden="true">
                save
              </span>
              <span>{value.id ? "Save Source" : "Add Source"}</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
