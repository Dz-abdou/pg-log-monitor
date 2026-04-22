use std::{
    fs,
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

use csv::{ReaderBuilder, StringRecord};
use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio::{
    fs::{self as tokio_fs, File},
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
    task::{spawn_blocking, JoinHandle},
    time::sleep,
};

use crate::models::CapturedQuery;

const CAPTURE_DB_FILE: &str = "capture-store.sqlite3";
const CAPTURE_POLL_INTERVAL_MS: u64 = 500;
const CAPTURE_FETCH_LIMIT: i64 = 1000;
const CAPTURE_MAX_ROWS_PER_SOURCE: i64 = 100_000;
const VALIDATION_SAMPLE_BYTES: usize = 32 * 1024;

pub struct CaptureSession {
    pub task: JoinHandle<()>,
    pub log_path: String,
    pub source_id: String,
    pub source_label: String,
    pub read_existing: bool,
    pub start_after_capture_id: i64,
}

#[derive(Debug, Clone)]
pub struct CaptureSourceInfo {
    pub resolved_log_path: String,
    pub resolved_log_format: String,
    pub resolved_file_size_bytes: Option<u64>,
    pub resolved_file_modified_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LogFormat {
    Json,
    Csv,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedLogSource {
    path: PathBuf,
    format: LogFormat,
}

impl LogFormat {
    fn as_status_value(&self) -> &'static str {
        match self {
            Self::Json => "jsonlog",
            Self::Csv => "csvlog",
            Self::Stderr => "stderr",
        }
    }
}

#[derive(Debug, Clone)]
struct CapturedRecord {
    logged_at: String,
    pid: u32,
    database: Option<String>,
    user: Option<String>,
    application_name: Option<String>,
    session_id: Option<String>,
    line_num: Option<i64>,
    severity: Option<String>,
    sql_state_code: Option<String>,
    message: Option<String>,
    detail: Option<String>,
    hint: Option<String>,
    duration: Option<String>,
    query_text: String,
}

#[derive(Debug, Clone)]
struct CaptureSourceMeta {
    source_id: String,
    source_label: String,
    source_path: String,
}

#[derive(Debug, Clone)]
enum ParsedLogEvent {
    Statement(CapturedRecord),
    Duration(CapturedDuration),
}

#[derive(Debug, Clone)]
struct CapturedDuration {
    pid: u32,
    session_id: Option<String>,
    duration_text: String,
}

#[derive(Debug, Deserialize)]
struct JsonLogEntry {
    timestamp: Option<String>,
    user: Option<String>,
    dbname: Option<String>,
    pid: Option<u32>,
    session_id: Option<String>,
    line_num: Option<i64>,
    error_severity: Option<String>,
    state_code: Option<String>,
    message: Option<String>,
    detail: Option<String>,
    hint: Option<String>,
    statement: Option<String>,
    application_name: Option<String>,
}

pub async fn start_capture(
    app: &AppHandle,
    source_id: &str,
    source_label: &str,
    log_path: &str,
    read_existing: bool,
) -> Result<CaptureSession, String> {
    let source_path = PathBuf::from(log_path);
    validate_source_path(&source_path)?;

    let db_path = resolve_capture_db_path(app)?;
    initialize_store(&db_path).await?;
    let start_after_capture_id = {
        let db_path = db_path.clone();
        let source_id = source_id.to_string();

        spawn_blocking(move || fetch_max_capture_id_sync(&db_path, &source_id))
            .await
            .map_err(|error| error.to_string())??
    };

    let source_meta = CaptureSourceMeta {
        source_id: source_id.to_string(),
        source_label: source_label.to_string(),
        source_path: log_path.to_string(),
    };
    let stored_log_path = log_path.to_string();
    let task = tokio::spawn(async move {
        run_capture_loop(source_meta, source_path, db_path, read_existing).await;
    });

    Ok(CaptureSession {
        task,
        log_path: stored_log_path,
        source_id: source_id.to_string(),
        source_label: source_label.to_string(),
        read_existing,
        start_after_capture_id,
    })
}

pub async fn fetch_captured_queries(
    app: &AppHandle,
    source_id: &str,
) -> Result<Vec<CapturedQuery>, String> {
    let db_path = resolve_capture_db_path(app)?;
    let source_id = source_id.to_string();

    if !db_path.exists() {
        return Ok(Vec::new());
    }

    spawn_blocking(move || fetch_captured_queries_sync(&db_path, &source_id))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn clear_captured_queries(app: &AppHandle, source_id: &str) -> Result<(), String> {
    let db_path = resolve_capture_db_path(app)?;
    let source_id = source_id.to_string();

    if !db_path.exists() {
        return Ok(());
    }

    spawn_blocking(move || clear_captured_queries_sync(&db_path, &source_id))
        .await
        .map_err(|error| error.to_string())?
}

pub fn describe_capture_source(log_path: &str) -> Result<CaptureSourceInfo, String> {
    let source_path = PathBuf::from(log_path);
    validate_source_path(&source_path)?;

    let resolved = resolve_effective_log_source(&source_path)?;

    Ok(CaptureSourceInfo {
        resolved_log_path: resolved.path.display().to_string(),
        resolved_log_format: resolved.format.as_status_value().to_string(),
        resolved_file_size_bytes: fs::metadata(&resolved.path).ok().map(|metadata| metadata.len()),
        resolved_file_modified_at_ms: fs::metadata(&resolved.path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64),
    })
}

async fn initialize_store(db_path: &Path) -> Result<(), String> {
    let db_path = db_path.to_path_buf();

    spawn_blocking(move || initialize_store_sync(&db_path))
        .await
        .map_err(|error| error.to_string())?
}

async fn run_capture_loop(
    source_meta: CaptureSourceMeta,
    source_path: PathBuf,
    db_path: PathBuf,
    read_existing: bool,
) {
    let mut current_source: Option<ResolvedLogSource> = None;
    let mut file_offset = 0_u64;
    let mut partial_chunk = String::new();
    let mut skip_existing_once = !read_existing;

    loop {
        match resolve_effective_log_source(&source_path) {
            Ok(next_source) => {
                if current_source.as_ref() != Some(&next_source) {
                    current_source = Some(next_source.clone());
                    file_offset = if skip_existing_once {
                        match tokio_fs::metadata(&next_source.path).await {
                            Ok(metadata) => metadata.len(),
                            Err(_) => 0,
                        }
                    } else {
                        0
                    };
                    partial_chunk.clear();
                    skip_existing_once = false;
                }

                match read_new_records(&next_source, &mut file_offset, &mut partial_chunk).await {
                    Ok(events) if !events.is_empty() => {
                        let db_path = db_path.clone();
                        let source_meta = source_meta.clone();
                        let _ =
                            spawn_blocking(move || {
                                insert_captured_events_sync(&db_path, &source_meta, events)
                            })
                            .await;
                    }
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("capture read error: {error}");
                    }
                }
            }
            Err(error) => {
                eprintln!("capture path resolution error: {error}");
            }
        }

        sleep(Duration::from_millis(CAPTURE_POLL_INTERVAL_MS)).await;
    }
}

async fn read_new_records(
    source: &ResolvedLogSource,
    file_offset: &mut u64,
    partial_chunk: &mut String,
) -> Result<Vec<ParsedLogEvent>, String> {
    let metadata = match tokio_fs::metadata(&source.path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            *file_offset = 0;
            partial_chunk.clear();
            return Ok(Vec::new());
        }
        Err(error) => return Err(error.to_string()),
    };

    let file_length = metadata.len();

    if file_length < *file_offset {
        *file_offset = 0;
        partial_chunk.clear();
    }

    if file_length == *file_offset {
        return Ok(Vec::new());
    }

    let mut file = File::open(&source.path)
        .await
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(*file_offset))
        .await
        .map_err(|error| error.to_string())?;

    let mut buffer = vec![0; (file_length - *file_offset) as usize];
    file.read_exact(&mut buffer)
        .await
        .map_err(|error| error.to_string())?;
    *file_offset = file_length;

    partial_chunk.push_str(&String::from_utf8_lossy(&buffer));

    let Some(last_newline) = partial_chunk.rfind('\n') else {
        return Ok(Vec::new());
    };

    let complete_chunk = partial_chunk[..last_newline].to_string();
    let remainder = partial_chunk[last_newline + 1..].to_string();
    *partial_chunk = remainder;

    Ok(match source.format {
        LogFormat::Json => parse_json_log_chunk(&complete_chunk),
        LogFormat::Csv => parse_csv_log_chunk(&complete_chunk),
        LogFormat::Stderr => parse_stderr_log_chunk(&complete_chunk),
    })
}

