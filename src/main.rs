// Background service for the Kraken Elite LCD: serves the dial to NZXT CAM's Web Integration
// and keeps the Claude / Codex limits and costs from the ledger fresh. Runs windowless in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    "rotacja", "adaptacyjny", "kokpit", "chronograf", "slupki", "terminal", "htop", "btop", "neofetch", "fastfetch",
    "pfetch", "macchina", "cpufetch", "zegar", "jedna", "limity", "sprzet",
];
const THEMES: [&str; 22] = [
    "ice", "porcelana", "mroz", "blue", "deep", "ocean", "indygo", "grafit", "night", "neon", "nord", "tokyo",
    "catppuccin", "latte", "dracula", "solarized", "gruvbox", "synthwave", "phosphor", "amber", "mono", "paper",
];
const BGS: [&str; 19] = [
    "ciecz", "fale", "babelki", "zorza", "obieg", "gwiazdy", "bokeh", "mglawica", "linie", "topografia", "siatka",
    "kod", "plaster", "wir", "donut", "fire", "life", "pipes", "brak",
];
/// How the user's own media is drawn: tinted towards the theme, untouched, or as characters.
const LOOKS: [&str; 3] = ["plain", "raw", "ascii"];
/// Who lives in the neofetch layouts.
const MASCOTS: [&str; 5] = ["kraken", "crab", "ghost", "cat", "robot"];
/// Whether limits read as what is left or what is used.
const UNITS: [&str; 2] = ["left", "used"];
/// Which of the ledger's costs the dial shows.
const COSTS: [&str; 5] = ["last24h", "today", "last7d", "month", "off"];
/// Background frame rates. CAM spends CPU on every frame it captures, so the default is low.
const FPS: [i64; 3] = [10, 20, 30];

fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("krakenlcd");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Applies the valid fields of `patch` on top of `cfg`; unknown values are ignored.
fn merge_config(cfg: &mut Value, patch: &Value) {
    fn legacy(l: &str) -> &str {
        match l {
            "adaptive" => "adaptacyjny",
            "fixed" | "pierscienie" => "kokpit",
            "work" => "limity",
            "game" => "sprzet",
            other => other,
        }
    }
    if let Some(l) = patch["layout"].as_str().map(legacy).filter(|l| LAYOUTS.contains(l)) {
        cfg["layout"] = json!(l);
    }
    if let Some(t) = patch["theme"].as_str().filter(|t| THEMES.contains(t)) {
        cfg["theme"] = json!(t);
    }
    if let Some(b) = patch["bg"].as_str().filter(|b| BGS.contains(b) || media::bg_exists(b)) {
        cfg["bg"] = json!(b);
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
    // KRAKENLCD_WEB points at the web/ folder during development, so edits show up without a rebuild.
    if let Some(dir) = std::env::var_os("KRAKENLCD_WEB") {
        if let Ok(b) = std::fs::read(PathBuf::from(dir).join(name)) {
            return Some((b, ctype));
        }
    }
    let bytes: &[u8] = match name {
        "index.html" => include_bytes!("../web/index.html"),
        "config.html" => include_bytes!("../web/config.html"),
        "dial.js" => include_bytes!("../web/dial.js"),
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

fn read_body(req: &mut Request) -> Option<Value> {
    let mut s = String::new();
    req.as_reader().take(64 * 1024).read_to_string(&mut s).ok()?;
    serde_json::from_str(&s).ok()
}

fn handle(app: &App, mut req: Request) {
    let (path, query) = req.url().split_once('?').unwrap_or((req.url(), ""));
    let (path, on_kraken) = (path.to_string(), query.split('&').any(|kv| kv == "kraken=1"));
    match (req.method(), path.as_str()) {
        (Method::Get, "/api/state") => {
            let cfg = app.config.lock().unwrap().clone();
            let (limits, costs) = {
                let store = app.store.lock().unwrap();
                (store.limits_json(), store.costs_json())
            };
            let v = json!({
                "now": limits::now_ms(),
                "build": app.build,
                "interval": limits::POLL_MS,
                "config": cfg,
                "limits": limits,
                "costs": costs,
                "hw": *app.hw.lock().unwrap(),
            });
            reply_json(req, &v);
        }
        (Method::Post, "/api/config") => {
            let Some(body) = read_body(&mut req) else { return reply(req, 400, "text/plain", b"bad json".to_vec()) };
            let mut cfg = app.config.lock().unwrap();
            merge_config(&mut cfg, &body);
            let _ = std::fs::write(data_dir().join("config.json"), cfg.to_string());
            let out = cfg.clone();
            drop(cfg);
            reply_json(req, &out);
        }
        (Method::Post, "/api/hw") => {
            if let Some(mut body) = read_body(&mut req) {
                body["at"] = json!(limits::now_ms());
                *app.hw.lock().unwrap() = body;
            }
            reply(req, 204, "text/plain", Vec::new());
        }
        (Method::Get, "/api/media") => reply_json(req, &media::list()),
        (Method::Post, "/api/media") => {
            let name = media::query_name(query);
            let res = name.ok_or("bad file name".to_string()).and_then(|n| media::save(&n, req.as_reader()));
            match res {
                Ok(saved) => reply_json(req, &json!({ "name": saved })),
                Err(e) => reply(req, 400, "text/plain; charset=utf-8", e.into_bytes()),
            }
        }
        (Method::Delete, "/api/media") => {
            if let Some(name) = media::query_name(query) {
                media::remove(&name);
                let mut cfg = app.config.lock().unwrap();
                if cfg["bg"].as_str() == Some(&format!("media:{name}")) {
                    cfg["bg"] = json!("ciecz");
                    let _ = std::fs::write(data_dir().join("config.json"), cfg.to_string());
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
    let state_path = data_dir().join("state.json");
    let mut config =
        json!({ "layout": "rotacja", "theme": "ice", "bg": "ciecz", "fps": 10, "units": "left", "look": "plain", "mascot": "kraken", "cost": "last24h" });
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
        let ledger = limits::Ledger::new();
        let mut last_err = None;
        loop {
            let (next, err) = ledger.poll(&poller.store);
            if err != last_err {
                log(&format!("ledger: {}", err.as_deref().unwrap_or("ok")));
                last_err = err;
            }
            poller.store.lock().unwrap().save(&state_path);
            std::thread::sleep(Duration::from_millis((next - limits::now_ms()).clamp(1_000, limits::POLL_MS) as u64));
        }
    });

    for req in server.incoming_requests() {
        handle(&app, req);
    }
}
