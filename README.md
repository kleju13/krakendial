<img src="assets/icon.svg" width="64" height="64" alt="">

# krakenlcdfree

Tarcza na LCD Krakena Elite (640×640) przez Web Integration w NZXT CAM. Pokazuje:

- temperatury CPU, GPU i cieczy, moc CPU+GPU, RAM i zegar;
- limity Claude (5h, 7d) i Codexa (7d) z kreską tempa i prognozą wyczerpania.

Mała usługa w Ruście (`krakenlcd.exe`, bez okna, ~14 MB RAM) serwuje stronę na `http://127.0.0.1:30640/` i pobiera limity. Używa tokenów, które Claude Code i Codex CLI trzymają lokalnie (`~/.claude/.credentials.json`, `~/.codex/auth.json`), i tylko je odczytuje.

## Instalacja

```powershell
.\scripts\install.ps1     # build, kopia do %LOCALAPPDATA%\krakenlcd, autostart przy logowaniu, start
.\scripts\uninstall.ps1   # stop + usunięcie autostartu (-Purge kasuje też ustawienia i historię)
```

W NZXT CAM: **Lighting** → przy Krakenie **Mode** → **Web Integration** → **Custom Mode** → **Edit** → URL `http://127.0.0.1:30640/`.

## Warianty

Przycisk **Configure** w CAM (albo `http://127.0.0.1:30640/` w przeglądarce) otwiera panel z podglądem na żywych danych. Wybór trafia na chłodzenie w ciągu ~3 s.

- **Układ:**
  - **Rotacja:** limity i sprzęt na zmianę.
  - **Adaptacyjny:** limity, a gdy GPU pracuje (>60% przez 20 s), sprzęt.
  - **Pierścienie:** wszystko naraz.
  - **Jedna liczba:** karuzela dużych wartości.
  - **Tylko limity** / **Tylko sprzęt**.
- **Motyw:** Lód, Głębia, Błękit, Noc.
- **Tło:** animacje Ciecz, Fale, Bąbelki, Zorza, Obieg albo brak. Przyspieszają razem z obciążeniem GPU.
- **Pobieranie limitów:** co 1, 2 albo 5 min.

  Gdy serwer odpowiada „za często”, usługa sama wydłuża odstęp, a po serii udanych zapytań znowu go skraca.

Na dole tarczy jest godzina ostatniego pobrania i realny odstęp, a obok kółko, które wypełnia się do następnego pobrania. Przy błędzie tekst i kółko robią się czerwone, a nieaktualne limity przygasają.

## Rozwój

- `http://127.0.0.1:30640/lcd?mock` to sama tarcza ze sztucznymi danymi sprzętu.

  Parametry `layout`, `theme` i `bg` wymuszają wariant, np. `/lcd?mock&layout=jedna&theme=deep&bg=fale`.
- `KRAKENLCD_WEB=<repo>\web` przy uruchomieniu exe serwuje pliki z dysku bez przebudowy.

  Otwarte strony same się przeładowują po restarcie usługi.
- Logi, historia i ustawienia są w `%LOCALAPPDATA%\krakenlcd`.