fn parse_json_log_chunk(chunk: &str) -> Vec<ParsedLogEvent> {
    chunk
        .lines()
        .filter_map(parse_json_log_line_event)
        .collect()
}

fn parse_json_log_line_event(line: &str) -> Option<ParsedLogEvent> {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return None;
    }

    let entry: JsonLogEntry = serde_json::from_str(trimmed).ok()?;
    if entry.application_name.as_deref() == Some("postgres-profiler") {
        return None;
    }

    let pid = entry.pid?;
    let logged_at = entry.timestamp?;
    let session_id = trim_to_option(entry.session_id);
    let message = trim_to_option(entry.message);
    let duration = message.as_deref().and_then(extract_duration_from_message);

    if let Some(query_text) = extract_query_text(entry.statement, message.as_deref()) {
        return Some(ParsedLogEvent::Statement(CapturedRecord {
            logged_at,
            pid,
            database: trim_to_option(entry.dbname),
            user: trim_to_option(entry.user),
            application_name: trim_to_option(entry.application_name),
            session_id,
            line_num: entry.line_num,
            severity: trim_to_option(entry.error_severity),
            sql_state_code: trim_to_option(entry.state_code),
            message,
            detail: trim_to_option(entry.detail),
            hint: trim_to_option(entry.hint),
            duration,
            query_text,
        }));
    }

    duration.map(|duration_text| {
        ParsedLogEvent::Duration(CapturedDuration {
            pid,
            session_id,
            duration_text,
        })
    })
}

