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
  - **Kokpit:** wszystko naraz: trzy limity z paskami tempa, temperatury, ciecz, moc i RAM.
  - **Chronograf:** zegarek ze wskazówkami, każdy limit na osobnej tarczce.
  - **Słupki:** siedem słupków obok siebie.
  - **Terminal:** wszystko jako wynik w konsoli.
  - **Zegar:** duża godzina, limity nad nią, sprzęt pod nią.
  - **Jedna liczba:** karuzela dużych wartości.
  - **Tylko limity** / **Tylko sprzęt**.
- **Limity pokazują:** ile zostało (domyślnie) albo ile zużyte.

  Przy „ile zostało” pasek się opróżnia, a kreska tempa mówi, ile powinno zostać przy równym zużyciu do resetu. Czerwona szczelina do kreski znaczy, że limit skończy się przed resetem.
- **Motyw:** Lód, Porcelana, Mróz, Błękit, Ocean, Głębia, Indygo, Grafit, Noc, Neon.
- **Tło:** rysowane animacje albo brak. Przyspieszają razem z obciążeniem GPU.
  - Ciecz, Fale, Bąbelki, Zorza, Obieg, Mgławica, Gwiazdy, Bokeh.
  - Jedwab, Topografia, Wir, Plaster, Siatka, Kod.
- **Własne tła:** film, GIF albo obrazek dodany w panelu (trafia do `%LOCALAPPDATA%\krakenlcd\media`).

  Ruchome pliki są przycinane do kwadratu i zmniejszane do 640×640 przez ffmpeg, jeśli jest zainstalowany. Tarcza przyciemnia film tym mocniej, im jest jaśniejszy, a w jasnych motywach zamienia go na biało-niebieski duoton, żeby liczby zostały czytelne.
- **Płynność tła:** 10, 20 albo 30 kl/s.

  CAM renderuje stronę bez GPU i każdą zmienioną klatkę przechwytuje i wysyła na wyświetlacz, co kosztuje ok. 2–3% jednego rdzenia na każdą klatkę na sekundę. Przy 10 kl/s cały CAM zużywa ok. 55% jednego rdzenia z animowanym tłem albo filmem i ok. 20% bez tła.
- **Pobieranie limitów:** co 1, 2 albo 5 min.

  Gdy serwer odpowiada „za często”, usługa sama wydłuża odstęp, a po serii udanych zapytań znowu go skraca.

Na dole tarczy jest godzina ostatniego pobrania i realny odstęp, a obok kółko, które wypełnia się do następnego pobrania. Przy błędzie tekst i kółko robią się czerwone, a nieaktualne limity przygasają.

## Rozwój

- `http://127.0.0.1:30640/lcd?mock` to sama tarcza ze sztucznymi danymi sprzętu.

  Parametry `layout`, `theme`, `bg`, `units` i `fps` wymuszają wariant, np. `/lcd?mock&layout=chronograf&theme=deep&bg=gwiazdy&units=used`.
- `KRAKENLCD_WEB=<repo>\web` przy uruchomieniu exe serwuje pliki z dysku bez przebudowy.

  Otwarte strony same się przeładowują po restarcie usługi.
- Logi, historia i ustawienia są w `%LOCALAPPDATA%\krakenlcd`.
