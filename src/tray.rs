// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
//! The icon in the Windows tray. It shows that the service runs, whether the cooler gets the dial
//! and whether the usage source answers, and its menu opens the pages and copies the address for
//! CAM. It can be hidden; the settings page, or starting the exe again, brings it back.

use crate::{limits, log, save_config, App, ADDR};
use serde_json::json;
use std::cell::Cell;
use std::sync::{Arc, OnceLock};
use windows_sys::Win32::Foundation::{GlobalFree, FILETIME, HWND, LPARAM, LRESULT, SYSTEMTIME, WPARAM};
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;
use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows_sys::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
use windows_sys::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_sys::Win32::UI::Shell::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// The hidden window's class; a second start finds the running copy by it.
const CLASS: &str = "KrakenDialTray";
/// The icon's own events.
const WM_TRAY: u32 = WM_APP + 1;
/// A second start: show the icon again and say that KrakenDial already runs.
const WM_WAKE: u32 = WM_APP + 2;
const CF_UNICODETEXT: u32 = 13;
/// The LCD page posts what the cooler shows every 3 s; longer than this and CAM has stopped.
const LIVE_MS: i64 = 15_000;
const OPEN: usize = 1;
const EDITOR: usize = 2;
const COPY: usize = 3;
const HIDE: usize = 4;
const QUIT: usize = 5;

static APP: OnceLock<Arc<App>> = OnceLock::new();
static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();

// Only the tray thread touches these. Cells, because the menu and the message box run message
// loops of their own, which call back into `wndproc`.
thread_local! {
    static WINDOW: Cell<HWND> = const { Cell::new(0) };
    static SHOWN: Cell<bool> = const { Cell::new(false) };
    static LOOK: Cell<Option<Look>> = const { Cell::new(None) };
    static ICON: Cell<HICON> = const { Cell::new(0) };
    static TIP: Cell<String> = const { Cell::new(String::new()) };
    static BUSY: Cell<bool> = const { Cell::new(false) };
}

struct Words {
    cooler: &'static str,
    live: &'static str,
    no_signal: &'static str,
    usage: &'static str,
    synced: &'static str,
    last: &'static str,
    waiting: &'static str,
    offline: &'static str,
    bad: &'static str,
    http: &'static str,
    settings: &'static str,
    editor: &'static str,
    copy: &'static str,
    hide: &'static str,
    quit: &'static str,
    hide_title: &'static str,
    hide_text: &'static str,
    running: &'static str,
}

// The status words are the settings page's (cfg.* and err.* in web/i18n.js).
const EN: Words = Words {
    cooler: "Cooler",
    live: "live",
    no_signal: "no signal from CAM",
    usage: "Usage",
    synced: "synced {t}",
    last: "{err} · last {t}",
    waiting: "waiting",
    offline: "source offline",
    bad: "bad reply",
    http: "source error {code}",
    settings: "Open settings",
    editor: "Face editor",
    copy: "Copy address for CAM",
    hide: "Hide icon…",
    quit: "Quit KrakenDial",
    hide_title: "Hide the KrakenDial icon?",
    hide_text: "KrakenDial keeps running and the cooler keeps showing the dial. Only this icon goes away.\n\n\
        To bring it back:\n\
        •  open the settings (Configure in NZXT CAM, or {url}) and switch the tray icon on, or\n\
        •  start KrakenDial again, from the Start menu or from\n    {exe}",
    running: "KrakenDial is already running. Its icon is in the tray, under ^ if Windows has tucked it away.",
};

const PL: Words = Words {
    cooler: "Chłodzenie",
    live: "na żywo",
    no_signal: "brak sygnału z CAM",
    usage: "Limity",
    synced: "pobrano {t}",
    last: "{err} · ostatnio {t}",
    waiting: "czekam",
    offline: "źródło offline",
    bad: "zła odpowiedź",
    http: "błąd źródła {code}",
    settings: "Otwórz ustawienia",
    editor: "Edytor tarcz",
    copy: "Kopiuj adres dla CAM",
    hide: "Ukryj ikonę…",
    quit: "Zakończ KrakenDial",
    hide_title: "Ukryć ikonę KrakenDial?",
    hide_text: "KrakenDial dalej działa, a chłodzenie dalej pokazuje tarczę. Znika tylko ta ikona.\n\n\
        Żeby ją przywrócić:\n\
        •  otwórz ustawienia (Configure w NZXT CAM albo {url}) i włącz ikonę w zasobniku, albo\n\
        •  uruchom KrakenDial jeszcze raz, z menu Start albo z\n    {exe}",
    running: "KrakenDial już działa. Jego ikona jest w zasobniku, pod ^, jeśli Windows ją tam schował.",
};