fn parse_csv_log_chunk(chunk: &str) -> Vec<ParsedLogEvent> {
    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(chunk.as_bytes());

    reader
        .records()
        .filter_map(|record| {
            record
                .ok()
                .and_then(|record| parse_csv_record_event(&record))
        })
        .collect()
}

fn parse_csv_record_event(record: &StringRecord) -> Option<ParsedLogEvent> {
    let message = trim_to_option(record.get(13).map(|value| value.to_string()));
    let query_column = record.get(19).map(|value| value.to_string());
    let application_name = trim_to_option(record.get(23).map(|value| value.to_string()));

    if application_name.as_deref() == Some("postgres-profiler") {
        return None;
    }

    let pid = parse_u32(record.get(3)).unwrap_or(0);
    let session_id = trim_to_option(record.get(5).map(|value| value.to_string()));
    let duration = message.as_deref().and_then(extract_duration_from_message);

    if let Some(query_text) = extract_query_text(query_column, message.as_deref()) {
        return Some(ParsedLogEvent::Statement(CapturedRecord {
            logged_at: record.get(0)?.trim().to_string(),
            pid,
            database: trim_to_option(record.get(2).map(|value| value.to_string())),
            user: trim_to_option(record.get(1).map(|value| value.to_string())),
            application_name,
            session_id,
            line_num: parse_i64(record.get(6)),
            severity: trim_to_option(record.get(11).map(|value| value.to_string())),
            sql_state_code: trim_to_option(record.get(12).map(|value| value.to_string())),
            message,
            detail: trim_to_option(record.get(14).map(|value| value.to_string())),
            hint: trim_to_option(record.get(15).map(|value| value.to_string())),
            duration,
            query_text,
        }));
    }

    duration.map(|duration_text| {
        ParsedLogEvent::Duration(CapturedDuration {
            pid,
            session_id,
            duration_text,
        })
    })
}

