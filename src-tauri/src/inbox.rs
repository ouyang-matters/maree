//! Photo inbox: pictures sent from the phone (or collected from a watched folder) wait
//! here until they are cropped into problems and answers. Each item is an image file
//! plus a JSON sidecar; the sidecar is written last, so a listed item is always complete.

use crate::files::sha256_hex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Processed and discarded photos stay in `inbox/archive` for this long.
const ARCHIVE_DAYS: u64 = 30;
/// Largest photo accepted from the phone or a folder.
pub const MAX_IMAGE_BYTES: usize = 40 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub file_name: String,
    /// "question", "answer" or "unknown".
    pub kind: String,
    pub problem_id: Option<String>,
    pub note: String,
    /// "phone", "folder" or "desktop".
    pub origin: String,
    pub original_name: String,
    /// Milliseconds since the Unix epoch.
    pub received_at: u64,
    pub size: u64,
    pub hash: String,
}

pub struct NewItem<'a> {
    pub bytes: &'a [u8],
    pub kind: &'a str,
    pub problem_id: Option<String>,
    pub note: &'a str,
    pub origin: &'a str,
    pub original_name: &'a str,
}

pub fn inbox_dir(files_dir: &Path) -> PathBuf {
    files_dir.join("inbox")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Recognises the image formats the web view can decode.
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn clean_kind(kind: &str) -> &'static str {
    match kind {
        "question" => "question",
        "answer" => "answer",
        _ => "unknown",
    }
}

pub fn list(dir: &Path) -> Vec<InboxItem> {
    let mut items: Vec<InboxItem> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
                .filter_map(|p| fs::read_to_string(&p).ok())
                .filter_map(|s| serde_json::from_str::<InboxItem>(&s).ok())
                .filter(|it| dir.join(&it.file_name).is_file())
                .collect()
        })
        .unwrap_or_default();
    items.sort_by(|a, b| a.received_at.cmp(&b.received_at).then(a.id.cmp(&b.id)));
    items
}

/// Stores a photo. A photo that is already waiting (same bytes) is not added twice,
/// so a phone retrying after a dropped connection never creates duplicates.
pub fn add(dir: &Path, item: NewItem<'_>) -> Result<InboxItem, String> {
    if item.bytes.len() > MAX_IMAGE_BYTES {
        return Err("The photo is too large.".into());
    }
    let ext = image_ext(item.bytes).ok_or("Only JPEG, PNG and WebP images can be added to the inbox.")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let hash = sha256_hex(item.bytes);
    if let Some(existing) = list(dir).into_iter().find(|it| it.hash == hash) {
        return Ok(existing);
    }
    let received_at = now_ms();
    let id = format!("{}-{}", received_at, &hash[..10]);
    let file_name = format!("{id}.{ext}");
    let tmp = dir.join(format!("{id}.partial"));
    fs::write(&tmp, item.bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(&file_name)).map_err(|e| e.to_string())?;
    let rec = InboxItem {
        id: id.clone(),
        file_name,
        kind: clean_kind(item.kind).to_string(),
        problem_id: item.problem_id.filter(|s| !s.trim().is_empty()),
        note: item.note.chars().take(500).collect(),
        origin: item.origin.to_string(),
        original_name: item.original_name.chars().take(200).collect(),
        received_at,
        size: item.bytes.len() as u64,
        hash,
    };
    let json = serde_json::to_string_pretty(&rec).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{id}.json")), json).map_err(|e| e.to_string())?;
    Ok(rec)
}

fn find(dir: &Path, id: &str) -> Result<InboxItem, String> {
    list(dir).into_iter().find(|it| it.id == id).ok_or_else(|| "This photo is no longer in the inbox.".to_string())
}

pub fn read(dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let it = find(dir, id)?;
    fs::read(dir.join(&it.file_name)).map_err(|e| e.to_string())
}

/// Moves a processed or discarded photo out of the inbox (kept for `ARCHIVE_DAYS`).
pub fn archive(dir: &Path, id: &str) -> Result<(), String> {
    let it = find(dir, id)?;
    let arch = dir.join("archive");
    fs::create_dir_all(&arch).map_err(|e| e.to_string())?;
    fs::rename(dir.join(&it.file_name), arch.join(&it.file_name)).map_err(|e| e.to_string())?;
    fs::rename(dir.join(format!("{}.json", it.id)), arch.join(format!("{}.json", it.id))).map_err(|e| e.to_string())?;
    Ok(())
}

