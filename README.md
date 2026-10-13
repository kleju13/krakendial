<img src="assets/icon.svg" width="64" height="64" alt="">

# krakenlcdfree

Tarcza na LCD Krakena Elite (640×640) przez Web Integration w NZXT CAM. Pokazuje:

- temperatury CPU, GPU i cieczy, moc CPU+GPU, RAM i zegar;
- limity Claude (5h, 7d) i Codexa (7d) z cienką kreską tempa.

Mała usługa w Ruście (`krakenlcd.exe`, bez okna, ~14 MB RAM) serwuje stronę na `http://127.0.0.1:30640/` i pobiera limity. Używa tokenów, które Claude Code i Codex CLI trzymają lokalnie (`~/.claude/.credentials.json`, `~/.codex/auth.json`), i tylko je odczytuje.

## Instalacja

```powershell
.\scripts\install.ps1     # build, kopia do %LOCALAPPDATA%\krakenlcd, autostart przy logowaniu, start
.\scripts\uninstall.ps1   # stop + usunięcie autostartu (-Purge kasuje też ustawienia i historię)
```

W NZXT CAM: **Lighting** → przy Krakenie **Mode** → **Web Integration** → **Custom Mode** → **Edit** → URL `http://127.0.0.1:30640/`.

## Warianty

Przycisk **Configure** w CAM (albo `http://127.0.0.1:30640/` w przeglądarce) otwiera panel z podglądem na żywych danych. Wybór trafia na chłodzenie w ciągu ~3 s. Panel i tarcza są po angielsku.

- **Układ:**
  - **Rotation:** limity i sprzęt na zmianę.
  - **Adaptive:** limity, a gdy GPU pracuje (>60% przez 20 s), sprzęt.
  - **Cockpit:** wszystko naraz: trzy limity z paskami, temperatury, ciecz, moc i RAM.
  - **Chronograph:** zegarek ze wskazówkami, każdy limit na osobnej tarczce.
  - **Columns:** siedem słupków obok siebie.
  - **Clock:** duża godzina, limity nad nią, sprzęt pod nią.
  - **One number:** karuzela dużych wartości.
  - **Limits only** / **Hardware only**.
  - Rodzina terminalowa:
    - **Terminal:** wszystko jako wynik poleceń w konsoli.
    - **htop:** mierniki `CPU[|||   55°C 15%]` u góry, limity jako lista procesów pod odwróconym nagłówkiem. Zaznaczony jest limit, który zużywa się najszybciej względem tempa.
    - **btop:** zaokrąglone ramki, wykresy temperatur CPU i GPU z ostatnich ~90 s pisane brajlem, zegar w ramce.
    - **neofetch:** kraken z bloków, sprzęt i limity jako `klucz: wartość`, paleta kolorów motywu.
- **Limits show:** ile zostało (domyślnie) albo ile zużyte.

  Cienka kreska na każdym limicie to miejsce, w którym byłby przy równym tempie przez całe okno. Przy „ile zostało” mówi, ile powinno jeszcze zostać teraz. W układach terminalowych leży nad znakami paska w dokładnym miejscu, a nie zaokrąglona do całej komórki.
- **Theme:** Ice, Porcelain, Frost, Blue, Ocean, Deep, Indigo, Graphite, Night, Neon.
- **Background:** rysowane animacje albo brak. Przyspieszają razem z obciążeniem GPU.
  - Liquid, Ripples, Bubbles, Aurora, Flow, Nebula, Stars, Bokeh.
  - Silk, Contours, Vortex, Honeycomb, Grid, Code rain.
  - Terminalowe, pisane znakami:
    - **donut.c:** obracający się torus ASCII.
    - **Fire:** płomień z gęstości znaków.
    - **Life:** Gra w życie z gasnącym śladem, sama zaczyna od nowa, gdy się ustabilizuje.
    - **Pipes:** rury jak w `pipes.sh`.
- **Own backgrounds:** film, GIF albo obrazek dodany w panelu (trafia do `%LOCALAPPDATA%\krakenlcd\media`).

  Ruchome pliki są przycinane do kwadratu i zmniejszane do 640×640 przez ffmpeg, jeśli jest zainstalowany. Tarcza przyciemnia film tym mocniej, im jest jaśniejszy, a w jasnych motywach zamienia go na biało-niebieski duoton, żeby liczby zostały czytelne.

  Pod listą jest przełącznik **As it is / ASCII**. W trybie ASCII każda klatka jest rysowana znakami ` .:-=+*#%@` w kolorach motywu, z poziomami dopasowanymi do klipu, żeby pasowała do układów terminalowych. Kosztuje ok. 20 punktów procentowych więcej niż zwykły film.
- **Background frame rate:** 10, 20 albo 30 kl/s.

  CAM renderuje stronę bez GPU i każdą zmienioną klatkę przechwytuje i wysyła na wyświetlacz, co kosztuje ok. 2–3% jednego rdzenia na każdą klatkę na sekundę. Przy 10 kl/s cały CAM zużywa ok. 55–65% jednego rdzenia z animowanym tłem albo filmem i ok. 20–25% bez tła.
- **Limit refresh:** co 1, 2 albo 5 min.

  Gdy serwer odpowiada „za często”, usługa sama wydłuża odstęp, a po serii udanych zapytań znowu go skraca.

Na dole tarczy jest godzina ostatniego pobrania i realny odstęp, a obok kółko, które wypełnia się do następnego pobrania. Przy błędzie tekst i kółko robią się czerwone, a nieaktualne limity przygasają.

## Rozwój

- `http://127.0.0.1:30640/lcd?mock` to sama tarcza ze sztucznymi danymi sprzętu.

  Parametry `layout`, `theme`, `bg`, `units`, `look` i `fps` wymuszają wariant, np. `/lcd?mock&layout=btop&theme=deep&bg=media:runa.mp4&look=ascii`. Identyfikatory układów i teł są stałe (np. `kokpit`, `gwiazdy`), choć nazwy w panelu są po angielsku.
- `KRAKENLCD_WEB=<repo>\web` przy uruchomieniu exe serwuje pliki z dysku bez przebudowy.

  Otwarte strony same się przeładowują po restarcie usługi.
- Logi, historia i ustawienia są w `%LOCALAPPDATA%\krakenlcd`.
