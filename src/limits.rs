//! Claude and Codex usage limits, read with the tokens the official CLIs already keep on disk.
//! Credential files are only read, never written.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::time::Duration;

const MIN: i64 = 60_000;
const HOUR: i64 = 60 * MIN;
const UA: &str = concat!("krakenlcd/", env!("CARGO_PKG_VERSION"));

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Default)]
pub struct Limit {
    pub pct: Option<f64>,
    pub window_ms: i64,
    pub resets_at: Option<i64>,
    pub fetched_at: Option<i64>,
    #[serde(skip)]
    pub error: Option<String>,
    /// When the provider is asked next; kept on disk so restarts don't hammer a rate-limited API.
    #[serde(default)]
    pub next_at: i64,
    /// (time, percent) samples of the current window, used to measure the burn rate.
    pub history: VecDeque<(i64, f64)>,
}

impl Limit {
    fn short_window(&self) -> bool {
        self.window_ms <= 6 * HOUR
    }

    fn record(&mut self, pct: f64, window_ms: i64, resets_at: Option<i64>, now: i64) {
        let new_window = match (self.resets_at, resets_at) {
            (Some(a), Some(b)) => (a - b).abs() > 10 * MIN,
            (None, None) => false,
            _ => true,
        };
        if new_window || self.history.back().is_some_and(|&(_, p)| pct < p) {
            self.history.clear();
        }
        self.pct = Some(pct);
        self.window_ms = window_ms;
        self.resets_at = resets_at;
        self.fetched_at = Some(now);
        self.error = None;
        self.history.push_back((now, pct));
        let keep = if self.short_window() { HOUR } else { 8 * HOUR };
        while self.history.front().is_some_and(|&(t, _)| t < now - keep) {
            self.history.pop_front();
        }
    }

    /// When the limit runs out if usage keeps the pace of the recent past
    /// (45 min for the 5-hour window, 6 h for weekly ones). None when idle.
    fn burn_at(&self) -> Option<i64> {
        let &(t1, p1) = self.history.back()?;
        if p1 >= 100.0 {
            return Some(t1);
        }
        let (lookback, min_span) = if self.short_window() { (45 * MIN, 5 * MIN) } else { (6 * HOUR, 30 * MIN) };
        let &(t0, p0) = self.history.iter().find(|&&(t, _)| t >= t1 - lookback)?;
        if t1 - t0 < min_span || p1 <= p0 {
            return None;
        }
        let rate = (p1 - p0) / (t1 - t0) as f64;
        Some(t1 + ((100.0 - p1) / rate) as i64)
    }

    fn to_json(&self) -> Value {
        json!({
            "pct": self.pct,
            "windowMs": self.window_ms,
            "resetsAt": self.resets_at,
            "burnAt": self.burn_at(),
            "fetchedAt": self.fetched_at,
            "error": self.error,
            "nextAt": self.next_at,
        })
    }
}

#[derive(Serialize, Deserialize, Default)]
pub struct Store {
    limits: BTreeMap<String, Limit>,
}

impl Store {
    pub fn load(path: &PathBuf) -> Store {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &PathBuf) {
        if let Ok(s) = serde_json::to_string(self) {
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, s).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }

    fn record(&mut self, key: &str, pct: f64, window_ms: i64, resets_at: Option<i64>, now: i64) {
        self.limits.entry(key.into()).or_default().record(pct, window_ms, resets_at, now);
    }

    fn next_at(&self, keys: &[&str]) -> i64 {
        keys.iter().filter_map(|k| self.limits.get(*k)).map(|l| l.next_at).max().unwrap_or(0)
    }

    fn schedule(&mut self, keys: &[&str], at: i64) {
        for k in keys {
            self.limits.entry((*k).into()).or_default().next_at = at;
        }
    }

    fn fail(&mut self, keys: &[&str], msg: &str) {
        for k in keys {
            self.limits.entry((*k).into()).or_default().error = Some(msg.into());
        }
    }

    pub fn to_json(&self) -> Value {
        Value::Object(self.limits.iter().map(|(k, l)| (k.clone(), l.to_json())).collect())
    }
}

// ---------- fetching ----------

pub struct Fetcher {
    agent: ureq::Agent,
}

