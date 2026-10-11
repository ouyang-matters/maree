//! Marée desktop shell: window, local SQLite bridge, file storage and backups.

mod db;
mod files;

use db::{err, Db, ExecResult, Stmt};
use files::StoredFile;
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};

/// Number of automatic database snapshots kept in `<data dir>/backups`.
const AUTO_SNAPSHOTS_KEPT: usize = 10;
/// Minimum interval between automatic snapshots taken at startup.
const AUTO_SNAPSHOT_INTERVAL_SECS: u64 = 20 * 60 * 60;
/// How long the UI gets to save and close the window after a close request.
const CLOSE_WATCHDOG_SECS: u64 = 6;

pub struct Paths {
    pub data_dir: PathBuf,
    pub files_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub portable: bool,
    pub e2e: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    db_path: String,
    files_dir: String,
    backups_dir: String,
    portable: bool,
    e2e: bool,
    last_snapshot: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `YYYYMMDD-HHMMSS` in UTC without pulling in a date library.
fn timestamp_label(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn resolve_paths(app: &tauri::AppHandle) -> Result<Paths, String> {
    let e2e = std::env::var("MAREE_E2E").map(|v| v == "1").unwrap_or(false);
    if let Ok(dir) = std::env::var("MAREE_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(make_paths(PathBuf::from(dir), false, e2e));
        }
    }
    // Portable mode: a file named `portable` next to the executable keeps data beside it.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            if exe_dir.join("portable").exists() {
                return Ok(make_paths(exe_dir.join("MareeData"), true, e2e));
            }
        }
    }
    let dir = app.path().app_data_dir().map_err(err)?;
    Ok(make_paths(dir, false, e2e))
}

fn make_paths(data_dir: PathBuf, portable: bool, e2e: bool) -> Paths {
    Paths {
        files_dir: data_dir.join("files"),
        backups_dir: data_dir.join("backups"),
        data_dir,
        portable,
        e2e,
    }
}