/// The language of the settings; "auto" follows Windows, as the browser in CAM does.
fn words(app: &App) -> &'static Words {
    let lang = app.config.lock().unwrap()["lang"].as_str().unwrap_or("auto").to_string();
    // 0x15 is LANG_POLISH, the primary language in the low 10 bits
    let pl = match lang.as_str() {
        "pl" => true,
        "en" => false,
        _ => unsafe { GetUserDefaultUILanguage() & 0x3ff == 0x15 },
    };
    if pl {
        &PL
    } else {
        &EN
    }
}

#[derive(Debug, PartialEq)]
enum Usage {
    /// No usage source: nothing to say about it.
    Off,
    Waiting,
    Synced(i64),
    /// What went wrong at the last poll, and when a limit was last fetched.
    Failing(String, Option<i64>),
}

struct Status {
    live: bool,
    usage: Usage,
}

fn status(app: &App, now: i64) -> Status {
    let live = app.hw.lock().unwrap()["at"].as_i64().is_some_and(|at| now - at < LIVE_MS);
    let set = app.config.lock().unwrap()["usage"].as_str().is_some_and(|u| !u.is_empty());
    let usage = if !set {
        Usage::Off
    } else {
        match app.store.lock().unwrap().sync() {
            (Some(err), last) => Usage::Failing(err, last),
            (None, Some(t)) => Usage::Synced(t),
            (None, None) => Usage::Waiting,
        }
    };
    Status { live, usage }
}

fn err_text(code: &str, w: &Words) -> String {
    match code {
        "offline" => w.offline.into(),
        "bad reply" => w.bad.into(),
        _ => code.strip_prefix("http ").map_or(code.into(), |c| w.http.replace("{code}", c)),
    }
}

/// The status as lines for the tooltip and the menu, with times from `clock`.
fn lines(s: &Status, w: &Words, clock: impl Fn(i64) -> String) -> Vec<String> {
    let mut v = vec![format!("{}: {}", w.cooler, if s.live { w.live } else { w.no_signal })];
    let usage = match &s.usage {
        Usage::Off => None,
        Usage::Waiting => Some(w.waiting.to_string()),
        Usage::Synced(t) => Some(w.synced.replace("{t}", &clock(*t))),
        Usage::Failing(e, None) => Some(err_text(e, w)),
        Usage::Failing(e, Some(t)) => Some(w.last.replace("{err}", &err_text(e, w)).replace("{t}", &clock(*t))),
    };
    v.extend(usage.map(|u| format!("{}: {u}", w.usage)));
    v
}

/// "14:32" in local time.
fn clock(ms: i64) -> String {
    // FILETIME counts 100 ns from 1601
    let ticks = (ms + 11_644_473_600_000) * 10_000;
    let ft = FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 };
    let mut utc: SYSTEMTIME = unsafe { std::mem::zeroed() };
    let mut local = utc;
    let ok = unsafe { FileTimeToSystemTime(&ft, &mut utc) != 0 && SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) != 0 };
    if ok {
        format!("{:02}:{:02}", local.wHour, local.wMinute)
    } else {
        "?".into()
    }
}

// ---------- the icon ----------

/// What the icon says at a glance.
#[derive(Clone, Copy, PartialEq, Debug)]
struct Look {
    /// The cooler gets the dial: orange, else grey.
    live: bool,
    /// The usage source fails: a red dot.
    failing: bool,
}

/// The icon at `n`×`n` pixels as straight-alpha BGRA, rows from the top: the orange K of
/// assets/icon.svg, drawn here rather than shipped so it is sharp at every scale.
fn draw(n: usize, look: Look) -> Vec<[u8; 4]> {
    const SS: usize = 4;
    let mut out = vec![[0; 4]; n * n];
    for (i, px) in out.iter_mut().enumerate() {
        let (mut sum, mut hits) = ([0u32; 3], 0u32);
        for s in 0..SS * SS {
            // the sample, in the 64 units of the SVG
            let u = ((i % n) as f32 + ((s % SS) as f32 + 0.5) / SS as f32) * 64.0 / n as f32;
            let v = ((i / n) as f32 + ((s / SS) as f32 + 0.5) / SS as f32) * 64.0 / n as f32;
            if let Some(c) = sample(u, v, look) {
                for k in 0..3 {
                    sum[k] += c[k] as u32;
                }
                hits += 1;
            }
        }
        if hits > 0 {
            *px = [(sum[0] / hits) as u8, (sum[1] / hits) as u8, (sum[2] / hits) as u8, (hits * 255 / (SS * SS) as u32) as u8];
        }
    }
    out
}