fn parse_stderr_log_chunk(chunk: &str) -> Vec<ParsedLogEvent> {
    chunk
        .lines()
        .filter_map(parse_stderr_log_line_event)
        .collect()
}

fn parse_stderr_log_line_event(line: &str) -> Option<ParsedLogEvent> {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return None;
    }

    let (prefix, severity, message) = split_stderr_message(trimmed)?;

    if message.contains("postgres-profiler") {
        return None;
    }

    let pid = extract_pid(prefix).unwrap_or(0);
    let duration = extract_duration_from_message(message);

    if let Some(query_text) = extract_query_text(None, Some(message)) {
        return Some(ParsedLogEvent::Statement(CapturedRecord {
            logged_at: extract_logged_at(prefix),
            pid,
            database: None,
            user: None,
            application_name: None,
            session_id: None,
            line_num: None,
            severity: Some(severity.to_string()),
            sql_state_code: None,
            message: Some(message.to_string()),
            detail: None,
            hint: None,
            duration,
            query_text,
        }));
    }

    duration.map(|duration_text| {
        ParsedLogEvent::Duration(CapturedDuration {
            pid,
            session_id: None,
            duration_text,
        })
    })
}

fn split_stderr_message(line: &str) -> Option<(&str, &str, &str)> {
    const LEVELS: [&str; 8] = [
        "LOG", "ERROR", "FATAL", "PANIC", "WARNING", "NOTICE", "INFO", "DEBUG",
    ];

    LEVELS
        .iter()
        .filter_map(|level| line.find(&format!("{level}:")).map(|index| (index, *level)))
        .min_by_key(|(index, _)| *index)
        .map(|(index, level)| {
            let prefix = line[..index].trim();
            let message = line[index + level.len() + 1..].trim();
            (prefix, level, message)
        })
}

fn extract_pid(prefix: &str) -> Option<u32> {
    let start = prefix.rfind('[')?;
    let end = prefix[start..].find(']')? + start;
    prefix[start + 1..end].trim().parse::<u32>().ok()
}

fn extract_logged_at(prefix: &str) -> String {
    if let Some(index) = prefix.rfind('[') {
        let timestamp = prefix[..index].trim();
        if !timestamp.is_empty() {
            return timestamp.to_string();
        }
    }

    prefix.trim().to_string()
}

fn extract_query_text(query_field: Option<String>, message: Option<&str>) -> Option<String> {
    if let Some(statement) = trim_to_option(query_field) {
        return Some(statement);
    }

    let message = message?;

    if let Some(statement) = message.strip_prefix("statement: ") {
        return trim_to_option(Some(statement.to_string()));
    }

    if let Some((_, statement)) = message.split_once(" statement: ") {
        return trim_to_option(Some(statement.to_string()));
    }

    if message.starts_with("execute ") {
        if let Some((_, statement)) = message.split_once(": ") {
            return trim_to_option(Some(statement.to_string()));
        }
    }

    None
}

fn extract_duration_from_message(message: &str) -> Option<String> {
    let duration = message.strip_prefix("duration: ")?;
    let duration = duration.split(" statement: ").next()?;
    trim_to_option(Some(duration.to_string()))
}

fn parse_u32(value: Option<&str>) -> Option<u32> {
    value.and_then(|value| value.trim().parse::<u32>().ok())
}

fn parse_i64(value: Option<&str>) -> Option<i64> {
    value.and_then(|value| value.trim().parse::<i64>().ok())
}

fn trim_to_option(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn resolve_capture_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    Ok(app_data_dir.join(CAPTURE_DB_FILE))
}

fn validate_source_path(source_path: &Path) -> Result<(), String> {
    if !source_path.exists() {
        return Err(format!(
            "Capture source was not found: {}",
            source_path.display()
        ));
    }

    let resolved = resolve_effective_log_source(source_path)?;
    validate_resolved_log_source(source_path, &resolved)
}

