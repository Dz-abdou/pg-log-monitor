use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::capture::{self, CaptureSession};
use crate::models::{CaptureSourcePreview, CaptureStatus, CapturedQuery, StartCaptureRequest};

#[derive(Default)]
pub struct AppState {
    pub capture: Mutex<Option<CaptureSession>>,
}

fn build_capture_status(session: Option<&CaptureSession>) -> CaptureStatus {
    let source_info = session
        .and_then(|value| capture::describe_capture_source(&value.log_path).ok());

    CaptureStatus {
        is_running: session.is_some(),
        log_path: session.map(|value| value.log_path.clone()),
        resolved_log_path: source_info
            .as_ref()
            .map(|source| source.resolved_log_path.clone()),
        resolved_log_format: source_info
            .as_ref()
            .map(|source| source.resolved_log_format.clone()),
        resolved_file_size_bytes: source_info
            .as_ref()
            .and_then(|source| source.resolved_file_size_bytes),
        resolved_file_modified_at_ms: source_info
            .as_ref()
            .and_then(|source| source.resolved_file_modified_at_ms),
        source_id: session.map(|value| value.source_id.clone()),
        source_label: session.map(|value| value.source_label.clone()),
        read_existing: session.map(|value| value.read_existing).unwrap_or(false),
        start_after_capture_id: session.map(|value| value.start_after_capture_id),
    }
}

fn build_capture_preview(log_path: &str) -> Result<CaptureSourcePreview, String> {
    let source_info = capture::describe_capture_source(log_path)?;

    Ok(CaptureSourcePreview {
        resolved_log_path: source_info.resolved_log_path,
        resolved_log_format: source_info.resolved_log_format,
        resolved_file_size_bytes: source_info.resolved_file_size_bytes,
        resolved_file_modified_at_ms: source_info.resolved_file_modified_at_ms,
    })
}

#[tauri::command]
pub async fn start_capture(
    request: StartCaptureRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CaptureStatus, String> {
    let mut capture_state = state.capture.lock().await;

    if let Some(existing_session) = capture_state.take() {
        existing_session.task.abort();
    }

    let capture_session = capture::start_capture(
        &app,
        &request.source_id,
        &request.source_label,
        &request.log_path,
        request.read_existing,
    )
    .await?;
    let status = build_capture_status(Some(&capture_session));

    *capture_state = Some(capture_session);

    Ok(status)
}

#[tauri::command]
pub async fn stop_capture(state: State<'_, AppState>) -> Result<CaptureStatus, String> {
    let mut capture_state = state.capture.lock().await;

    if let Some(capture_session) = capture_state.take() {
        capture_session.task.abort();
    }

    Ok(build_capture_status(None))
}

#[tauri::command]
pub async fn get_capture_status(state: State<'_, AppState>) -> Result<CaptureStatus, String> {
    let capture_state = state.capture.lock().await;

    Ok(build_capture_status(capture_state.as_ref()))
}

#[tauri::command]
pub async fn inspect_capture_source(log_path: String) -> Result<CaptureSourcePreview, String> {
    build_capture_preview(&log_path)
}

#[tauri::command]
pub async fn fetch_captured_queries(
    app: AppHandle,
    source_id: String,
) -> Result<Vec<CapturedQuery>, String> {
    capture::fetch_captured_queries(&app, &source_id).await
}

#[tauri::command]
pub async fn clear_captured_queries(app: AppHandle, source_id: String) -> Result<(), String> {
    capture::clear_captured_queries(&app, &source_id).await
}
