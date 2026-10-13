// Background service for the Kraken Elite LCD: serves the dial to NZXT CAM's Web Integration
// and keeps Claude / Codex usage limits fresh. Runs windowless in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod limits;

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server};

const ADDR: &str = "127.0.0.1:30640";
const LAYOUTS: [&str; 6] = ["rotacja", "adaptacyjny", "pierscienie", "jedna", "limity", "sprzet"];
const THEMES: [&str; 4] = ["ice", "deep", "blue", "night"];
const BGS: [&str; 6] = ["ciecz", "fale", "babelki", "zorza", "obieg", "brak"];
const INTERVALS: [i64; 3] = [60, 120, 300];

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
            "fixed" => "pierscienie",
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
    if let Some(b) = patch["bg"].as_str().filter(|b| BGS.contains(b)) {
        cfg["bg"] = json!(b);
    }
    if let Some(i) = patch["interval"].as_i64().filter(|i| INTERVALS.contains(i)) {
        cfg["interval"] = json!(i);
    }
}

fn interval_ms(cfg: &Value) -> i64 {
    cfg["interval"].as_i64().unwrap_or(60) * 1000
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
            let v = json!({
                "now": limits::now_ms(),
                "build": app.build,
                "interval": interval_ms(&cfg),
                "config": cfg,
                "limits": app.store.lock().unwrap().to_json(),
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
    let mut config = json!({ "layout": "rotacja", "theme": "ice", "bg": "ciecz", "interval": 60 });
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
        let fetcher = limits::Fetcher::new();
        let mut sources = limits::sources();
        loop {
            let mut polled = false;
            let interval = interval_ms(&poller.config.lock().unwrap());
            for s in sources.iter_mut() {
                match s.tick(&fetcher, &poller.store, interval) {
                    Some(Err(e)) => log(&e),
                    Some(Ok(())) => {}
                    None => continue,
                }
                polled = true;
            }
            if polled {
                poller.store.lock().unwrap().save(&state_path);
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });

    for req in server.incoming_requests() {
        handle(&app, req);
    }
}