/// Puts an archived photo back into the inbox (undo).
pub fn restore(dir: &Path, id: &str) -> Result<(), String> {
    let arch = dir.join("archive");
    let it = list(&arch).into_iter().find(|it| it.id == id).ok_or("This photo can no longer be restored.")?;
    fs::rename(arch.join(&it.file_name), dir.join(&it.file_name)).map_err(|e| e.to_string())?;
    fs::rename(arch.join(format!("{}.json", it.id)), dir.join(format!("{}.json", it.id))).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn prune_archive(dir: &Path) {
    let arch = dir.join("archive");
    let cutoff = SystemTime::now() - Duration::from_secs(ARCHIVE_DAYS * 86_400);
    if let Ok(rd) = fs::read_dir(&arch) {
        for p in rd.filter_map(|e| e.ok().map(|e| e.path())) {
            let old = fs::metadata(&p).and_then(|m| m.modified()).map(|t| t < cutoff).unwrap_or(false);
            if old {
                let _ = fs::remove_file(p);
            }
        }
    }
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollectResult {
    pub added: usize,
    /// HEIC photos cannot be shown by the web view; the user is told to switch the camera to JPEG.
    pub skipped_heic: usize,
}

/// Copies new photos from a watched folder (e.g. a Google Drive folder the phone uploads
/// to). The folder itself is never modified; collected files are remembered by hash.
pub fn collect_folder(dir: &Path, folder: &Path) -> Result<CollectResult, String> {
    let rd = fs::read_dir(folder).map_err(|e| format!("Could not read {}: {e}", folder.display()))?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let seen_path = dir.join("collected.txt");
    let mut seen: Vec<String> = fs::read_to_string(&seen_path).unwrap_or_default().lines().map(str::to_string).collect();
    let mut res = CollectResult::default();
    let settle = SystemTime::now() - Duration::from_secs(3);
    let mut paths: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_file()).collect();
    paths.sort();
    for p in paths {
        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        if ext == "heic" || ext == "heif" {
            res.skipped_heic += 1;
            continue;
        }
        if !["jpg", "jpeg", "png", "webp"].contains(&ext.as_str()) {
            continue;
        }
        let meta = match fs::metadata(&p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        // Skip files that are still being written by a sync client.
        if meta.modified().map(|t| t > settle).unwrap_or(true) || meta.len() as usize > MAX_IMAGE_BYTES {
            continue;
        }
        let bytes = match fs::read(&p) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let hash = sha256_hex(&bytes);
        if seen.contains(&hash) {
            continue;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if add(dir, NewItem { bytes: &bytes, kind: "unknown", problem_id: None, note: "", origin: "folder", original_name: &name }).is_ok() {
            res.added += 1;
        }
        seen.push(hash);
    }
    fs::write(&seen_path, seen.join("\n")).map_err(|e| e.to_string())?;
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F'];

    #[test]
    fn add_list_archive_restore() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = inbox_dir(tmp.path());
        let a = add(&dir, NewItem { bytes: JPEG, kind: "answer", problem_id: Some("prb_1".into()), note: "", origin: "phone", original_name: "IMG_1.jpg" }).unwrap();
        assert_eq!(a.kind, "answer");
        assert!(a.file_name.ends_with(".jpg"));
        // Same bytes again: no duplicate.
        let again = add(&dir, NewItem { bytes: JPEG, kind: "question", problem_id: None, note: "", origin: "phone", original_name: "x.jpg" }).unwrap();
        assert_eq!(again.id, a.id);
        assert_eq!(list(&dir).len(), 1);
        assert_eq!(read(&dir, &a.id).unwrap(), JPEG);
        archive(&dir, &a.id).unwrap();
        assert!(list(&dir).is_empty());
        restore(&dir, &a.id).unwrap();
        assert_eq!(list(&dir).len(), 1);
    }

    #[test]
    fn rejects_non_images() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = inbox_dir(tmp.path());
        assert!(add(&dir, NewItem { bytes: b"%PDF-1.7", kind: "question", problem_id: None, note: "", origin: "phone", original_name: "a.pdf" }).is_err());
    }

    #[test]
    fn collects_folder_once_without_touching_it() {
        let tmp = tempfile::tempdir().unwrap();
        let watched = tmp.path().join("watched");
        fs::create_dir_all(&watched).unwrap();
        fs::write(watched.join("a.jpg"), JPEG).unwrap();
        fs::write(watched.join("b.heic"), b"....ftypheic").unwrap();
        fs::write(watched.join("notes.txt"), b"hello").unwrap();
        // Make the files look settled.
        let old = SystemTime::now() - Duration::from_secs(60);
        for n in ["a.jpg", "b.heic", "notes.txt"] {
            let f = fs::File::options().write(true).open(watched.join(n)).unwrap();
            f.set_modified(old).unwrap();
        }
        let dir = inbox_dir(tmp.path());
        let r = collect_folder(&dir, &watched).unwrap();
        assert_eq!((r.added, r.skipped_heic), (1, 1));
        archive(&dir, &list(&dir)[0].id).unwrap();
        let r2 = collect_folder(&dir, &watched).unwrap();
        assert_eq!(r2.added, 0, "already collected photos are not collected again");
        assert!(watched.join("a.jpg").exists());
    }
}
