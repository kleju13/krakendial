// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
//! Updates from the GitHub releases that release.yml publishes. KrakenDial asks for the latest
//! one once at start, and again from the settings page. Installing downloads krakendial.exe,
//! checks it against the release's SHA-256, puts it in place of the running exe, which Windows
//! allows by renaming, and starts it. The new copy waits for this one to let go of the port.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

const LATEST: &str = "https://api.github.com/repos/kleju13/krakendial/releases/latest";
const EXE: &str = "krakendial.exe";
/// Passed to the new copy: wait for the port rather than quit when it is taken.
pub const TAKE_OVER: &str = "--take-over";

#[derive(Clone, Debug, Default, Serialize)]
pub struct State {
    /// `checking`, `downloading` or `restarting` while that runs.
    pub busy: Option<&'static str>,
    /// The latest release's version, once a check got it.
    pub latest: Option<String>,
    /// The latest release is newer than this copy.
    pub available: bool,
    /// What went wrong the last time.
    pub error: Option<String>,
    #[serde(skip)]
    release: Option<Release>,
}

#[derive(Clone, Debug)]
struct Release {
    version: String,
    exe: String,
    sum: String,
}

static STATE: Mutex<State> = Mutex::new(State { busy: None, latest: None, available: false, error: None, release: None });

fn lock() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn state() -> State {
    lock().clone()
}

fn begin(busy: &'static str) -> Result<(), String> {
    let mut s = lock();
    if let Some(b) = s.busy {
        return Err(format!("KrakenDial is already {b}"));
    }
    s.busy = Some(busy);
    s.error = None;
    Ok(())
}

fn fail(e: String) {
    crate::log(&format!("update: {e}"));
    let mut s = lock();
    s.busy = None;
    s.error = Some(e);
}

fn agent() -> ureq::Agent {
    let ua = concat!("krakendial/", env!("CARGO_PKG_VERSION"));
    ureq::AgentBuilder::new().timeout(Duration::from_secs(60)).user_agent(ua).build()
}

/// Asks GitHub for the latest release, in the background.
pub fn check() -> Result<(), String> {
    begin("checking")?;
    std::thread::spawn(|| match latest() {
        Ok(r) => {
            let mut s = lock();
            s.busy = None;
            s.available = newer(&r.version, env!("CARGO_PKG_VERSION"));
            s.latest = Some(r.version.clone());
            s.release = Some(r);
        }
        Err(e) => fail(e),
    });
    Ok(())
}

fn latest() -> Result<Release, String> {
    #[derive(Deserialize)]
    struct Found {
        tag_name: String,
        assets: Vec<Asset>,
    }
    #[derive(Deserialize)]
    struct Asset {
        name: String,
        browser_download_url: String,
    }
    let found: Found = agent()
        .get(LATEST)
        .call()
        .map_err(|e| format!("asking GitHub for the latest release: {e}"))?
        .into_json()
        .map_err(|e| format!("reading GitHub's answer: {e}"))?;
    let url = |name: &str| {
        let asset = found.assets.iter().find(|a| a.name == name);
        asset.map(|a| a.browser_download_url.clone()).ok_or_else(|| format!("release {} has no {name}", found.tag_name))
    };
    Ok(Release { version: found.tag_name.trim_start_matches('v').to_string(), exe: url(EXE)?, sum: url(&format!("{EXE}.sha256"))? })
}

/// The installed copy, which install.ps1 puts in the data folder; a build run from elsewhere
/// leaves its exe alone.
fn installed() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("finding this exe: {e}"))?;
    let dir = crate::data_dir();
    let here = exe.parent().is_some_and(|p| p.to_string_lossy().eq_ignore_ascii_case(&dir.to_string_lossy()));
    if !here {
        return Err(format!("only the copy in {} updates itself; this one runs from {}", dir.display(), exe.display()));
    }
    Ok(exe)
}

/// Downloads and checks the newer release in the background, puts it in place and starts it;
/// `quit` then ends this copy.
pub fn install(quit: fn()) -> Result<(), String> {
    let exe = installed()?;
    let release = {
        let s = lock();
        s.release.clone().filter(|_| s.available).ok_or("there is no newer release to install; check again")?
    };
    begin("downloading")?;
    std::thread::spawn(move || match download(&release).and_then(|bytes| replace(&exe, &bytes)) {
        Ok(()) => {
            crate::log(&format!("updating to {}", release.version));
            lock().busy = Some("restarting");
            quit();
        }
        Err(e) => fail(e),
    });
    Ok(())
}

