// Background service for the Kraken Elite LCD: serves the dial to NZXT CAM's Web Integration
// and keeps the Claude / Codex limits and costs from the usage source fresh. Runs windowless in
// release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod faces;
mod limits;
mod media;

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server};

const ADDR: &str = "127.0.0.1:30640";
const LAYOUTS: [&str; 17] = [
    "rotation", "adaptive", "cockpit", "chronograph", "columns", "terminal", "htop", "btop", "neofetch", "fastfetch",
    "pfetch", "macchina", "cpufetch", "clock", "one", "limits", "hardware",
];
const THEMES: [&str; 22] = [
    "ice", "porcelain", "frost", "blue", "deep", "ocean", "indigo", "graphite", "night", "neon", "nord", "tokyo",
    "catppuccin", "latte", "dracula", "solarized", "gruvbox", "synthwave", "phosphor", "amber", "mono", "paper",
];
const BGS: [&str; 19] = [
    "liquid", "ripples", "bubbles", "aurora", "flow", "stars", "bokeh", "nebula", "silk", "contours", "grid",
    "rain", "honeycomb", "vortex", "donut", "fire", "life", "pipes", "none",
];
/// How the user's own media is drawn: tinted towards the theme, untouched, or as characters.
const LOOKS: [&str; 3] = ["plain", "raw", "ascii"];
/// Who lives in the neofetch layouts.
const MASCOTS: [&str; 5] = ["kraken", "crab", "ghost", "cat", "robot"];
/// Whether limits read as what is left or what is used.
const UNITS: [&str; 2] = ["left", "used"];
/// What the CPU and GPU bars of the terminal layouts fill with.
const BARS: [&str; 2] = ["load", "temp"];
/// Which of the usage source's costs the dial shows.
const COSTS: [&str; 5] = ["last24h", "today", "last7d", "month", "off"];
/// Background frame rates. CAM spends CPU on every frame it captures, so the default is low.
const FPS: [i64; 3] = [10, 20, 30];
/// The language of the dial and the settings; "auto" follows the browser.
const LANGS: [&str; 3] = ["auto", "en", "pl"];
/// Pages that may change settings: this service's own. Any other site the browser has open
/// could otherwise post to it too.
const ORIGINS: [&str; 2] = ["http://127.0.0.1:30640", "http://localhost:30640"];

fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("krakendial");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Earlier versions were called krakenlcd. Take over that folder's settings, faces and media
/// once, unless this version already has settings of its own. Called after the port is bound,
/// so no older copy is running out of that folder.
fn adopt_old_data() {
    let dir = data_dir();
    let old = dir.with_file_name("krakenlcd");
    if !old.is_dir() || dir.join("config.json").exists() {
        return;
    }
    for entry in std::fs::read_dir(&old).into_iter().flatten().flatten() {
        if entry.file_name() != "krakenlcd.exe" {
            let _ = std::fs::rename(entry.path(), dir.join(entry.file_name()));
        }
    }
    let _ = std::fs::remove_dir(&old);
    log("took over the settings of krakenlcd");
}

/// Ids from older versions, which named things in Polish.
fn legacy(id: &str) -> &str {
    match id {
        "rotacja" => "rotation",
        "adaptacyjny" => "adaptive",
        "kokpit" | "fixed" | "pierscienie" => "cockpit",
        "chronograf" => "chronograph",
        "slupki" => "columns",
        "zegar" => "clock",
        "jedna" => "one",
        "limity" | "work" => "limits",
        "sprzet" | "game" => "hardware",
        "porcelana" => "porcelain",
        "mroz" => "frost",
        "indygo" => "indigo",
        "grafit" => "graphite",
        "ciecz" => "liquid",
        "fale" => "ripples",
        "babelki" => "bubbles",
        "zorza" => "aurora",
        "obieg" => "flow",
        "mglawica" => "nebula",
        "gwiazdy" => "stars",
        "linie" => "silk",
        "topografia" => "contours",
        "wir" => "vortex",
        "plaster" => "honeycomb",
        "siatka" => "grid",
        "kod" => "rain",
        "brak" => "none",
        other => other,
    }
}

/// An http(s) address without spaces, or nothing at all (no usage source).
fn valid_url(u: &str) -> bool {
    u.is_empty() || (u.len() <= 500 && (u.starts_with("http://") || u.starts_with("https://")) && !u.contains(char::is_whitespace))
}