fn resolve_effective_log_source(source_path: &Path) -> Result<ResolvedLogSource, String> {
    if source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("current_logfiles"))
        .unwrap_or(false)
    {
        let content = fs::read_to_string(source_path).map_err(|error| error.to_string())?;
        let parent = source_path.parent().unwrap_or_else(|| Path::new("."));

        for format_name in ["jsonlog", "csvlog", "stderr"] {
            for line in content.lines() {
                let trimmed = line.trim();

                if let Some(relative_path) = trimmed.strip_prefix(&format!("{format_name} ")) {
                    return Ok(ResolvedLogSource {
                        path: parent.join(relative_path.trim()),
                        format: match format_name {
                            "jsonlog" => LogFormat::Json,
                            "csvlog" => LogFormat::Csv,
                            _ => LogFormat::Stderr,
                        },
                    });
                }
            }
        }

        return Err("Could not find a supported log entry inside current_logfiles.".into());
    }

    Ok(ResolvedLogSource {
        path: source_path.to_path_buf(),
        format: infer_log_format(source_path),
    })
}

fn infer_log_format(path: &Path) -> LogFormat {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    {
        Some(extension) if extension == "json" || extension == "jsonlog" => LogFormat::Json,
        Some(extension) if extension == "csv" || extension == "csvlog" => LogFormat::Csv,
        _ => LogFormat::Stderr,
    }
}

fn validate_resolved_log_source(
    original_source_path: &Path,
    resolved_source: &ResolvedLogSource,
) -> Result<(), String> {
    let sample_bytes = read_validation_sample(&resolved_source.path)?;

    if is_binary_sample(&sample_bytes) {
        return Err(format!(
            "Selected file does not look like a text PostgreSQL log: {}",
            resolved_source.path.display()
        ));
    }

    match resolved_source.format {
        LogFormat::Json => validate_json_log_sample(&resolved_source.path, &sample_bytes),
        LogFormat::Csv => validate_csv_log_sample(&resolved_source.path, &sample_bytes),
        LogFormat::Stderr => validate_stderr_log_sample(
            original_source_path,
            &resolved_source.path,
            &sample_bytes,
        ),
    }
}

fn read_validation_sample(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buffer = vec![0; VALIDATION_SAMPLE_BYTES];
    let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    buffer.truncate(bytes_read);
    Ok(buffer)
}

fn is_binary_sample(sample: &[u8]) -> bool {
    sample.contains(&0)
}

fn validate_json_log_sample(path: &Path, sample: &[u8]) -> Result<(), String> {
    let content = String::from_utf8_lossy(sample);
    let first_line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim);

    let Some(first_line) = first_line else {
        return Ok(());
    };

    let parsed: serde_json::Value = serde_json::from_str(first_line).map_err(|_| {
        format!(
            "Selected file does not look like a PostgreSQL JSON log: {}",
            path.display()
        )
    })?;

    let Some(object) = parsed.as_object() else {
        return Err(format!(
            "Selected file does not look like a PostgreSQL JSON log: {}",
            path.display()
        ));
    };

    let looks_like_postgres_json_log = object.contains_key("message")
        || object.contains_key("statement")
        || object.contains_key("timestamp")
        || object.contains_key("pid")
        || object.contains_key("session_id");

    if looks_like_postgres_json_log {
        Ok(())
    } else {
        Err(format!(
            "Selected file does not look like a PostgreSQL JSON log: {}",
            path.display()
        ))
    }
}

fn validate_csv_log_sample(path: &Path, sample: &[u8]) -> Result<(), String> {
    let content = String::from_utf8_lossy(sample);
    let first_non_empty_line = content.lines().find(|line| !line.trim().is_empty());

    let Some(first_non_empty_line) = first_non_empty_line else {
        return Ok(());
    };

    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(first_non_empty_line.as_bytes());

    let record = reader
        .records()
        .next()
        .transpose()
        .map_err(|error| error.to_string())?;

    let Some(record) = record else {
        return Err(format!(
            "Selected file does not look like a PostgreSQL CSV log: {}",
            path.display()
        ));
    };

    if record.len() >= 10 {
        Ok(())
    } else {
        Err(format!(
            "Selected file does not look like a PostgreSQL CSV log: {}",
            path.display()
        ))
    }
}

