<img src="assets/icon.svg" width="64" height="64" alt="">

# krakenlcdfree

Tarcza na LCD Krakena Elite (640×640) przez Web Integration w NZXT CAM: temperatury CPU, GPU i cieczy, moc CPU+GPU, RAM, zegar oraz limity Claude (5h, 7d) i Codexa (7d) z kreską tempa i prognozą wyczerpania.

Mała usługa w Ruście (`krakenlcd.exe`, bez okna, ~14 MB RAM) serwuje stronę na `http://127.0.0.1:30640/` i co minutę pobiera limity. Używa tokenów, które Claude Code i Codex CLI trzymają lokalnie (`~/.claude/.credentials.json`, `~/.codex/auth.json`), i tylko je odczytuje.

## Instalacja

```powershell
.\scripts\install.ps1     # build, kopia do %LOCALAPPDATA%\krakenlcd, autostart przy logowaniu, start
.\scripts\uninstall.ps1   # stop + usunięcie autostartu (-Purge kasuje też ustawienia i historię)
```

W NZXT CAM: **Lighting** → przy Krakenie **Mode** → **Web Integration** → **Custom Mode** → **Edit** → URL `http://127.0.0.1:30640/`.

## Style

`http://127.0.0.1:30640/settings` pokazuje wszystkie style na żywych danych. Kliknięcie przełącza chłodzenie w kilka sekund. Style:

- **Adaptacyjny:** gdy GPU jest obciążone (>60% przez 20 s), na pierwszy plan wychodzi sprzęt; po minucie spokoju wracają limity.
- **Stały:** wszystko naraz.
- **Zawsze praca** / **Zawsze gra:** jedna scena na stałe.

Parametr `?layout=fixed` w URL wymusza styl, a `?mock` podstawia sztuczne dane sprzętowe do testów w przeglądarce.

## Rozwój

- `KRAKENLCD_WEB=<repo>\web` przy uruchomieniu exe serwuje pliki z dysku bez przebudowy.
- `design/gallery.html` to makiety na danych przykładowych.
- Logi, historia i ustawienia są w `%LOCALAPPDATA%\krakenlcd`.