fn download(r: &Release) -> Result<Vec<u8>, String> {
    let get = |url: &str, what: &str| -> Result<Vec<u8>, String> {
        let res = agent().get(url).call().map_err(|e| format!("downloading {what}: {e}"))?;
        let mut body = Vec::new();
        res.into_reader().take(64 << 20).read_to_end(&mut body).map_err(|e| format!("downloading {what}: {e}"))?;
        Ok(body)
    };
    let exe = get(&r.exe, EXE)?;
    let sum = get(&r.sum, &format!("{EXE}.sha256"))?;
    let want = String::from_utf8_lossy(&sum).split_whitespace().next().unwrap_or_default().to_string();
    let have = hex(ring::digest::digest(&ring::digest::SHA256, &exe).as_ref());
    if !have.eq_ignore_ascii_case(&want) {
        return Err(format!("the downloaded {EXE} does not match its checksum ({have}, expected {want})"));
    }
    Ok(exe)
}

/// Puts `bytes` in place of `exe` and starts it. The running exe can be renamed but not
/// overwritten, so it moves aside to `.old`, which the new copy deletes. On a failure the old
/// exe goes back.
fn replace(exe: &Path, bytes: &[u8]) -> Result<(), String> {
    let (new, old) = (aside(exe, "new"), aside(exe, "old"));
    std::fs::write(&new, bytes).map_err(|e| format!("writing {}: {e}", new.display()))?;
    let _ = std::fs::remove_file(&old);
    std::fs::rename(exe, &old).map_err(|e| format!("moving {} aside: {e}", exe.display()))?;
    let started = std::fs::rename(&new, exe).map_err(|e| format!("putting the new {EXE} in place: {e}")).and_then(|()| {
        std::process::Command::new(exe)
            .arg(TAKE_OVER)
            .current_dir(exe.parent().unwrap_or(Path::new(".")))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(drop)
            .map_err(|e| format!("starting the new {EXE}: {e}"))
    });
    if started.is_err() {
        let _ = std::fs::remove_file(exe);
        let _ = std::fs::rename(&old, exe);
        let _ = std::fs::remove_file(&new);
    }
    started
}

/// `krakendial.exe.new` or `.old`, next to the exe.
fn aside(exe: &Path, what: &str) -> PathBuf {
    let mut name = exe.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{what}"));
    exe.with_file_name(name)
}

/// Deletes the exe an update left behind, once the copy that ran it is gone.
pub fn tidy() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(aside(&exe, "old"));
    }
}

/// Whether version `a` is newer than `b`: `x.y.z` as numbers, then a release after its own
/// pre-releases (`0.3.0` after `0.3.0-rc1`), and pre-releases by name.
fn newer(a: &str, b: &str) -> bool {
    fn parse(v: &str) -> ([u64; 3], Option<&str>) {
        let v = v.split('+').next().unwrap_or_default();
        let (core, pre) = v.split_once('-').map_or((v, None), |(c, p)| (c, Some(p)));
        let mut n = [0u64; 3];
        for (slot, part) in n.iter_mut().zip(core.split('.')) {
            *slot = part.parse().unwrap_or(0);
        }
        (n, pre)
    }
    let ((na, pa), (nb, pb)) = (parse(a), parse(b));
    if na != nb {
        return na > nb;
    }
    match (pa, pb) {
        (None, Some(_)) => true,
        (Some(x), Some(y)) => x > y,
        _ => false,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(newer("0.2.10", "0.2.9"));
        assert!(newer("0.3.0", "0.2.0"));
        assert!(newer("1.0.0", "0.99.99"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(!newer("0.1.9", "0.2.0"));
        assert!(!newer("0.3.0-rc1", "0.3.0"));
        assert!(newer("0.3.0", "0.3.0-rc1"));
        assert!(newer("0.3.0-rc2", "0.3.0-rc1"));
        assert!(!newer("0.2.0+build5", "0.2.0"));
    }

    #[test]
    fn sha256_matches_the_standard_vector() {
        let d = ring::digest::digest(&ring::digest::SHA256, b"abc");
        assert_eq!(hex(d.as_ref()), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    /// The swap on real files: the new exe takes the old one's place, and the old one waits
    /// beside it as `.old`. Starting it fails here (it is not a program), so the old one is put
    /// back as it was.
    #[test]
    fn a_failed_start_puts_the_old_exe_back() {
        let dir = std::env::temp_dir().join(format!("krakendial-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join(EXE);
        std::fs::write(&exe, b"old").unwrap();
        let err = replace(&exe, b"not a program").unwrap_err();
        assert!(err.starts_with("starting the new"), "{err}");
        assert_eq!(std::fs::read(&exe).unwrap(), b"old");
        assert!(!aside(&exe, "old").exists() && !aside(&exe, "new").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