/// Applies the valid fields of `patch` on top of `cfg`; unknown values are ignored.
fn merge_config(cfg: &mut Value, patch: &Value) {
    let face = |l: &str| l.strip_prefix("face:").is_some_and(faces::exists);
    if let Some(l) = patch["layout"].as_str().map(legacy).filter(|l| LAYOUTS.contains(l) || face(l)) {
        cfg["layout"] = json!(l);
    }
    if let Some(t) = patch["theme"].as_str().map(legacy).filter(|t| THEMES.contains(t)) {
        cfg["theme"] = json!(t);
    }
    if let Some(b) = patch["bg"].as_str().map(legacy).filter(|b| BGS.contains(b) || media::bg_exists(b)) {
        cfg["bg"] = json!(b);
    }
    if let Some(l) = patch["lang"].as_str().filter(|l| LANGS.contains(l)) {
        cfg["lang"] = json!(l);
    }
    if let Some(u) = patch["usage"].as_str().map(str::trim).filter(|u| valid_url(u)) {
        cfg["usage"] = json!(u);
    }
    if let Some(u) = patch["units"].as_str().filter(|u| UNITS.contains(u)) {
        cfg["units"] = json!(u);
    }
    if let Some(l) = patch["look"].as_str().filter(|l| LOOKS.contains(l)) {
        cfg["look"] = json!(l);
    }
    if let Some(m) = patch["mascot"].as_str().filter(|m| MASCOTS.contains(m)) {
        cfg["mascot"] = json!(m);
    }
    if let Some(c) = patch["cost"].as_str().filter(|c| COSTS.contains(c)) {
        cfg["cost"] = json!(c);
    }
    if let Some(b) = patch["bars"].as_str().filter(|b| BARS.contains(b)) {
        cfg["bars"] = json!(b);
    }
    if let Some(f) = patch["fps"].as_i64().filter(|f| FPS.contains(f)) {
        cfg["fps"] = json!(f);
    }
}

fn log(msg: &str) {
    let path = data_dir().join("log.txt");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 256 * 1024) {
        let _ = std::fs::rename(&path, path.with_extension("old.txt"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} {msg}", limits::now_ms() / 1000);
    }
}

struct App {
    store: Mutex<limits::Store>,
    config: Mutex<Value>,
    /// Last hardware snapshot posted by the LCD page, so the settings page can mirror the cooler.
    hw: Mutex<Value>,
    /// Changes on every restart; open pages reload themselves when it does, so updates reach the LCD.
    build: i64,
}

fn asset(name: &str) -> Option<(Vec<u8>, &'static str)> {
    let ctype = match name.rsplit('.').next()? {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        _ => return None,
    };
    // KRAKENDIAL_WEB points at the web/ folder during development, so edits show up without a rebuild.
    if let Some(dir) = std::env::var_os("KRAKENDIAL_WEB") {
        if let Ok(b) = std::fs::read(PathBuf::from(dir).join(name)) {
            return Some((b, ctype));
        }
    }
    let bytes: &[u8] = match name {
        "index.html" => include_bytes!("../web/index.html"),
        "config.html" => include_bytes!("../web/config.html"),
        "editor.html" => include_bytes!("../web/editor.html"),
        "editor.js" => include_bytes!("../web/editor.js"),
        "i18n.js" => include_bytes!("../web/i18n.js"),
        "dial.js" => include_bytes!("../web/dial.js"),
        "faces.js" => include_bytes!("../web/faces.js"),
        "bg.js" => include_bytes!("../web/bg.js"),
        "dial.css" => include_bytes!("../web/dial.css"),
        _ => return None,
    };
    Some((bytes.to_vec(), ctype))
}

