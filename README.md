# PostgreSQL Query Log Monitor

`PostgreSQL Query Log Monitor` is a free, open-source desktop app for capturing and inspecting PostgreSQL query logs.

It is built with Tauri, React, TypeScript, and a Rust backend. Instead of polling `pg_stat_activity`, the current product reads PostgreSQL log files, stores captured statements locally in SQLite, and presents them in a table-first desktop UI with filters, details, pagination, and per-source history.

## What It Does

- Reads PostgreSQL query logs from `current_logfiles` or a concrete log file
- Supports `jsonlog`, `csvlog`, and `stderr` log formats
- Lets you save multiple named sources and switch between them
- Validates selected files before capture starts
- Shows newest statements first with column filters and pagination
- Opens full SQL details in a drawer instead of wasting permanent screen space
- Stores captured statements locally so you can pause, stop, clear, and revisit sources

## How It Works

This app is file-source based.

It does **not** connect directly to PostgreSQL for its main capture path. PostgreSQL writes log records to disk, and the app tails those files.

That makes it much more reliable for short queries than polling `pg_stat_activity`, as long as PostgreSQL is configured to log the statements you care about.

## Recommended PostgreSQL Configuration

For the best results, enable structured logging:

```conf
logging_collector = on
log_destination = 'stderr,jsonlog'
log_statement = 'all'
log_duration = on
log_min_error_statement = error
log_line_prefix = '%m [%p] %q%u@%d/%a '
```

Recommended source path:

- PostgreSQL `current_logfiles`

Example on Windows:

```text
C:\Program Files\PostgreSQL\17\data\current_logfiles
```

The app can resolve `current_logfiles` dynamically and follow the active `jsonlog`, `csvlog`, or `stderr` file behind it.

## Important Behavior

### Start from now

By default, `Start` begins at the current end of the resolved log file.

That means only new lines written after capture starts are imported.

### Include lines already in this file

If you enable `Include lines already in this file`, the app will also import lines that already exist in the currently resolved file.

This is **file-based**, not time-based:

- it reads the current file only
- it does not automatically walk older rotated log files
- it is not “last hour” or “everything ever”

### Local retention

Captured statements are stored in a local SQLite database inside the app data directory.

The app currently keeps up to **100,000 rows per source** and prunes older rows automatically.

## Limitations

- The app only sees what PostgreSQL is configured to log
- If `log_statement` is too restrictive, some statements will never appear
- `stderr` parsing works, but `jsonlog` is the preferred format
- Historical rotated log files are not automatically imported
- Only one source is actively watched at a time

## Privacy and Security Notes

- Query text may contain sensitive data depending on your PostgreSQL workload
- Captured statements are stored locally on the machine running the app
- Review your PostgreSQL logging policy before enabling `log_statement = 'all'` in production

## Development

### Prerequisites

- Node.js 20+
- Rust stable toolchain
- Visual Studio C++ build tools on Windows

### Install

```powershell
npm install
```

### Run in development

```powershell
npm run tauri dev
```

### Frontend type-check

```powershell
npm run check
```

### Frontend production build

```powershell
npm run build
```

### Rust check

```powershell
cd src-tauri
cargo check
```

## Project Structure

```text
src/
  components/
  hooks/
  lib/
  pages/
  types/

src-tauri/
  src/
    capture.rs
    commands.rs
    models.rs
    lib.rs
```

## Publish Notes

This repository is intended for desktop distribution through Tauri bundles.

Before shipping a public release, make sure you test:

- PostgreSQL `jsonlog` on your target OS
- `current_logfiles` resolution
- installer/startup behavior
- long-running capture sessions against realistic log volume

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