/// The colour (BGR) at a point of the 64-unit icon, or None where it is transparent.
fn sample(u: f32, v: f32, look: Look) -> Option<[u8; 3]> {
    if look.failing {
        let d = (u - 51.0).hypot(v - 51.0);
        if d <= 12.0 {
            return Some([0x26, 0x26, 0xdc]);
        }
        if d <= 16.0 {
            return None; // a gap between the dot and the tile
        }
    }
    const R: f32 = 14.0;
    let inside = (0.0..=64.0).contains(&u) && (0.0..=64.0).contains(&v);
    if !inside || (u - u.clamp(R, 64.0 - R)).hypot(v - v.clamp(R, 64.0 - R)) > R {
        return None;
    }
    Some(if glyph(u, v) {
        [0xff; 3]
    } else if look.live {
        [0x0c, 0x58, 0xea]
    } else {
        [0x7a, 0x71, 0x71]
    })
}

/// The K: a stem and two diagonals, cut flat at the cap height and the baseline. A little
/// bolder than the SVG's text, so it still reads at 16 px.
fn glyph(u: f32, v: f32) -> bool {
    if !(19.0..=45.0).contains(&v) || u < 21.0 {
        return false;
    }
    u <= 27.5 || near(u, v, (26.0, 35.5), (45.0, 15.0), 3.4) || near(u, v, (30.0, 30.0), (46.0, 48.0), 3.4)
}

