export type ActiveQuery = {
  pid: number;
  database: string | null;
  user: string | null;
  applicationName: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  queryStart: string | null;
  duration: string | null;
  query: string | null;
};

export type CapturedQuery = ActiveQuery & {
  captureId: number;
  sourceId: string | null;
  sourceLabel: string | null;
  sourcePath: string | null;
};

export type PersistedQuery = ActiveQuery & {
  id: string;
  isError: boolean;
  displayState: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  sourcePath: string | null;
};

export type QueryFilters = {
  pid: string;
  queryStart: string;
  database: string;
  user: string;
  applicationName: string;
  state: string;
  duration: string;
  queryText: string;
};

export type CaptureLogFormat = "jsonlog" | "csvlog" | "stderr";

export type CaptureSourcePreview = {
  resolvedLogPath: string;
  resolvedLogFormat: CaptureLogFormat;
  resolvedFileSizeBytes: number | null;
  resolvedFileModifiedAtMs: number | null;
};

export type CaptureStatus = {
  isRunning: boolean;
  logPath: string | null;
  resolvedLogPath: string | null;
  resolvedLogFormat: CaptureLogFormat | null;
  resolvedFileSizeBytes: number | null;
  resolvedFileModifiedAtMs: number | null;
  sourceId: string | null;
  sourceLabel: string | null;
  readExisting: boolean;
  startAfterCaptureId: number | null;
};

export type SourceProfile = {
  id: string;
  label: string;
  logPath: string;
  lastUsedAt: string;
};

export type SourceDraft = {
  id: string | null;
  label: string;
  logPath: string;
};

export const DEFAULT_FILTERS: QueryFilters = {
  pid: "",
  queryStart: "",
  database: "",
  user: "",
  applicationName: "",
  state: "",
  duration: "",
  queryText: "",
};

export const DEFAULT_CAPTURE_LOG_PATH = "";

export const DEFAULT_SOURCE_DRAFT: SourceDraft = {
  id: null,
  label: "",
  logPath: "",
};
