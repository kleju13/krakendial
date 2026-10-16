<img src="assets/icon.svg" width="64" height="64" alt="">

# krakenlcdfree

Tarcza na LCD Krakena Elite (640×640) przez Web Integration w NZXT CAM. Pokazuje:

- temperatury CPU, GPU i cieczy, moc CPU+GPU, RAM i zegar;
- limity Claude (5h, 7d) i Codexa (7d) z cienką kreską tempa;
- ile Claude i Codex kosztowały na wszystkich maszynach: w 24 h, dziś, w 7 dni albo w miesiącu.

Mała usługa w Ruście (`krakenlcd.exe`, bez okna, ~14 MB RAM) serwuje stronę na `http://127.0.0.1:30640/`. Limity i koszty bierze z podsumowania ledgera (`GET https://usage.example.invalid/api/summary`, tylko w tailnecie; inny adres ustawia zmienna `KRAKENLCD_LEDGER`). Sama nigdy nie pyta Claude'a ani Codexa i nie czyta ich tokenów.

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
    - **btop:** zaokrąglone ramki na całą tarczę, zegar w ramce. Wykresy temperatur CPU i GPU z ostatnich 2 min są pisane brajlem i same dopasowują skalę (zakres w rogu ramki), więc sięgają do jej górnej krawędzi.
    - Rodzina fetch, każdy układ z maskotką:
      - **neofetch:** sprzęt i limity dużym tekstem jako `klucz: wartość`, a pod spodem chodzi maskotka.
      - **fastfetch:** maskotka jako logo z ASCII (`$$`) po lewej, obok wyrównana tabela z paskami `■■■□□□□` dla CPU i GPU, cieczy, pamięci, mocy i limitów.
      - **pfetch:** maskotka obok nazwy i dużej godziny, pod nimi bardzo duże linijki. Przed paskami CPU i GPU jest ich obciążenie albo temperatura, za nimi ich moc. Przy obciążeniu nazwa czerwienieje, gdy układ jest gorący. Linijka `power` to moc całego zestawu z paskiem do 600 W. Za paskami limitów jest czas do ich resetu (`2h50`, `2d13h`), czerwony, gdy limit już się skończył.
      - **macchina:** paski z kropek `●●●○○○` w zaokrąglonej ramce, nazwa i godzina wpisane w dolną krawędź. Maskotka chodzi po górnej krawędzi ramki.
      - **cpufetch:** CPU i GPU jako układy scalone z nóżkami, temperatura na rdzeniu (czerwienieje, gdy jest gorąco), pod spodem model, pasek i moc. Maskotka chodzi po nóżkach obu układów.

      Maskotkę wybiera się w panelu: Kraken, Crab, Ghost, Cat albo Robot. Co parę sekund mruga, rozgląda się albo przechodzi kawałek, nie wchodząc na tekst; tam, gdzie nie ma gdzie chodzić (logo fastfetch, pfetch), przebiera nogami w miejscu. Między ruchami nic się nie zmienia, więc te układy bez tła kosztują CAM-a tyle co btop: ok. 20–35% jednego rdzenia.
- **Limits show:** ile zostało (domyślnie) albo ile zużyte.

  Cienka kreska na każdym limicie to miejsce, w którym byłby przy równym tempie przez całe okno. Przy „ile zostało” mówi, ile powinno jeszcze zostać teraz. W układach terminalowych leży nad znakami paska w dokładnym miejscu, a sam pasek też kończy się tam, gdzie wypada wartość, w razie potrzeby w połowie kwadratu czy kropki, a nie na całej komórce. Dzięki temu przy tygodniowym limicie widać, czy jest przed kreską, czy za nią. Tak samo wypełniają się paski temperatur, obciążenia, pamięci i mocy.
- **CPU and GPU bars:** obciążenie (domyślnie) albo temperatura. Dotyczy pasków CPU i GPU w układach terminalowych (terminal, htop, fastfetch, pfetch, macchina, cpufetch). Wartość paska stoi tuż przy nim. Wykresy btop i okrągłe tarcze zawsze pokazują temperatury.
- **Theme:** Ice, Porcelain, Frost, Blue, Ocean, Deep, Indigo, Graphite, Night, Neon, a w stylu motywów terminala: Nord, Tokyo Night, Catppuccin, Latte, Dracula, Solarized, Gruvbox, Synthwave, Phosphor, Amber, Mono, Paper.
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

  Pod listą jest przełącznik wyglądu:
  - **Theme tint** (domyślnie): przyciemnienie i duoton jak wyżej.
  - **Original:** film w oryginalnych kolorach, bez przyciemniania. Tekst dostaje cienką obwódkę w kolorze tła, żeby był czytelny na jasnych fragmentach.
  - **ASCII:** każda klatka jest rysowana znakami ` .:-=+*#%@` w kolorach motywu, z poziomami dopasowanymi do klipu, żeby pasowała do układów terminalowych. Kosztuje ok. 20 punktów procentowych więcej niż zwykły film.
- **Background frame rate:** 10, 20 albo 30 kl/s.

  CAM renderuje stronę bez GPU i każdą zmienioną klatkę przechwytuje i wysyła na wyświetlacz, co kosztuje ok. 2–3% jednego rdzenia na każdą klatkę na sekundę. Przy 10 kl/s cały CAM zużywa ok. 55–65% jednego rdzenia z animowanym tłem albo filmem i ok. 20–25% bez tła.
- **Cost:** Last 24 h (domyślnie), Today, Last 7 days, This month albo Off.

  Koszt jest w każdym układzie:
  - w zwykłych tarczach na dolnej linijce obok godziny synchronizacji;
  - w **One number** jako osobna karta z dwoma pozostałymi okresami pod spodem;
  - w terminalu, htop i btop jako `cost`, `Cost:` albo w rogu ramki `sys`;
  - w rodzinie fetch jako osobna linijka, a w cpufetch zamiast łącznej mocy.

Usługa czyta podsumowanie ledgera co minutę i dodatkowo 15 s po jego własnym odświeżeniu (`nextAt`), więc nowe limity widać zaraz po tym, jak ledger je pobierze, a sam ledger pyta Claude'a raz na 5 min. Tempo zużycia (`burnAt`) liczy z kolejnych próbek ledgera.

Na dole tarczy jest godzina, o której ledger ostatnio pobrał limity, i jego odstęp, a obok kółko, które wypełnia się do następnego pobrania. Gdy ledgera nie da się odpytać (np. poza tailnetem), tekst i kółko robią się czerwone („ledger offline”), a nieaktualne limity i koszt przygasają. Panel pokazuje też, które maszyny ledgera są offline.

## Rozwój

- `http://127.0.0.1:30640/lcd?mock` to sama tarcza ze sztucznymi danymi sprzętu.

  Parametry `layout`, `theme`, `bg`, `units`, `look` (`plain`, `raw`, `ascii`), `mascot`, `bars` (`load`, `temp`), `cost` (`last24h`, `today`, `last7d`, `month`, `off`) i `fps` wymuszają wariant, np. `/lcd?mock&layout=neofetch&theme=tokyo&mascot=ghost` albo `/lcd?mock&layout=btop&theme=deep&bg=media:runa.mp4&look=ascii`. Identyfikatory układów i teł są stałe (np. `kokpit`, `gwiazdy`), choć nazwy w panelu są po angielsku.
- `KRAKENLCD_WEB=<repo>\web` przy uruchomieniu exe serwuje pliki z dysku bez przebudowy.

  Otwarte strony same się przeładowują po restarcie usługi.
- Logi, historia i ustawienia są w `%LOCALAPPDATA%\krakenlcd`.
