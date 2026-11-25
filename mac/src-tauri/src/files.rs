// Documents she chooses to show Pip (picked, or dropped on the window): the text only.
//
// Kith's minors policy (docs/minors-policy.md) rules out photo uploads until image-safety
// detection is in place, so images are refused here. The text goes to the server with her
// message and through the same safety check as anything she types.

use serde::Serialize;
use std::path::Path;

/// Enough for a few pages of homework; the server caps it too.
pub const MAX_CHARS: usize = 12_000;
const MAX_BYTES: u64 = 20 * 1024 * 1024;

pub const KINDS: &[&str] = &["pdf", "txt", "md", "markdown", "rtf", "doc", "docx", "odt", "html", "htm", "csv"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharedFile {
    pub name: String,
    pub text: String,
    pub truncated: bool,
}

pub fn read_document(path: &Path) -> Result<SharedFile, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ["png", "jpg", "jpeg", "heic", "gif", "webp", "tiff", "bmp", "mov", "mp4"].contains(&ext.as_str()) {
        return Err("Pip can't look at photos or videos yet, only documents (PDF, Word, text).".into());
    }
    if !KINDS.contains(&ext.as_str()) {
        return Err(format!("Pip can read PDFs, Word documents and text files, not .{ext} files."));
    }
    let meta = std::fs::metadata(path).map_err(|_| "Couldn't open that file.".to_string())?;
    if meta.len() > MAX_BYTES {
        return Err("That file is too big (20 MB at most).".into());
    }
    let text = match ext.as_str() {
        "txt" | "md" | "markdown" | "csv" => String::from_utf8_lossy(&std::fs::read(path).map_err(|e| e.to_string())?).to_string(),
        "pdf" => pdf_text(path)?,
        // rtf, doc, docx, odt, html: macOS's own converter.
        _ => {
            let out = std::process::Command::new("/usr/bin/textutil")
                .args(["-convert", "txt", "-stdout"])
                .arg(path)
                .output()
                .map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err("Couldn't read the text in that document.".into());
            }
            String::from_utf8_lossy(&out.stdout).to_string()
        }
    };
    let text = text.replace('\r', "").trim().to_string();
    if text.is_empty() {
        return Err("That document has no text Pip can read (it might be a scan).".into());
    }
    let truncated = text.chars().count() > MAX_CHARS;
    Ok(SharedFile { name: crate::eventkit::clip(&name, 120), text: crate::eventkit::clip(&text, MAX_CHARS), truncated })
}

#[cfg(target_os = "macos")]
fn pdf_text(path: &Path) -> Result<String, String> {
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSString, NSURL};
    use objc2_pdf_kit::PDFDocument;
    let p = path.to_str().ok_or("Bad file name.")?;
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(p));
        let doc = PDFDocument::initWithURL(PDFDocument::alloc(), &url).ok_or("Couldn't open that PDF.")?;
        Ok(doc.string().map(|s| s.to_string()).unwrap_or_default())
    }
}