/// Result of one poll: Ok(samples) or Err((message, retry_later)).
type Poll = Result<Vec<(&'static str, f64, i64, Option<i64>)>, (String, bool)>;

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

fn read_json(path: PathBuf) -> Result<Value, (String, bool)> {
    let text = std::fs::read_to_string(path).map_err(|_| ("brak logowania".to_string(), false))?;
    serde_json::from_str(&text).map_err(|_| ("zły plik logowania".to_string(), false))
}

fn http_err(e: ureq::Error) -> (String, bool) {
    match e {
        ureq::Error::Status(401 | 403, _) => ("token odrzucony".into(), false),
        ureq::Error::Status(429, _) => ("za często".into(), true),
        ureq::Error::Status(code, _) => (format!("błąd {code}"), false),
        ureq::Error::Transport(_) => ("brak sieci".into(), false),
    }
}

/// Parses "2026-10-13T22:10:00.355804+00:00" (or "...Z") into epoch milliseconds.
fn parse_iso(s: &str) -> Option<i64> {
    let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let rest = &s[19..];
    let rest = rest.strip_prefix('.').map(|r| r.trim_start_matches(|c: char| c.is_ascii_digit())).unwrap_or(rest);
    let offset = match rest.as_bytes().first() {
        Some(b'+') | Some(b'-') => {
            let sign = if rest.starts_with('-') { -1 } else { 1 };
            sign * (rest.get(1..3)?.parse::<i64>().ok()? * 60 + rest.get(4..6)?.parse::<i64>().ok()?)
        }
        _ => 0,
    };
    // days from civil (Howard Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + h * 3600 + mi * 60 + sec) - offset * 60) * 1000)
}

impl Fetcher {
    pub fn new() -> Fetcher {
        Fetcher { agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).user_agent(UA).build() }
    }

    fn claude(&self) -> Poll {
        let dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".claude"));
        let creds = read_json(dir.join(".credentials.json"))?;
        let oauth = &creds["claudeAiOauth"];
        let token = oauth["accessToken"].as_str().ok_or(("brak logowania".to_string(), false))?;
        if oauth["expiresAt"].as_i64().is_some_and(|exp| exp < now_ms()) {
            // Claude Code refreshes it on its next run; we never touch the credentials ourselves.
            return Err(("token wygasł".into(), false));
        }
        let body: Value = self
            .agent
            .get("https://api.anthropic.com/api/oauth/usage")
            .set("Authorization", &format!("Bearer {token}"))
            .set("anthropic-beta", "oauth-2025-04-20")
            .call()
            .map_err(http_err)?
            .into_json()
            .map_err(|_| ("zły format".to_string(), false))?;
        let mut out = Vec::new();
        for (key, field, window) in [("claude5h", "five_hour", 5 * HOUR), ("claude7d", "seven_day", 168 * HOUR)] {
            let w = &body[field];
            if w.is_null() {
                out.push((key, 0.0, window, None));
            } else if let Some(pct) = w["utilization"].as_f64() {
                out.push((key, pct, window, w["resets_at"].as_str().and_then(parse_iso)));
            }
        }
        if out.is_empty() {
            return Err(("zły format".into(), false));
        }
        Ok(out)
    }

    fn codex(&self) -> Poll {
        let dir = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex"));
        let auth = read_json(dir.join("auth.json"))?;
        let t = &auth["tokens"];
        let token = t["access_token"].as_str().ok_or(("brak logowania".to_string(), false))?;
        let mut req = self.agent.get("https://chatgpt.com/backend-api/wham/usage").set("Authorization", &format!("Bearer {token}"));
        if let Some(acc) = t["account_id"].as_str() {
            req = req.set("ChatGPT-Account-Id", acc);
        }
        let body: Value = req.call().map_err(http_err)?.into_json().map_err(|_| ("zły format".to_string(), false))?;
        let mut out = Vec::new();
        for w in [&body["rate_limit"]["primary_window"], &body["rate_limit"]["secondary_window"]] {
            let (Some(pct), Some(secs)) = (w["used_percent"].as_f64(), w["limit_window_seconds"].as_i64()) else { continue };
            let key = if secs >= 6 * 86_400 { "codex7d" } else { "codex5h" };
            out.push((key, pct, secs * 1000, w["reset_at"].as_i64().map(|s| s * 1000)));
        }
        if out.is_empty() {
            return Err(("zły format".into(), false));
        }
        Ok(out)
    }
}