fn validate_stderr_log_sample(
    original_source_path: &Path,
    resolved_path: &Path,
    sample: &[u8],
) -> Result<(), String> {
    if !is_supported_stderr_extension(original_source_path)
        && !is_supported_stderr_extension(resolved_path)
    {
        return Err(format!(
            "Unsupported log file type. Use current_logfiles, .log, .txt, .jsonlog/.json, or .csvlog/.csv."
        ));
    }

    let content = String::from_utf8_lossy(sample);
    let mut saw_non_empty_line = false;

    for line in content.lines().map(str::trim).filter(|line| !line.is_empty()).take(20) {
        saw_non_empty_line = true;

        if split_stderr_message(line).is_some()
            || line.contains("statement: ")
            || line.contains("duration: ")
        {
            return Ok(());
        }
    }

    if !saw_non_empty_line {
        Ok(())
    } else {
        Err(format!(
            "Selected file does not look like a supported PostgreSQL text log: {}",
            resolved_path.display()
        ))
    }
}

fn is_supported_stderr_extension(path: &Path) -> bool {
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("current_logfiles"))
        .unwrap_or(false)
    {
        return true;
    }

    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    {
        None => true,
        Some(extension)
            if matches!(
                extension.as_str(),
                "log" | "txt" | "out" | "stderr" | "json" | "jsonlog" | "csv" | "csvlog"
            ) =>
        {
            true
        }
        _ => false,
    }
}

fn initialize_store_sync(db_path: &Path) -> Result<(), String> {
    let connection = Connection::open(db_path).map_err(|error| error.to_string())?;

    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
        .map_err(|error| error.to_string())?;

    migrate_legacy_store_if_needed(&connection)?;
    create_store_schema(&connection)
}

fn create_store_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS captured_queries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source_id TEXT NOT NULL,
              source_label TEXT NOT NULL,
              source_path TEXT NOT NULL,
              logged_at TEXT NOT NULL,
              pid INTEGER NOT NULL,
              database_name TEXT,
              user_name TEXT,
              application_name TEXT,
              session_id TEXT,
              line_num INTEGER,
              severity TEXT,
              sql_state_code TEXT,
              message TEXT,
              detail TEXT,
              hint TEXT,
              duration_text TEXT,
              query_text TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_captured_queries_source_logged_at
              ON captured_queries (source_id, logged_at DESC, id DESC);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_captured_queries_source_session_line
              ON captured_queries (source_id, session_id, line_num)
              WHERE session_id IS NOT NULL AND line_num IS NOT NULL;
            "#,
        )
        .map_err(|error| error.to_string())
}

fn migrate_legacy_store_if_needed(connection: &Connection) -> Result<(), String> {
    let table_exists = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'captured_queries'")
        .map_err(|error| error.to_string())?
        .exists([])
        .map_err(|error| error.to_string())?;

    if !table_exists {
        return Ok(());
    }

    let has_source_id = connection
        .prepare("PRAGMA table_info(captured_queries)")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .any(|column| column == "source_id");

    if has_source_id {
        return Ok(());
    }

    connection
        .execute_batch("ALTER TABLE captured_queries RENAME TO captured_queries_legacy;")
        .map_err(|error| error.to_string())?;

    create_store_schema(connection)?;

    connection
        .execute_batch(
            r#"
            INSERT INTO captured_queries (
              id,
              source_id,
              source_label,
              source_path,
              logged_at,
              pid,
              database_name,
              user_name,
              application_name,
              session_id,
              line_num,
              severity,
              sql_state_code,
              message,
              detail,
              hint,
              duration_text,
              query_text
            )
            SELECT
              id,
              '__legacy__',
              'Imported',
              '',
              logged_at,
              pid,
              database_name,
              user_name,
              application_name,
              session_id,
              line_num,
              severity,
              sql_state_code,
              message,
              detail,
              hint,
              duration_text,
              query_text
            FROM captured_queries_legacy;

            DROP TABLE captured_queries_legacy;
            "#,
        )
        .map_err(|error| error.to_string())
}

