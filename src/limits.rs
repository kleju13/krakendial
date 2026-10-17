//! Claude and Codex usage limits and what the agents cost, read from a usage summary: a URL set
//! in the settings that answers with the JSON described in docs/usage-source.md. Whatever serves
//! it is the only thing that asks Claude and Codex; this service never does.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

const MIN: i64 = 60_000;
const HOUR: i64 = 60 * MIN;
const UA: &str = concat!("krakendial/", env!("CARGO_PKG_VERSION"));
const KEYS: [&str; 4] = ["claude5h", "claude7d", "codex5h", "codex7d"];
/// The summary is cheap, so it is read every minute, and shortly after the source's own refresh.
pub const POLL_MS: i64 = MIN;

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
    /// When the source asks the provider next.
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
    /// The source's costs as it sent them, plus `polledAt`: when we got them.
    #[serde(default)]
    costs: Value,
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

    /// Takes in a summary. A limit is only recorded again when the source has fetched it again,
    /// so the burn rate is measured between the source's own samples.
    fn apply(&mut self, summary: &Value, now: i64) {
        for key in KEYS {
            let s = &summary["limits"][key];
            let Some(pct) = s["pct"].as_f64() else { continue };
            let fetched = s["fetchedAt"].as_i64().unwrap_or(now);
            let l = self.limits.entry(key.into()).or_default();
            if l.fetched_at != Some(fetched) {
                l.record(pct, s["windowMs"].as_i64().unwrap_or(0), s["resetsAt"].as_i64(), fetched);
            }
            l.next_at = s["nextAt"].as_i64().unwrap_or(0);
        }
        for l in self.limits.values_mut() {
            l.error = None;
        }
        if summary["costs"].is_object() {
            self.costs = summary["costs"].clone();
            self.costs["polledAt"] = json!(now);
        }
    }

    fn fail(&mut self, msg: &str) {
        for key in KEYS {
            self.limits.entry(key.into()).or_default().error = Some(msg.into());
        }
    }

    /// No source is set up: nothing to show, rather than old numbers going stale.
    pub fn unset(&mut self) {
        self.limits = KEYS.iter().map(|k| (k.to_string(), Limit { error: Some("unset".into()), ..Limit::default() })).collect();
        self.costs = Value::Null;
    }

    /// The next poll: in a minute, or a little after the source's next refresh if that is sooner.
    fn next_poll(&self, now: i64) -> i64 {
        let refresh = self.limits.values().map(|l| l.next_at).filter(|&t| t + 15_000 > now).min();
        refresh.map_or(now + POLL_MS, |t| (t + 15_000).clamp(now + 5_000, now + POLL_MS))
    }

    pub fn limits_json(&self) -> Value {
        Value::Object(self.limits.iter().map(|(k, l)| (k.clone(), l.to_json())).collect())
    }

    pub fn costs_json(&self) -> Value {
        self.costs.clone()
    }
}

pub struct Source {
    agent: ureq::Agent,
}

impl Source {
    pub fn new() -> Source {
        Source { agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).user_agent(UA).build() }
    }

    /// Reads the summary at `url` into the store; returns when to poll next and what went wrong, if anything.
    pub fn poll(&self, url: &str, store: &Mutex<Store>) -> (i64, Option<String>) {
        let res = match self.agent.get(url).call() {
            Ok(r) => r.into_json::<Value>().map_err(|_| "bad reply".to_string()),
            Err(ureq::Error::Status(code, _)) => Err(format!("http {code}")),
            Err(ureq::Error::Transport(_)) => Err("offline".into()),
        };
        let now = now_ms();
        let mut s = store.lock().unwrap();
        let err = match res {
            Ok(summary) if summary["limits"].is_object() => {
                s.apply(&summary, now);
                None
            }
            Ok(_) => Some("bad reply".to_string()),
            Err(e) => Some(e),
        };
        if let Some(e) = &err {
            s.fail(e);
        }
        (s.next_poll(now), err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn new_window_clears_history() {
        let mut l = Limit::default();
        let t = 1_000_000_000_000;
        l.record(90.0, 5 * HOUR, Some(t), t - 60 * MIN);
        l.record(5.0, 5 * HOUR, Some(t + 5 * HOUR), t + MIN);
        assert_eq!(l.history.len(), 1);
    }

    #[test]
    fn summary_is_sampled_once_per_source_fetch() {
        let t = 1_000_000_000_000;
        let summary = |pct: f64, fetched: i64| {
            json!({
                "limits": {
                    "claude5h": { "pct": pct, "windowMs": 5 * HOUR, "resetsAt": t + 3 * HOUR, "fetchedAt": fetched, "nextAt": fetched + 5 * MIN },
                    "codex5h": null,
                },
                "costs": { "currency": "USD", "last24h": 14.29 },
            })
        };
        let mut s = Store::default();
        s.fail("offline");
        s.apply(&summary(20.0, t), t + 10_000);
        s.apply(&summary(20.0, t), t + 70_000);
        s.apply(&summary(25.0, t + 5 * MIN), t + 5 * MIN + 10_000);
        let l = &s.limits["claude5h"];
        assert_eq!(l.history.len(), 2);
        assert_eq!(l.fetched_at, Some(t + 5 * MIN));
        assert!(l.error.is_none());
        assert!(!s.limits.contains_key("codex5h") || s.limits["codex5h"].pct.is_none());
        assert_eq!(s.costs["last24h"], json!(14.29));
        assert_eq!(s.costs["polledAt"], json!(t + 5 * MIN + 10_000));
        // next poll: 15 s after the source's next fetch, as that is within the minute
        assert_eq!(s.next_poll(t + 9 * MIN + 30_000), t + 10 * MIN + 15_000);
        assert_eq!(s.next_poll(t + 5 * MIN + 10_000), t + 6 * MIN + 10_000);
    }
}