const MAX_BACK_OFF: i64 = 30 * 60_000;

/// One provider's polling schedule, adapting to its rate limit: every "too often" doubles the
/// wait (up to 30 min) and five clean polls in a row halve it again, so it settles on the
/// shortest pace the server tolerates.
pub struct Source {
    pub name: &'static str,
    keys: &'static [&'static str],
    strikes: u32,
    clean: u32,
}

pub fn sources() -> Vec<Source> {
    vec![
        Source { name: "claude", keys: &["claude5h", "claude7d"], strikes: 0, clean: 0 },
        Source { name: "codex", keys: &["codex7d"], strikes: 0, clean: 0 },
    ]
}

fn wait(interval: i64, strikes: u32) -> i64 {
    if strikes == 0 {
        return interval;
    }
    (interval.max(60_000) << strikes.min(6)).min(MAX_BACK_OFF)
}

impl Source {
    /// Polls if due: None when not due yet, otherwise the outcome (error text is for the log).
    pub fn tick(&mut self, f: &Fetcher, store: &std::sync::Mutex<Store>, interval: i64) -> Option<Result<(), String>> {
        if now_ms() < store.lock().unwrap().next_at(self.keys) {
            return None;
        }
        let res = if self.name == "claude" { f.claude() } else { f.codex() };
        let now = now_ms();
        let mut s = store.lock().unwrap();
        match res {
            Ok(samples) => {
                for (key, pct, window, resets) in samples {
                    s.record(key, pct, window, resets, now);
                }
                self.clean += 1;
                if self.clean >= 5 && self.strikes > 0 {
                    self.strikes -= 1;
                    self.clean = 0;
                }
                s.schedule(self.keys, now + wait(interval, self.strikes));
                Some(Ok(()))
            }
            Err((msg, too_often)) => {
                self.clean = 0;
                if too_often {
                    self.strikes += 1;
                }
                // A single "too often" just slows us down; only a repeated one is worth showing.
                if !too_often || self.strikes >= 2 {
                    s.fail(self.keys, &msg);
                }
                let next = if too_often { wait(interval, self.strikes) } else { interval };
                s.schedule(self.keys, now + next);
                Some(Err(format!("{}: {msg}, retry in {} s", self.name, next / 1000)))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_parsing() {
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso("2026-10-13T22:10:00.355804+00:00"), Some(1_791_929_400_000));
        assert_eq!(parse_iso("2026-10-14T00:10:00+02:00"), Some(1_791_929_400_000));
    }

    #[test]
    fn burn_rate_projects_exhaustion() {
        let mut l = Limit::default();
        let t = 1_000_000_000_000;
        l.record(40.0, 5 * HOUR, Some(t + 3 * HOUR), t);
        l.record(50.0, 5 * HOUR, Some(t + 3 * HOUR), t + 30 * MIN);
        // 10 pp per 30 min, 50 pp left -> 150 min after the last sample
        assert_eq!(l.burn_at(), Some(t + 30 * MIN + 150 * MIN));
        // idle: no change -> no projection
        let mut idle = Limit::default();
        idle.record(50.0, 5 * HOUR, Some(t + 3 * HOUR), t);
        idle.record(50.0, 5 * HOUR, Some(t + 3 * HOUR), t + 30 * MIN);
        assert_eq!(idle.burn_at(), None);
    }

    #[test]
    fn back_off_doubles_up_to_cap() {
        assert_eq!(wait(120_000, 0), 120_000);
        assert_eq!(wait(60_000, 1), 120_000);
        assert_eq!(wait(60_000, 3), 480_000);
        assert_eq!(wait(60_000, 9), MAX_BACK_OFF);
    }

    #[test]
    fn new_window_clears_history() {
        let mut l = Limit::default();
        let t = 1_000_000_000_000;
        l.record(90.0, 5 * HOUR, Some(t), t - 60 * MIN);
        l.record(5.0, 5 * HOUR, Some(t + 5 * HOUR), t + MIN);
        assert_eq!(l.history.len(), 1);
    }
}
