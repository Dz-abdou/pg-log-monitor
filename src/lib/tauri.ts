import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CaptureSourcePreview, CaptureStatus, CapturedQuery } from "../types/queries";

type StartCaptureRequest = {
  sourceId: string;
  sourceLabel: string;
  logPath: string;
  readExisting: boolean;
};

export function startCapture(request: StartCaptureRequest) {
  return invoke<CaptureStatus>("start_capture", { request });
}

export function stopCapture() {
  return invoke<CaptureStatus>("stop_capture");
}

export function getCaptureStatus() {
  return invoke<CaptureStatus>("get_capture_status");
}

export function inspectCaptureSource(logPath: string) {
  return invoke<CaptureSourcePreview>("inspect_capture_source", { logPath });
}

export function fetchCapturedQueries(sourceId: string) {
  return invoke<CapturedQuery[]>("fetch_captured_queries", { sourceId });
}

export function clearCapturedQueries(sourceId: string) {
  return invoke<void>("clear_captured_queries", { sourceId });
}

export async function pickCaptureLogSource(defaultPath?: string) {
  const selectedPath = await open({
    defaultPath,
    directory: false,
    multiple: false,
  });

  if (Array.isArray(selectedPath)) {
    return selectedPath[0] ?? null;
  }

  return selectedPath;
}