fn insert_captured_events_sync(
    db_path: &Path,
    source_meta: &CaptureSourceMeta,
    events: Vec<ParsedLogEvent>,
) -> Result<(), String> {
    let mut connection = Connection::open(db_path).map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    {
        let mut insert_statement = transaction
            .prepare(
                r#"
                INSERT OR IGNORE INTO captured_queries (
                  source_id,
                  source_label,
                  source_path,
                  logged_at,
                  pid,
                  database_name,
                  user_name,
                  application_name,
                  session_id,
                  line_num,
                  severity,
                  sql_state_code,
                  message,
                  detail,
                  hint,
                  duration_text,
                  query_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .map_err(|error| error.to_string())?;

        let mut update_duration_statement = transaction
            .prepare(
                r#"
                UPDATE captured_queries
                SET duration_text = ?
                WHERE id = (
                  SELECT id
                  FROM captured_queries
                  WHERE source_id = ?
                    AND pid = ?
                    AND (? IS NULL OR session_id = ?)
                    AND (duration_text IS NULL OR duration_text = '')
                  ORDER BY id DESC
                  LIMIT 1
                )
                "#,
            )
            .map_err(|error| error.to_string())?;

        for event in events {
            match event {
                ParsedLogEvent::Statement(record) => {
                    insert_statement
                        .execute(params![
                            &source_meta.source_id,
                            &source_meta.source_label,
                            &source_meta.source_path,
                            record.logged_at,
                            record.pid,
                            record.database,
                            record.user,
                            record.application_name,
                            record.session_id,
                            record.line_num,
                            record.severity,
                            record.sql_state_code,
                            record.message,
                            record.detail,
                            record.hint,
                            record.duration,
                            record.query_text,
                        ])
                        .map_err(|error| error.to_string())?;
                }
                ParsedLogEvent::Duration(duration) => {
                    update_duration_statement
                        .execute(params![
                            duration.duration_text,
                            &source_meta.source_id,
                            duration.pid,
                            duration.session_id.clone(),
                            duration.session_id,
                        ])
                        .map_err(|error| error.to_string())?;
                }
            }
        }

        transaction
            .execute(
                r#"
                DELETE FROM captured_queries
                WHERE source_id = ?1
                  AND id IN (
                    SELECT id
                    FROM captured_queries
                    WHERE source_id = ?1
                    ORDER BY logged_at DESC, id DESC
                    LIMIT -1 OFFSET ?2
                  )
                "#,
                params![&source_meta.source_id, CAPTURE_MAX_ROWS_PER_SOURCE],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn fetch_captured_queries_sync(
    db_path: &Path,
    source_id: &str,
) -> Result<Vec<CapturedQuery>, String> {
    let connection = Connection::open(db_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
              id,
              source_id,
              source_label,
              source_path,
              pid,
              database_name,
              user_name,
              application_name,
              severity,
              logged_at,
              duration_text,
              query_text
            FROM captured_queries
            WHERE source_id = ?
            ORDER BY logged_at DESC, id DESC
            LIMIT ?
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![source_id, CAPTURE_FETCH_LIMIT], |row| {
            Ok(CapturedQuery {
                capture_id: row.get(0)?,
                source_id: row.get(1)?,
                source_label: row.get(2)?,
                source_path: row.get(3)?,
                pid: row.get(4)?,
                database: row.get(5)?,
                user: row.get(6)?,
                application_name: row.get(7)?,
                state: row.get(8)?,
                wait_event_type: None,
                wait_event: None,
                query_start: row.get(9)?,
                duration: row.get(10)?,
                query: row.get(11)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn fetch_max_capture_id_sync(db_path: &Path, source_id: &str) -> Result<i64, String> {
    let connection = Connection::open(db_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT COALESCE(MAX(id), 0) FROM captured_queries WHERE source_id = ?1")
        .map_err(|error| error.to_string())?;

    statement
        .query_row([source_id], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn clear_captured_queries_sync(db_path: &Path, source_id: &str) -> Result<(), String> {
    let connection = Connection::open(db_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM captured_queries WHERE source_id = ?1",
            [source_id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("VACUUM", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}
