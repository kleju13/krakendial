<img src="assets/icon.svg" width="64" height="64" alt="">

# krakenlcdfree

[English](README.md)

Darmowa tarcza na LCD NZXT Kraken Elite (640×640), wyświetlana przez tryb Web Integration w NZXT CAM. Pokazuje:

- temperatury CPU, GPU i cieczy, obciążenie i moc CPU i GPU, RAM i godzinę;
- opcjonalnie limity Claude (5h, 7d) i Codexa (7d) z kreską tempa oraz ich koszt, ze źródła, które uruchamiasz u siebie;
- własne tarcze złożone w edytorze z wartości, wskaźników, pasków, wykresów, tekstu, obrazków i maskotek.

Tarcza i ustawienia są po angielsku albo po polsku.

Projekt nie jest powiązany z NZXT ani przez nie wspierany. NZXT, CAM i Kraken to znaki towarowe NZXT, Inc.

## Jak to działa

Mała usługa w Ruście (`krakenlcd.exe`, bez okna, ok. 14 MB RAM) serwuje tarczę pod `http://127.0.0.1:30640/`. CAM wczytuje tę stronę na chłodzeniu i przekazuje do niej odczyty czujników. Usługa trzyma ustawienia i tarcze, a jeśli ustawisz źródło limitów, odpytuje je.

- Słucha tylko na 127.0.0.1.
- Ustawienia zmieniają tylko jej własne strony. Inne strony otwarte w przeglądarce nie mogą ich zmienić, a zapytania z inną nazwą hosta są odrzucane.
- Nie łączy się z niczym poza źródłem limitów, które sam wpiszesz. Żadnej telemetrii.

## Instalacja

Windows z NZXT CAM i Krakenem Elite. Gotowych wydań jeszcze nie ma, więc potrzebny jest [Rust](https://rustup.rs). [ffmpeg](https://ffmpeg.org) jest opcjonalny: zmniejsza własne filmy do 640×640.

```powershell
.\scripts\install.ps1     # build, kopia do %LOCALAPPDATA%\krakenlcd, start teraz i przy każdym logowaniu
.\scripts\uninstall.ps1   # zatrzymanie i usunięcie autostartu (-Purge kasuje też ustawienia, tarcze i media)
```

W NZXT CAM: **Lighting** → przy Krakenie **Mode** → **Web Integration** → **Custom Mode** → **Edit**, URL `http://127.0.0.1:30640/`.

## Ustawienia

Przycisk **Configure** w CAM albo `http://127.0.0.1:30640/` w przeglądarce otwiera ustawienia z podglądem na żywo. Wybór trafia na chłodzenie w ciągu ok. 3 s.

- **Układ:** 17 wbudowanych układów i twoje tarcze.
  - Okrągłe: Kokpit, Chronograf, Słupki, Zegar, Jedna liczba, Tylko limity, Tylko sprzęt.
  - Rotacja (limity i sprzęt na zmianę) i Adaptacyjny (sprzęt, gdy GPU pracuje).
  - Terminalowe: Terminal, htop, btop, neofetch, fastfetch, pfetch, macchina, cpufetch. Układy fetch mają maskotkę (Kraken, Krab, Duch, Kot albo Robot), która mruga, rozgląda się i trochę chodzi.
- **Motyw:** 22 motywy, m.in. Nord, Tokyo Night, Catppuccin, Dracula, Solarized, Gruvbox i Synthwave.
- **Tło:** 18 rysowanych animacji, od cieczy i zorzy po `donut.c`, ogień, Grę w życie i rury. Przyspieszają razem z obciążeniem GPU.
- **Własne tła:** film, GIF albo obrazek. Może być przyciemniony pod motyw, w oryginale albo narysowany znakami ASCII.
- **Klatki tła na sekundę:** 10, 20 albo 30. CAM renderuje stronę bez GPU i każda klatka na sekundę kosztuje ok. 2–3% jednego rdzenia, więc domyślnie jest 10.
- **Limity pokazują:** ile zostało albo ile zużyte.
- **Paski CPU i GPU:** obciążenie albo temperatura, w układach terminalowych.
- **Koszt:** z 24 h, dziś, z 7 dni, w tym miesiącu albo wyłączony.
- **Język:** automatycznie (z przeglądarki), English albo Polski.
- **Źródło limitów:** skąd przychodzą limity i koszty (niżej). Zostaw puste, jeśli chcesz tylko sprzęt.

## Edytor tarcz

`http://127.0.0.1:30640/editor` albo **Moje tarcze** w ustawieniach. Zacznij od szablonu albo pustej tarczy:

- dodawaj widżety z palety;
- przeciągaj je po tarczy; przyciągają się do środka i do siebie nawzajem;
- zmieniaj rozmiar uchwytem w rogu;
- resztę ustawiaj w panelu właściwości.

Jest cofanie i ponawianie, warstwy, duplikowanie oraz import i eksport do JSON. Zmiany zapisują się na bieżąco. **Pokaż na chłodzeniu** wrzuca tarczę na wyświetlacz.

Tarcze to pliki JSON w `%LOCALAPPDATA%\krakenlcd\faces`. Format opisuje [docs/faces.md](docs/faces.md) (po angielsku).

## Limity i koszty

Tarcza nie rozmawia z Claude'em ani Codexem i nigdy nie czyta ich tokenów. Czyta jedno podsumowanie JSON spod adresu wpisanego w **Źródło limitów** albo podanego w zmiennej `KRAKENLCD_USAGE` przed pierwszym startem. Odpytuje je co minutę i 15 s po tym, jak źródło zapowiedziało odświeżenie.

To podsumowanie musi wystawiać coś, co uruchamiasz sam. Format opisuje [docs/usage-source.md](docs/usage-source.md) (po angielsku).

Bez źródła części z limitami i kosztem po cichu o tym mówią. Cała reszta działa.

## Rozwój

- `http://127.0.0.1:30640/lcd?mock` to sama tarcza ze zmyślonymi odczytami sprzętu.

  Parametry `layout`, `theme`, `bg`, `units`, `look`, `mascot`, `bars`, `cost`, `fps` i `lang` wymuszają wariant, np. `/lcd?mock&layout=neofetch&theme=tokyo&mascot=ghost&lang=pl`. Tarcza z edytora to `layout=face:<id>`.
- Exe uruchomione z `KRAKENLCD_WEB=<repo>\web` serwuje pliki strony z dysku, bez przebudowy. Otwarte strony same się przeładowują po restarcie usługi.
- `cargo test` testuje usługę. `node tests/web.js` buduje każdy układ, szablon i widżet w obu językach na sztucznym DOM-ie.
- Logi, ustawienia, tarcze i media są w `%LOCALAPPDATA%\krakenlcd`.

Układ kodu i dodawanie układu, motywu, tła, widżetu albo języka: [CONTRIBUTING.md](CONTRIBUTING.md) (po angielsku).
