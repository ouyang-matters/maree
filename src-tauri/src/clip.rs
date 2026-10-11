//! Clipboard with several images at once. Browsers on Windows turn a file list (CF_HDROP)
//! into separate attachments on paste, so "Copy for ChatGPT" places the problem and the
//! answer as files, plus one combined picture for programs that only accept a bitmap.

use std::fs;
use std::path::Path;

/// Writes `files` (name, bytes) into `dir` (emptied first) and puts them on the clipboard.
pub fn copy_images(dir: &Path, files: &[(String, Vec<u8>)], combined_png: Option<&[u8]>, combined_bmp: Option<&[u8]>) -> Result<usize, String> {
    if dir.exists() {
        for e in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
            let _ = fs::remove_file(e.path());
        }
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // The receiving program resolves these paths, so they must be absolute.
    let dir = std::path::absolute(dir).map_err(|e| e.to_string())?;
    let mut paths: Vec<String> = Vec::new();
    for (name, bytes) in files {
        let safe: String = name
            .chars()
            .map(|c| if c.is_alphanumeric() || " -_.()".contains(c) { c } else { '_' })
            .collect();
        let p = dir.join(if safe.trim().is_empty() { "image.png".to_string() } else { safe });
        fs::write(&p, bytes).map_err(|e| e.to_string())?;
        paths.push(p.to_string_lossy().to_string());
    }
    set_clipboard(&paths, combined_png, combined_bmp)?;
    Ok(paths.len())
}

#[cfg(windows)]
fn set_clipboard(paths: &[String], png: Option<&[u8]>, bmp: Option<&[u8]>) -> Result<(), String> {
    use clipboard_win::{options::NoClear, raw, register_format, Clipboard};
    let _open = Clipboard::new_attempts(10).map_err(|e| format!("Clipboard unavailable: {e}"))?;
    raw::empty().map_err(|e| e.to_string())?;
    if !paths.is_empty() {
        raw::set_file_list_with(paths, NoClear).map_err(|e| e.to_string())?;
    }
    if let (Some(png), Some(fmt)) = (png, register_format("PNG")) {
        raw::set_without_clear(fmt.get(), png).map_err(|e| e.to_string())?;
    }
    if let Some(bmp) = bmp {
        raw::set_bitmap_with(bmp, NoClear).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_clipboard(_paths: &[String], _png: Option<&[u8]>, _bmp: Option<&[u8]>) -> Result<(), String> {
    Err("Copying images is only supported on Windows.".into())
}