fn reply(req: Request, status: u16, ctype: &str, body: Vec<u8>) {
    let resp = Response::from_data(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", ctype).unwrap())
        .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
    let _ = req.respond(resp);
}

fn reply_json(req: Request, v: &Value) {
    reply(req, 200, "application/json", v.to_string().into_bytes());
}

fn read_body(req: &mut Request, limit: usize) -> Option<Value> {
    let mut s = String::new();
    req.as_reader().take(limit as u64 + 1).read_to_string(&mut s).ok()?;
    if s.len() > limit {
        return None;
    }
    serde_json::from_str(&s).ok()
}

fn header<'a>(req: &'a Request, name: &'static str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

/// Whether a request that changes something comes from this service's own pages. Browsers send
/// an Origin with every cross-site POST, so a page elsewhere can't change settings or files.
fn origin_ok(origin: Option<&str>) -> bool {
    origin.is_none_or(|o| ORIGINS.iter().any(|ok| ok.eq_ignore_ascii_case(o)))
}

/// Whether a request was addressed to this service by name. A site that points its own domain at
/// 127.0.0.1 (DNS rebinding) sends its domain here, and must not read the state or the settings.
fn host_ok(host: Option<&str>) -> bool {
    host.is_none_or(|h| ORIGINS.iter().any(|ok| ok["http://".len()..].eq_ignore_ascii_case(h)))
}

fn save_config(cfg: &Value) {
    let _ = std::fs::write(data_dir().join("config.json"), cfg.to_string());
}

fn handle(app: &App, mut req: Request) {
    let (path, query) = req.url().split_once('?').unwrap_or((req.url(), ""));
    let (path, query, on_kraken) = (path.to_string(), query.to_string(), query.split('&').any(|kv| kv == "kraken=1"));
    if !host_ok(header(&req, "Host")) {
        return reply(req, 403, "text/plain", b"other host".to_vec());
    }
    if *req.method() != Method::Get && !origin_ok(header(&req, "Origin")) {
        return reply(req, 403, "text/plain", b"other origin".to_vec());
    }
    match (req.method(), path.as_str()) {
        (Method::Get, "/api/state") => {
            let cfg = app.config.lock().unwrap().clone();
            let (limits, costs) = {
                let store = app.store.lock().unwrap();
                (store.limits_json(), store.costs_json())
            };
            // the face on the dial travels with the state, so the LCD redraws as soon as it is edited
            let face = cfg["layout"].as_str().and_then(|l| l.strip_prefix("face:")).and_then(faces::get);
            let v = json!({
                "now": limits::now_ms(),
                "build": app.build,
                "interval": limits::POLL_MS,
                "config": cfg,
                "face": face,
                "limits": limits,
                "costs": costs,
                "hw": *app.hw.lock().unwrap(),
            });
            reply_json(req, &v);
        }
        (Method::Post, "/api/config") => {
            let Some(body) = read_body(&mut req, 64 * 1024) else { return reply(req, 400, "text/plain", b"bad json".to_vec()) };
            let mut cfg = app.config.lock().unwrap();
            merge_config(&mut cfg, &body);
            save_config(&cfg);
            let out = cfg.clone();
            drop(cfg);
            reply_json(req, &out);
        }
        (Method::Get, "/api/faces") => reply_json(req, &faces::list()),
        (Method::Post, "/api/faces") => {
            let Some(body) = read_body(&mut req, faces::MAX_BYTES) else { return reply(req, 400, "text/plain", b"bad json".to_vec()) };
            match faces::save(body) {
                Ok(face) => reply_json(req, &face),
                Err(e) => reply(req, 400, "text/plain; charset=utf-8", e.into_bytes()),
            }
        }
        (Method::Delete, "/api/faces") => {
            if let Some(id) = faces::query_id(&query) {
                faces::remove(&id);
                // a deleted face can't stay on the dial
                let mut cfg = app.config.lock().unwrap();
                if cfg["layout"].as_str() == Some(&format!("face:{id}")) {
                    cfg["layout"] = json!("rotation");
                    save_config(&cfg);
                }
            }
            reply(req, 204, "text/plain", Vec::new());
        }
        (Method::Post, "/api/hw") => {
            if let Some(mut body) = read_body(&mut req, 64 * 1024) {
                body["at"] = json!(limits::now_ms());
                *app.hw.lock().unwrap() = body;
            }
            reply(req, 204, "text/plain", Vec::new());
        }
        (Method::Get, "/api/media") => reply_json(req, &media::list()),
        (Method::Post, "/api/media") => {
            let name = media::query_name(&query);
            let res = name.ok_or("bad file name".to_string()).and_then(|n| media::save(&n, req.as_reader()));
            match res {
                Ok(saved) => reply_json(req, &json!({ "name": saved })),
                Err(e) => reply(req, 400, "text/plain; charset=utf-8", e.into_bytes()),
            }
        }
        (Method::Delete, "/api/media") => {
            if let Some(name) = media::query_name(&query) {
                media::remove(&name);
                let mut cfg = app.config.lock().unwrap();
                if cfg["bg"].as_str() == Some(&format!("media:{name}")) {
                    cfg["bg"] = json!("liquid");
                    save_config(&cfg);
                }
            }
            reply(req, 204, "text/plain", Vec::new());
        }
        (Method::Get, p) if p.starts_with("/media/") => match media::open(&p["/media/".len()..]) {
            Some((file, ctype)) => {
                let resp = Response::from_file(file)
                    .with_header(Header::from_bytes("Content-Type", ctype).unwrap())
                    .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
                let _ = req.respond(resp);
            }
            None => reply(req, 404, "text/plain", b"not found".to_vec()),
        },
        (Method::Get, p) => {
            // CAM loads the same URL twice: with ?kraken=1 on the LCD, without it in "Configure".
            let name = match p {
                "/" if on_kraken => "index.html",
                "/" | "/config" | "/settings" => "config.html",
                "/editor" => "editor.html",
                "/lcd" => "index.html",
                other => other.trim_start_matches('/'),
            };
            match asset(name) {
                Some((body, ctype)) => reply(req, 200, ctype, body),
                None => reply(req, 404, "text/plain", b"not found".to_vec()),
            }
        }
        _ => reply(req, 405, "text/plain", Vec::new()),
    }
}

fn main() {
    // A second copy can't bind the port and quietly exits, so autostart plus a manual start is harmless.
    let server = match Server::http(ADDR) {
        Ok(s) => s,
        Err(e) => {
            log(&format!("port {ADDR} busy, exiting: {e}"));
            return;
        }
    };
    adopt_old_data();
    let state_path = data_dir().join("state.json");
    // KRAKENDIAL_USAGE sets the usage source until one is saved in the settings
    let usage = std::env::var("KRAKENDIAL_USAGE").ok().filter(|u| valid_url(u)).unwrap_or_default();
    let mut config = json!({
        "layout": "rotation", "theme": "ice", "bg": "liquid", "fps": 10, "units": "left", "look": "plain", "mascot": "kraken",
        "cost": "last24h", "bars": "load", "lang": "auto", "usage": usage,
    });
    if let Some(saved) = std::fs::read_to_string(data_dir().join("config.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
        merge_config(&mut config, &saved);
    }
    let app = Arc::new(App {
        store: Mutex::new(limits::Store::load(&state_path)),
        config: Mutex::new(config),
        hw: Mutex::new(Value::Null),
        build: limits::now_ms(),
    });
    log(&format!("listening on http://{ADDR}"));

    let poller = Arc::clone(&app);
    std::thread::spawn(move || {
        let source = limits::Source::new();
        let mut last_err = None;
        let url = || poller.config.lock().unwrap()["usage"].as_str().unwrap_or("").to_string();
        loop {
            let polled = url();
            let next = if polled.is_empty() {
                poller.store.lock().unwrap().unset();
                limits::now_ms() + limits::POLL_MS
            } else {
                let (next, err) = source.poll(&polled, &poller.store);
                if err != last_err {
                    log(&format!("usage source: {}", err.as_deref().unwrap_or("ok")));
                    last_err = err;
                }
                next
            };
            poller.store.lock().unwrap().save(&state_path);
            // wait for the next poll, or until another source is set in the settings
            let until = limits::now_ms() + (next - limits::now_ms()).clamp(1_000, limits::POLL_MS);
            while limits::now_ms() < until && url() == polled {
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    });

    for req in server.incoming_requests() {
        handle(&app, req);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_keeps_its_choices() {
        let mut cfg = json!({ "layout": "rotation", "theme": "ice", "bg": "liquid", "lang": "auto", "usage": "" });
        let saved = json!({ "layout": "zegar", "theme": "grafit", "bg": "ciecz", "units": "left", "bars": "load" });
        merge_config(&mut cfg, &saved);
        assert_eq!(cfg["layout"], "clock");
        assert_eq!(cfg["theme"], "graphite");
        assert_eq!(cfg["bg"], "liquid");
        assert_eq!(cfg["usage"], "");
    }

    #[test]
    fn bad_values_are_ignored() {
        let mut cfg = json!({ "layout": "pfetch", "lang": "auto", "usage": "https://a.example/summary" });
        merge_config(&mut cfg, &json!({ "layout": "face:../x", "lang": "de", "usage": "javascript:alert(1)" }));
        assert_eq!(cfg["layout"], "pfetch");
        assert_eq!(cfg["lang"], "auto");
        assert_eq!(cfg["usage"], "https://a.example/summary");
        merge_config(&mut cfg, &json!({ "usage": "  ", "lang": "pl" }));
        assert_eq!(cfg["usage"], "");
        assert_eq!(cfg["lang"], "pl");
    }

    #[test]
    fn only_own_pages_may_change_things() {
        assert!(origin_ok(None));
        assert!(origin_ok(Some("http://127.0.0.1:30640")));
        assert!(origin_ok(Some("http://localhost:30640")));
        assert!(!origin_ok(Some("https://evil.example")));
        assert!(!origin_ok(Some("null")));
        assert!(!origin_ok(Some("http://127.0.0.1:30641")));
        assert!(host_ok(None));
        assert!(host_ok(Some("127.0.0.1:30640")));
        assert!(host_ok(Some("LOCALHOST:30640")));
        assert!(!host_ok(Some("evil.example:30640")));
    }
}
