// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
//! The icon in the Windows tray. It shows that the service runs, whether the cooler gets the dial
//! and whether the usage source answers, and its menu opens the pages and copies the address for
//! CAM. It can be hidden; the settings page, or starting the exe again, brings it back.

use crate::{limits, log, logo, save_config, App, ADDR};
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
/// Enter or Space on the icon. Windows sends it twice for Enter; the second one finds the menu
/// already open.
const NIN_KEYSELECT: u32 = NIN_SELECT | NINF_KEY;
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
    /// The cooler gets the dial: in colour, else grey.
    live: bool,
    /// The usage source fails: a red dot.
    failing: bool,
}

/// The logo, drawn at the tray's size so it is sharp at every scale.
fn icon(look: Look) -> HICON {
    let n = unsafe { GetSystemMetrics(SM_CXSMICON) }.clamp(16, 256) as usize;
    let res = logo::dib(n, &logo::draw(n, !look.live, look.failing));
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
            WM_CONTEXTMENU | NIN_SELECT | NIN_KEYSELECT => menu((wp & 0xffff) as i16 as i32, ((wp >> 16) & 0xffff) as i16 as i32),
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
        assert_ne!(ICON.get(), 0, "icon drawn");
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
