//! Content-addressed storage for imported source documents and attachments,
//! plus full-library backup archives.
//!
//! Layout under `<data dir>/files`:
//!   sources/<h0h1>/<sha256>.<ext>
//!   attachments/<h0h1>/<sha256>.<ext>
//! Files are never modified or deleted by imports; identical content is stored once.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use crate::db::err;

pub const KINDS: [&str; 2] = ["sources", "attachments"];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    pub stored_path: String,
    pub hash: String,
    pub size: u64,
    pub already_existed: bool,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn clean_ext(ext: &str) -> String {
    ext.trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(10)
        .collect::<String>()
        .to_ascii_lowercase()
}

pub fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| clean_ext(&e.to_string_lossy()))
        .unwrap_or_default()
}

/// Rejects absolute paths and `..` so relative stored paths stay inside `base`.
pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    for c in rel_path.components() {
        match c {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err(format!("invalid stored path: {rel}")),
        }
    }
    Ok(base.join(rel_path))
}

pub fn store_bytes(files_dir: &Path, kind: &str, bytes: &[u8], name: &str) -> Result<StoredFile, String> {
    if !KINDS.contains(&kind) {
        return Err(format!("unknown file kind: {kind}"));
    }
    let hash = sha256_hex(bytes);
    let ext = ext_of(name);
    let file_name = if ext.is_empty() { hash.clone() } else { format!("{hash}.{ext}") };
    let rel = format!("{kind}/{}/{}", &hash[..2], file_name);
    let abs = safe_join(files_dir, &rel)?;
    let already_existed = abs.exists();
    if !already_existed {
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        // Write to a temporary file first so a crash never leaves a truncated file behind.
        let tmp = abs.with_extension("partial");
        {
            let mut f = fs::File::create(&tmp).map_err(err)?;
            f.write_all(bytes).map_err(err)?;
            f.sync_all().map_err(err)?;
        }
        fs::rename(&tmp, &abs).map_err(err)?;
    }
    Ok(StoredFile { stored_path: rel, hash, size: bytes.len() as u64, already_existed })
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_dir() {
            walk(&p, out)?;
        } else {
            out.push(p);
        }
    }
    Ok(())
}

/// Writes `library.json`, an optional SQLite snapshot and every stored file into one zip.
pub fn write_backup_archive(
    dest: &Path,
    library_json: &str,
    files_dir: &Path,
    db_snapshot: Option<&Path>,
) -> Result<usize, String> {
    use zip::write::SimpleFileOptions;
    let tmp = dest.with_extension("partial");
    let file = fs::File::create(&tmp).map_err(err)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);

    zip.start_file("library.json", opts).map_err(err)?;
    zip.write_all(library_json.as_bytes()).map_err(err)?;

    zip.start_file("README.txt", opts).map_err(err)?;
    zip.write_all(
        "Marée library backup.\r\n\r\n\
library.json  - complete library in the documented Marée JSON format (docs/SCHEMA.md)\r\n\
maree.sqlite  - point-in-time copy of the SQLite database\r\n\
files/        - original source documents and attachments (content-addressed)\r\n\r\n\
Restore with File > Import > Restore Library Backup.\r\n"
            .as_bytes(),
    )
    .map_err(err)?;

    if let Some(snap) = db_snapshot {
        if snap.exists() {
            zip.start_file("maree.sqlite", opts).map_err(err)?;
            let mut f = fs::File::open(snap).map_err(err)?;
            std::io::copy(&mut f, &mut zip).map_err(err)?;
        }
    }

    let mut paths = Vec::new();
    walk(files_dir, &mut paths).map_err(err)?;
    let mut count = 0usize;
    for p in paths {
        if p.extension().map(|e| e == "partial").unwrap_or(false) {
            continue;
        }
        let rel = p.strip_prefix(files_dir).map_err(err)?;
        let name = format!("files/{}", rel.to_string_lossy().replace('\\', "/"));
        zip.start_file(name, opts).map_err(err)?;
        let mut f = fs::File::open(&p).map_err(err)?;
        std::io::copy(&mut f, &mut zip).map_err(err)?;
        count += 1;
    }
    zip.finish().map_err(err)?;
    if dest.exists() {
        fs::remove_file(dest).map_err(err)?;
    }
    fs::rename(&tmp, dest).map_err(err)?;
    Ok(count)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupContents {
    pub library_json: String,
    pub files_restored: usize,
    pub files_skipped: usize,
}

/// Reads `library.json` and copies stored files that are not yet present. Never overwrites.
pub fn read_backup_archive(src: &Path, files_dir: &Path) -> Result<BackupContents, String> {
    let file = fs::File::open(src).map_err(err)?;
    let mut zip = zip::ZipArchive::new(file).map_err(err)?;
    let mut library_json = String::new();
    {
        let mut entry = zip
            .by_name("library.json")
            .map_err(|_| "This archive does not contain library.json; it is not a Marée backup.".to_string())?;
        entry.read_to_string(&mut library_json).map_err(err)?;
    }
    let mut files_restored = 0;
    let mut files_skipped = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(err)?;
        let name = entry.name().to_string();
        let Some(rel) = name.strip_prefix("files/") else { continue };
        if rel.is_empty() || name.ends_with('/') {
            continue;
        }
        let target = safe_join(files_dir, rel)?;
        if target.exists() {
            files_skipped += 1;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        let mut out = fs::File::create(&target).map_err(err)?;
        std::io::copy(&mut entry, &mut out).map_err(err)?;
        files_restored += 1;
    }
    Ok(BackupContents { library_json, files_restored, files_skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_addressed_store_dedupes() {
        let dir = tempfile::tempdir().unwrap();
        let a = store_bytes(dir.path(), "sources", b"hello", "Notes.PDF").unwrap();
        let b = store_bytes(dir.path(), "sources", b"hello", "copy.pdf").unwrap();
        assert_eq!(a.stored_path, b.stored_path);
        assert!(a.stored_path.ends_with(".pdf"));
        assert!(!a.already_existed);
        assert!(b.already_existed);
        assert!(store_bytes(dir.path(), "../evil", b"x", "a").is_err());
    }

    #[test]
    fn safe_join_rejects_traversal() {
        let base = Path::new("C:/data");
        assert!(safe_join(base, "../x").is_err());
        assert!(safe_join(base, "sources/ab/x.pdf").is_ok());
    }

    #[test]
    fn backup_roundtrip() {
        let data = tempfile::tempdir().unwrap();
        let files_dir = data.path().join("files");
        store_bytes(&files_dir, "attachments", b"png-bytes", "fig.png").unwrap();
        let dest = data.path().join("backup.zip");
        let n = write_backup_archive(&dest, "{\"format\":\"maree-library\"}", &files_dir, None).unwrap();
        assert_eq!(n, 1);

        let other = tempfile::tempdir().unwrap();
        let contents = read_backup_archive(&dest, &other.path().join("files")).unwrap();
        assert!(contents.library_json.contains("maree-library"));
        assert_eq!(contents.files_restored, 1);
        let again = read_backup_archive(&dest, &other.path().join("files")).unwrap();
        assert_eq!(again.files_skipped, 1);
    }
}
