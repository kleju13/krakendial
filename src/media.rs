// User backgrounds (videos, GIFs, pictures) kept in %LOCALAPPDATA%\krakenlcd\media.
// Uploads are squared and shrunk to 640×640 with ffmpeg when it is installed: CAM decodes
// everything on the CPU, and a 4K 60 fps clip would cost far more than the dial itself.

use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

const MAX_UPLOAD: u64 = 1024 * 1024 * 1024;
const KINDS: [(&str, &str, &str); 7] = [
    ("mp4", "video/mp4", "video"),
    ("webm", "video/webm", "video"),
    ("gif", "image/gif", "gif"),
    ("png", "image/png", "image"),
    ("jpg", "image/jpeg", "image"),
    ("jpeg", "image/jpeg", "image"),
    ("webp", "image/webp", "image"),
];

pub fn dir() -> PathBuf {
    let d = crate::data_dir().join("media");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn kind(name: &str) -> Option<(&'static str, &'static str)> {
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    KINDS.iter().find(|k| k.0 == ext).map(|k| (k.1, k.2))
}

/// A plain file name with a known extension: nothing that could step outside the folder.
fn valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_alphanumeric() || " ._-()".contains(c))
        && kind(name).is_some()
}

pub fn bg_exists(bg: &str) -> bool {
    bg.strip_prefix("media:").is_some_and(|n| valid(n) && dir().join(n).is_file())
}

pub fn list() -> Value {
    let mut items: Vec<Value> = std::fs::read_dir(dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let (_, k) = kind(&name).filter(|_| valid(&name))?;
            Some(json!({ "name": name, "kind": k, "size": e.metadata().ok()?.len() }))
        })
        .collect();
    items.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Value::Array(items)
}

pub fn open(name: &str) -> Option<(std::fs::File, &'static str)> {
    let name = decode(name)?;
    if !valid(&name) {
        return None;
    }
    Some((std::fs::File::open(dir().join(&name)).ok()?, kind(&name)?.0))
}

pub fn remove(name: &str) {
    if valid(name) {
        let _ = std::fs::remove_file(dir().join(name));
    }
}

/// `name=<percent-encoded file name>` from a query string.
pub fn query_name(query: &str) -> Option<String> {
    let raw = query.split('&').find_map(|kv| kv.strip_prefix("name="))?;
    decode(raw).filter(|n| valid(n))
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Stores an upload and returns the name it will end up under. Moving pictures are converted
/// in the background and only appear under that name (always .mp4) once ffmpeg is done, so the
/// dial never picks up a 4K original.
pub fn save(name: &str, body: &mut dyn Read) -> Result<String, String> {
    let dest = dir().join(name);
    let upload = dir().join(format!("{name}.upload"));
    let mut f = std::fs::File::create(&upload).map_err(|e| e.to_string())?;
    let n = std::io::copy(&mut body.take(MAX_UPLOAD + 1), &mut f).map_err(|e| e.to_string())?;
    drop(f);
    if n == 0 || n > MAX_UPLOAD {
        let _ = std::fs::remove_file(&upload);
        return Err("plik pusty albo za duży".into());
    }
    if !matches!(kind(name), Some((_, "video" | "gif"))) || !has_ffmpeg() {
        std::fs::rename(&upload, &dest).map_err(|e| e.to_string())?;
        return Ok(name.to_string());
    }
    let out = dest.with_extension("mp4");
    let saved = out.file_name().unwrap().to_string_lossy().into_owned();
    std::thread::spawn(move || shrink(upload, out));
    Ok(saved)
}

fn ffmpeg() -> std::process::Command {
    let mut cmd = std::process::Command::new("ffmpeg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    cmd
}

fn has_ffmpeg() -> bool {
    ffmpeg().arg("-version").output().is_ok_and(|o| o.status.success())
}

/// Square crop, 640×640, 30 fps, H.264. If ffmpeg can't read it, the original is kept as is.
fn shrink(src: PathBuf, dst: PathBuf) {
    let tmp = dst.with_extension("mp4.part");
    let mut cmd = ffmpeg();
    cmd.args(["-v", "error", "-y", "-i"])
        .arg(&src)
        .args([
            "-vf",
            "crop='min(iw,ih)':'min(iw,ih)',scale=640:640:flags=lanczos,fps=30",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(&tmp);
    if cmd.status().is_ok_and(|s| s.success()) && std::fs::rename(&tmp, &dst).is_ok() {
        let _ = std::fs::remove_file(&src);
        return;
    }
    let _ = std::fs::remove_file(&tmp);
    crate::log(&format!("media: ffmpeg could not convert {}, keeping the original", src.display()));
    let _ = std::fs::rename(&src, src.with_extension(""));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_inside_the_folder() {
        assert!(valid("kwiaty katana.mp4"));
        assert!(valid("Frieren (1).gif"));
        assert!(!valid("../config.json"));
        assert!(!valid("..\\x.mp4"));
        assert!(!valid("a/b.mp4"));
        assert!(!valid(".hidden.mp4"));
        assert!(!valid("script.js"));
        assert_eq!(decode("kwiaty%20katana.mp4").as_deref(), Some("kwiaty katana.mp4"));
        assert_eq!(query_name("name=..%2Fx.mp4"), None);
    }
}