/// Whether (u, v) is within `r` of the segment from `a` to `b`.
fn near(u: f32, v: f32, a: (f32, f32), b: (f32, f32), r: f32) -> bool {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let t = (((u - a.0) * dx + (v - a.1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    (a.0 + t * dx - u).hypot(a.1 + t * dy - v) <= r
}

/// The icon as the shell wants it: an icon resource, a DIB with an AND mask the alpha makes moot.
fn icon(look: Look) -> HICON {
    let n = unsafe { GetSystemMetrics(SM_CXSMICON) }.clamp(16, 256) as usize;
    let mask_row = n.div_ceil(32) * 4;
    let mut res = Vec::with_capacity(40 + n * n * 4 + mask_row * n);
    // BITMAPINFOHEADER; its height counts the colour rows and the mask rows
    for x in [40, n as u32, 2 * n as u32] {
        res.extend(x.to_le_bytes());
    }
    res.extend([1, 0, 32, 0]); // one plane, 32 bits per pixel
    res.extend([0; 24]); // uncompressed; the rest is unused
    for row in draw(n, look).chunks(n).rev() {
        res.extend(row.iter().flatten());
    }
    res.resize(res.len() + mask_row * n, 0);
    unsafe { CreateIconFromResourceEx(res.as_ptr(), res.len() as u32, 1, 0x0003_0000, n as i32, n as i32, 0) }
}

// ---------- the window and the menu ----------

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

/// Copies `s` into a fixed buffer of NOTIFYICONDATAW, cut to fit.
fn fill(buf: &mut [u16], s: &str) {
    let w: Vec<u16> = s.encode_utf16().take(buf.len() - 1).collect();
    buf[..w.len()].copy_from_slice(&w);
    buf[w.len()] = 0;
}

fn data() -> NOTIFYICONDATAW {
    let mut d: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    d.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    d.hWnd = WINDOW.get();
    d.uID = 1;
    d
}

fn url(path: &str) -> String {
    format!("http://{ADDR}{path}")
}

fn set_tray(app: &App, on: bool) {
    let mut cfg = app.config.lock().unwrap();
    cfg["tray"] = json!(on);
    save_config(&cfg);
}

/// Brings the icon in line with the settings and the status. Runs every 2 s, so a change made
/// on the settings page shows up here too.
fn refresh() {
    let Some(app) = APP.get() else { return };
    let want = app.config.lock().unwrap()["tray"].as_bool() != Some(false);
    if !want {
        if SHOWN.replace(false) {
            unsafe { Shell_NotifyIconW(NIM_DELETE, &data()) };
        }
        return;
    }
    let s = status(app, limits::now_ms());
    let look = Look { live: s.live, failing: matches!(s.usage, Usage::Failing(..)) };
    let mut changed = false;
    if LOOK.get() != Some(look) || ICON.get() == 0 {
        // the shell keeps its own copy of the icon, so the old one can go at once
        let old = ICON.replace(icon(look));
        if old != 0 {
            unsafe { DestroyIcon(old) };
        }
        LOOK.set(Some(look));
        changed = true;
    }
    let tip = ["KrakenDial".to_string()].into_iter().chain(lines(&s, words(app), clock)).collect::<Vec<_>>().join("\n");
    changed |= TIP.replace(tip.clone()) != tip;
    let mut d = data();
    d.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
    d.uCallbackMessage = WM_TRAY;
    d.hIcon = ICON.get();
    fill(&mut d.szTip, &tip);
    if !SHOWN.get() {
        // fails while Explorer is still starting at logon; the next tick tries again
        if unsafe { Shell_NotifyIconW(NIM_ADD, &d) } != 0 {
            d.Anonymous.uVersion = NOTIFYICON_VERSION_4;
            unsafe { Shell_NotifyIconW(NIM_SETVERSION, &d) };
            SHOWN.set(true);
        }
    } else if changed && unsafe { Shell_NotifyIconW(NIM_MODIFY, &d) } == 0 {
        SHOWN.set(false);
    }
}

fn open(path: &str) {
    let (verb, target) = (wide("open"), wide(&url(path)));
    unsafe { ShellExecuteW(0, verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
}

fn copy(text: &str) {
    let w = wide(text);
    unsafe {
        if OpenClipboard(WINDOW.get()) == 0 {
            return;
        }
        EmptyClipboard();
        let h = GlobalAlloc(GMEM_MOVEABLE, w.len() * 2);
        let p = if h.is_null() { std::ptr::null_mut() } else { GlobalLock(h) as *mut u16 };
        if !p.is_null() {
            std::ptr::copy_nonoverlapping(w.as_ptr(), p, w.len());
            GlobalUnlock(h);
            // the clipboard owns the memory once it takes it
            if SetClipboardData(CF_UNICODETEXT, h as isize) == 0 {
                GlobalFree(h);
            }
        } else if !h.is_null() {
            GlobalFree(h);
        }
        CloseClipboard();
    }
}

fn hide(app: &App) {
    let w = words(app);
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "krakendial.exe".into());
    let text = wide(&w.hide_text.replace("{url}", &url("/")).replace("{exe}", &exe));
    let title = wide(w.hide_title);
    let style = MB_OKCANCEL | MB_ICONINFORMATION | MB_SETFOREGROUND;
    if unsafe { MessageBoxW(WINDOW.get(), text.as_ptr(), title.as_ptr(), style) } == IDOK {
        set_tray(app, false);
        log("tray icon hidden");
        refresh();
    }
}

fn menu(x: i32, y: i32) {
    let Some(app) = APP.get() else { return };
    // the menu and the message box pump messages; one at a time
    if BUSY.replace(true) {
        return;
    }
    let w = words(app);
    let s = status(app, limits::now_ms());
    let hwnd = WINDOW.get();
    let cmd = unsafe {
        let m = CreatePopupMenu();
        let add = |flags: MENU_ITEM_FLAGS, id: usize, text: &str| AppendMenuW(m, flags, id, wide(text).as_ptr());
        add(MF_GRAYED, 0, &format!("KrakenDial {}", env!("CARGO_PKG_VERSION")));
        SetMenuDefaultItem(m, 0, 1);
        for line in lines(&s, w, clock) {
            add(MF_GRAYED, 0, &line);
        }
        AppendMenuW(m, MF_SEPARATOR, 0, std::ptr::null());
        add(MF_STRING, OPEN, w.settings);
        add(MF_STRING, EDITOR, w.editor);
        add(MF_STRING, COPY, &format!("{}\t{}", w.copy, url("/")));
        AppendMenuW(m, MF_SEPARATOR, 0, std::ptr::null());
        add(MF_STRING, HIDE, w.hide);
        add(MF_STRING, QUIT, w.quit);
        // without this the menu stays open when the user clicks elsewhere
        SetForegroundWindow(hwnd);
        let side = if GetSystemMetrics(SM_MENUDROPALIGNMENT) != 0 { TPM_RIGHTALIGN } else { TPM_LEFTALIGN };
        let cmd = TrackPopupMenuEx(m, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | side, x, y, hwnd, std::ptr::null());
        PostMessageW(hwnd, WM_NULL, 0, 0);
        DestroyMenu(m);
        cmd as usize
    };
    match cmd {
        OPEN => open("/"),
        EDITOR => open("/editor"),
        COPY => copy(&url("/")),
        HIDE => hide(app),
        QUIT => {
            if SHOWN.get() {
                unsafe { Shell_NotifyIconW(NIM_DELETE, &data()) };
            }
            log("quit from the tray");
            std::process::exit(0);
        }
        _ => {}
    }
    BUSY.set(false);
}

/// A second start: the icon comes back if it was hidden, and a notification says where it is.
fn woken() {
    let Some(app) = APP.get() else { return };
    set_tray(app, true);
    refresh();
    let mut d = data();
    d.uFlags = NIF_INFO;
    d.dwInfoFlags = NIIF_INFO | NIIF_NOSOUND;
    fill(&mut d.szInfoTitle, "KrakenDial");
    fill(&mut d.szInfo, words(app).running);
    unsafe { Shell_NotifyIconW(NIM_MODIFY, &d) };
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_TIMER => refresh(),
        // with NOTIFYICON_VERSION_4 the event is in the low word of lp, and where to put the menu in wp
        WM_TRAY => match (lp & 0xffff) as u32 {
            WM_CONTEXTMENU | NIN_SELECT => menu((wp & 0xffff) as i16 as i32, ((wp >> 16) & 0xffff) as i16 as i32),
            _ => {}
        },
        WM_WAKE => woken(),
        // Explorer restarted and lost every icon
        m if TASKBAR_CREATED.get() == Some(&m) => {
            SHOWN.set(false);
            refresh();
        }
        _ => return DefWindowProcW(hwnd, msg, wp, lp),
    }
    0
}

/// The hidden window that gets the icon's events, on the calling thread.
fn window() -> bool {
    unsafe {
        // sharp icon and dialog on scaled screens; the process has no other windows
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let class = wide(CLASS);
        let instance = GetModuleHandleW(std::ptr::null());
        let mut wc: WNDCLASSW = std::mem::zeroed();
        wc.lpfnWndProc = Some(wndproc);
        wc.hInstance = instance;
        wc.lpszClassName = class.as_ptr();
        RegisterClassW(&wc);
        // a hidden top-level window rather than a message-only one: only those hear TaskbarCreated
        let hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, class.as_ptr(), class.as_ptr(), WS_POPUP, 0, 0, 0, 0, 0, 0, instance, std::ptr::null());
        WINDOW.set(hwnd);
        let _ = TASKBAR_CREATED.set(RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()));
        hwnd != 0
    }
}

/// Runs the icon on the calling thread until the process exits.
pub fn run(app: Arc<App>) {
    let _ = APP.set(app);
    if !window() {
        log("tray: no window");
        return;
    }
    refresh();
    unsafe {
        SetTimer(WINDOW.get(), 1, 2000, None);
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, 0, 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// Called by a second start, which can't take the port: the running copy shows its icon again.
pub fn wake() {
    let class = wide(CLASS);
    unsafe {
        let hwnd = FindWindowW(class.as_ptr(), std::ptr::null());
        if hwnd != 0 {
            PostMessageW(hwnd, WM_WAKE, 0, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: Look = Look { live: true, failing: false };

    #[test]
    fn icon_is_a_rounded_tile_with_a_white_k() {
        for n in [16, 20, 24, 32, 48] {
            let px = draw(n, LIVE);
            let at = |x: usize, y: usize| px[y * n + x];
            assert_eq!(at(0, 0)[3], 0, "{n}: rounded corner");
            assert_eq!(at(n / 2, 1), [0x0c, 0x58, 0xea, 255], "{n}: orange tile");
            // at 16 px the strokes are anti-aliased, so count the near-white
            let white = px.iter().filter(|p| p[1] > 0xc0 && p[3] == 255).count();
            assert!(white > n * n / 16, "{n}: the K shows, {white} white pixels");
        }
        let grey = draw(32, Look { live: false, failing: false });
        assert_eq!(grey[32 + 16], [0x7a, 0x71, 0x71, 255]);
        let failing = draw(32, Look { live: true, failing: true });
        assert_eq!(failing[25 * 32 + 25], [0x26, 0x26, 0xdc, 255], "red dot");
    }

    #[test]
    fn status_reads_like_the_settings_page() {
        let at = |_| "14:32".to_string();
        let s = |live, usage| Status { live, usage };
        assert_eq!(lines(&s(true, Usage::Off), &EN, at), ["Cooler: live"]);
        assert_eq!(lines(&s(false, Usage::Synced(1)), &EN, at), ["Cooler: no signal from CAM", "Usage: synced 14:32"]);
        assert_eq!(lines(&s(true, Usage::Failing("http 503".into(), Some(1))), &EN, at)[1], "Usage: source error 503 · last 14:32");
        assert_eq!(lines(&s(true, Usage::Failing("offline".into(), None)), &PL, at)[1], "Limity: źródło offline");
        assert_eq!(lines(&s(true, Usage::Waiting), &PL, at), ["Chłodzenie: na żywo", "Limity: czekam"]);
    }

    /// Puts a real icon in the tray and takes it out, and copies to the clipboard, putting back
    /// the text that was there; it leaves a clipboard with anything but text alone. Opens no menu
    /// or dialog, so it takes no focus:
    /// `cargo test tray -- --ignored`
    #[test]
    #[ignore]
    fn icon_comes_and_goes_and_the_address_copies() {
        use windows_sys::Win32::System::DataExchange::{CountClipboardFormats, GetClipboardData, IsClipboardFormatAvailable};
        // whatever this saves goes to a scratch folder, not to the real settings
        let scratch = std::env::temp_dir().join("krakendial-tray-test");
        std::env::set_var("LOCALAPPDATA", &scratch);
        let app = App {
            store: std::sync::Mutex::new(limits::Store::default()),
            config: std::sync::Mutex::new(json!({ "tray": true, "lang": "en", "usage": "" })),
            hw: std::sync::Mutex::new(json!({ "at": limits::now_ms() })),
            build: 0,
        };
        let _ = APP.set(Arc::new(app));
        assert!(window());
        let present = || {
            let id = NOTIFYICONIDENTIFIER { cbSize: std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32, hWnd: WINDOW.get(), uID: 1, guidItem: unsafe { std::mem::zeroed() } };
            let mut rect = unsafe { std::mem::zeroed() };
            unsafe { Shell_NotifyIconGetRect(&id, &mut rect) == 0 }
        };
        refresh();
        assert!(SHOWN.get() && present(), "icon added");
        assert!(TIP.take().starts_with("KrakenDial
Cooler: live"));
        assert_eq!(LOOK.get(), Some(LIVE));

        // the cooler goes quiet: the icon turns grey
        *APP.get().unwrap().hw.lock().unwrap() = json!({ "at": limits::now_ms() - LIVE_MS - 1 });
        refresh();
        assert_eq!(LOOK.get(), Some(Look { live: false, failing: false }));
        assert!(TIP.take().contains("no signal from CAM"));

        APP.get().unwrap().config.lock().unwrap()["tray"] = json!(false);
        refresh();
        assert!(!SHOWN.get() && !present(), "icon removed");
        APP.get().unwrap().config.lock().unwrap()["tray"] = json!(true);
        refresh();
        assert!(SHOWN.get() && present(), "icon back");
        // a second start finds this window
        assert_eq!(unsafe { FindWindowW(wide(CLASS).as_ptr(), std::ptr::null()) }, WINDOW.get());

        let read = || unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 || OpenClipboard(WINDOW.get()) == 0 {
                return None;
            }
            let h = GetClipboardData(CF_UNICODETEXT);
            let p = GlobalLock(h as _) as *const u16;
            let text = (!p.is_null()).then(|| {
                let len = (0..).take_while(|&i| *p.add(i) != 0).count();
                String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
            });
            GlobalUnlock(h as _);
            CloseClipboard();
            text
        };
        // CF_TEXT, CF_OEMTEXT, CF_UNICODETEXT and CF_LOCALE: what Windows makes of any text
        let text = [1, 7, 13, 16].into_iter().filter(|&f| unsafe { IsClipboardFormatAvailable(f) } != 0).count();
        if unsafe { CountClipboardFormats() } as usize > text {
            eprintln!("the clipboard holds more than text: copying not checked");
        } else {
            let before = read();
            copy(&url("/"));
            let copied = read();
            if let Some(t) = &before {
                copy(t);
            }
            assert_eq!(copied.as_deref(), Some("http://127.0.0.1:30640/"));
        }

        APP.get().unwrap().config.lock().unwrap()["tray"] = json!(false);
        refresh();
        assert!(!present());
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[test]
    fn tooltip_text_is_cut_to_fit() {
        let mut buf = [1u16; 8];
        fill(&mut buf, "KrakenDial status");
        assert_eq!(String::from_utf16_lossy(&buf[..7]), "KrakenD");
        assert_eq!(buf[7], 0);
    }
}
