use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCaptureRequest {
    pub source_id: String,
    pub source_label: String,
    pub log_path: String,
    pub read_existing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedQuery {
    pub capture_id: i64,
    pub source_id: Option<String>,
    pub source_label: Option<String>,
    pub source_path: Option<String>,
    pub pid: u32,
    pub database: Option<String>,
    pub user: Option<String>,
    pub application_name: Option<String>,
    pub state: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    pub query_start: Option<String>,
    pub duration: Option<String>,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub is_running: bool,
    pub log_path: Option<String>,
    pub resolved_log_path: Option<String>,
    pub resolved_log_format: Option<String>,
    pub resolved_file_size_bytes: Option<u64>,
    pub resolved_file_modified_at_ms: Option<u64>,
    pub source_id: Option<String>,
    pub source_label: Option<String>,
    pub read_existing: bool,
    pub start_after_capture_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourcePreview {
    pub resolved_log_path: String,
    pub resolved_log_format: String,
    pub resolved_file_size_bytes: Option<u64>,
    pub resolved_file_modified_at_ms: Option<u64>,
}