fn list_snapshots(backups_dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(backups_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| {
                    p.file_name()
                        .map(|n| {
                            let n = n.to_string_lossy();
                            n.starts_with("auto-") && n.ends_with(".sqlite")
                        })
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Takes a rolling automatic snapshot at startup if the newest one is old enough.
fn auto_snapshot(conn: &rusqlite::Connection, backups_dir: &Path) -> Result<Option<PathBuf>, String> {
    fs::create_dir_all(backups_dir).map_err(err)?;
    let existing = list_snapshots(backups_dir);
    if let Some(latest) = existing.last() {
        let modified = fs::metadata(latest)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if now_secs().saturating_sub(modified) < AUTO_SNAPSHOT_INTERVAL_SECS {
            return Ok(None);
        }
    }
    // Skip empty, freshly-created databases.
    let tables: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))
        .map_err(err)?;
    if tables == 0 {
        return Ok(None);
    }
    let dest = backups_dir.join(format!("auto-{}.sqlite", timestamp_label(now_secs())));
    db::snapshot(conn, &dest)?;
    let mut all = list_snapshots(backups_dir);
    while all.len() > AUTO_SNAPSHOTS_KEPT {
        let old = all.remove(0);
        let _ = fs::remove_file(old);
    }
    Ok(Some(dest))
}

// ---------------------------------------------------------------- database

#[tauri::command(async)]
fn db_select(db: State<'_, Db>, sql: String, params: Option<Vec<Value>>) -> Result<Vec<Map<String, Value>>, String> {
    let conn = db.conn.lock().map_err(err)?;
    db::select(&conn, &sql, &params.unwrap_or_default())
}

#[tauri::command(async)]
fn db_execute(db: State<'_, Db>, sql: String, params: Option<Vec<Value>>) -> Result<ExecResult, String> {
    let conn = db.conn.lock().map_err(err)?;
    db::execute(&conn, &sql, &params.unwrap_or_default())
}

#[tauri::command(async)]
fn db_batch(db: State<'_, Db>, statements: Vec<Stmt>) -> Result<usize, String> {
    let mut conn = db.conn.lock().map_err(err)?;
    db::batch(&mut conn, &statements)
}

/// Snapshot into the backups folder with a caller-provided label (e.g. "pre-migration-v2").
#[tauri::command(async)]
fn db_snapshot(db: State<'_, Db>, paths: State<'_, Paths>, label: String) -> Result<String, String> {
    let safe: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let dest = paths.backups_dir.join(format!("{}-{}.sqlite", safe, timestamp_label(now_secs())));
    let conn = db.conn.lock().map_err(err)?;
    db::snapshot(&conn, &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, db: State<'_, Db>, paths: State<'_, Paths>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: paths.data_dir.to_string_lossy().to_string(),
        db_path: db.path.to_string_lossy().to_string(),
        files_dir: paths.files_dir.to_string_lossy().to_string(),
        backups_dir: paths.backups_dir.to_string_lossy().to_string(),
        portable: paths.portable,
        e2e: paths.e2e,
        last_snapshot: list_snapshots(&paths.backups_dir)
            .last()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

// ------------------------------------------------------------------- files

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    name: String,
    path: String,
    size: u64,
    exists: bool,
}

#[tauri::command(async)]
fn file_info(path: String) -> FileInfo {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).ok();
    FileInfo {
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        exists: meta.map(|m| m.is_file()).unwrap_or(false),
        path,
    }
}

/// Reads a user-selected file (import, drag-and-drop) as raw bytes.
#[tauri::command(async)]
fn read_external_file(path: String) -> Result<Response, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command(async)]
fn read_stored_file(paths: State<'_, Paths>, stored_path: String) -> Result<Response, String> {
    let p = files::safe_join(&paths.files_dir, &stored_path)?;
    let bytes = fs::read(&p).map_err(|e| format!("Stored file missing ({stored_path}): {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command(async)]
fn stored_file_path(paths: State<'_, Paths>, stored_path: String) -> Result<String, String> {
    Ok(files::safe_join(&paths.files_dir, &stored_path)?.to_string_lossy().to_string())
}

#[tauri::command(async)]
fn store_file_from_path(paths: State<'_, Paths>, path: String, kind: String) -> Result<StoredFile, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    files::store_bytes(&paths.files_dir, &kind, &bytes, &name)
}

fn header(request: &Request<'_>, key: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(key)
        .ok_or_else(|| format!("missing header {key}"))?
        .to_str()
        .map_err(err)?;
    Ok(percent_decode(raw))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Raw-body upload: headers `x-kind` and `x-name` (URI-encoded), body = file bytes.
#[tauri::command(async)]
fn store_file_bytes(paths: State<'_, Paths>, request: Request<'_>) -> Result<StoredFile, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let kind = header(&request, "x-kind")?;
    let name = header(&request, "x-name")?;
    files::store_bytes(&paths.files_dir, &kind, bytes, &name)
}

#[tauri::command(async)]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), contents.as_bytes())
}

/// Raw-body write: header `x-path` (URI-encoded), body = bytes.
#[tauri::command(async)]
fn write_binary_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let path = header(&request, "x-path")?;
    write_atomic(Path::new(&path), bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = path.with_extension("maree-partial");
    fs::write(&tmp, bytes).map_err(err)?;
    if path.exists() {
        fs::remove_file(path).map_err(err)?;
    }
    fs::rename(&tmp, path).map_err(err)
}

// ----------------------------------------------------------------- backups

#[tauri::command(async)]
fn create_backup_archive(
    db: State<'_, Db>,
    paths: State<'_, Paths>,
    dest: String,
    library_json: String,
) -> Result<usize, String> {
    let snap = paths.backups_dir.join(format!("export-{}.sqlite", timestamp_label(now_secs())));
    {
        let conn = db.conn.lock().map_err(err)?;
        db::snapshot(&conn, &snap)?;
    }
    let result = files::write_backup_archive(Path::new(&dest), &library_json, &paths.files_dir, Some(&snap));
    let _ = fs::remove_file(&snap);
    result
}

#[tauri::command(async)]
fn read_backup_archive(paths: State<'_, Paths>, path: String) -> Result<files::BackupContents, String> {
    files::read_backup_archive(Path::new(&path), &paths.files_dir)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            // The UI saves pending edits and then closes the window itself. If the web view
            // does not answer (e.g. it is stalled), close anyway so the app never refuses to quit.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(CLOSE_WATCHDOG_SECS));
                    let _ = w.destroy();
                });
            }
        })
        .setup(|app| {
            let paths = resolve_paths(app.handle())?;
            fs::create_dir_all(&paths.data_dir)?;
            fs::create_dir_all(&paths.files_dir)?;
            fs::create_dir_all(&paths.backups_dir)?;
            let db_path = paths.data_dir.join("maree.db");
            let conn = db::open(&db_path)?;
            if let Err(e) = auto_snapshot(&conn, &paths.backups_dir) {
                eprintln!("automatic snapshot failed: {e}");
            }
            app.manage(Db { conn: Mutex::new(conn), path: db_path });
            app.manage(paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            db_batch,
            db_snapshot,
            app_info,
            file_info,
            read_external_file,
            read_stored_file,
            stored_file_path,
            store_file_from_path,
            store_file_bytes,
            write_text_file,
            write_binary_file,
            create_backup_archive,
            read_backup_archive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Marée");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_label_formats_utc() {
        assert_eq!(timestamp_label(0), "19700101-000000");
        assert_eq!(timestamp_label(1_760_140_800), "20251011-000000");
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("Mar%C3%A9e%20notes.pdf"), "Marée notes.pdf");
        assert_eq!(percent_decode("plain"), "plain");
    }
}
