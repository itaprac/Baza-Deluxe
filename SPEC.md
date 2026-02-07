# Bazunia — Specyfikacja funkcjonalna

Aplikacja webowa SPA do nauki z fiszkami (flashcards) z algorytmem powtarzania rozłożonego SM-2. Działa w przeglądarce, dane trzyma w `localStorage`. Bez frameworków, czysty JS (ES6 modules), CSS, HTML. Wymaga serwera HTTP (moduły ES6 nie działają z `file://`).

Język interfejsu: **polski**.

---

## 1. Zarządzanie taliami

### 1.1. Import talii z pliku JSON

Użytkownik importuje talię przez file picker (`.json`). Format pliku:

```json
{
  "deck": {
    "id": "unikalne-id",
    "name": "Nazwa talii",
    "description": "Opcjonalny opis",
    "version": 1
  },
  "questions": [
    {
      "id": "q001",
      "text": "Treść pytania",
      "answers": [
        { "id": "a", "text": "Odpowiedź A", "correct": false },
        { "id": "b", "text": "Odpowiedź B", "correct": true },
        { "id": "c", "text": "Odpowiedź C", "correct": true }
      ],
      "explanation": "Opcjonalne wyjaśnienie"
    }
  ]
}
```

**Walidacja przy imporcie:**
- `deck.id` — wymagane, string, regex `[a-zA-Z0-9_-]+`
- `deck.name` — wymagane, string
- `questions` — wymagana niepusta tablica
- Każde pytanie: unikalne `id` (string), `text` (string), `answers` (min. 2)
- Każda odpowiedź: `id` (string), `text` (string), `correct` (boolean)
- Co najmniej jedna odpowiedź `correct: true` na pytanie
- Pytanie może mieć wiele poprawnych odpowiedzi

**Merge przy reimporcie:** jeśli talia o tym samym `id` już istnieje, pytania nadpisywane z pliku, ale stan nauki (SRS) istniejących kart jest zachowany. Nowe pytania dostają karty w stanie `new`.

Po imporcie: notyfikacja z liczbą nowych/istniejących/łącznych pytań.

### 1.2. Auto-import wbudowanych talii

Przy starcie aplikacja próbuje pobrać (`fetch`) pliki JSON z katalogu `data/`. Jeśli talia nie istnieje jeszcze w bazie — importuje automatycznie. Błędy są ignorowane (pliki mogą nie istnieć).

### 1.3. Usuwanie talii

Wymaga potwierdzenia modalem ("Czy na pewno chcesz usunąć?"). Usuwa całkowicie: metadane, pytania, karty (stan SRS) i statystyki.

### 1.4. Lista talii (strona główna)

Wyświetla wszystkie talie z informacjami:
- Nazwa, opis (opcjonalny)
- **Do powtórki** — karty learning/relearning due + review due
- **Nowych** — karty w stanie `new`
- **Łącznie** — total kart

Akcje na każdej talii: otwórz (→ wybór trybu), ustawienia SRS, usuń.

Gdy brak talii — stan pusty z przyciskiem importu.

---

## 2. Wybór trybu nauki

Po otwarciu talii użytkownik wybiera tryb:

1. **Anki** — nauka z powtarzaniem rozłożonym SM-2. Zablokowany gdy 0 kart do powtórki i 0 nowych.
2. **Test** — losowy egzamin z wybraną liczbą pytań. Zablokowany gdy talia pusta.
3. **Przeglądanie** — lista wszystkich pytań z odpowiedziami. Zablokowane gdy talia pusta.

---

## 3. Sesja nauki Anki (tryb SRS)

### 3.1. Kolejki i priorytet kart

Na starcie sesji budowane są trzy kolejki:

1. **Learning** — karty `learning`/`relearning` z `dueDate <= now`, posortowane po `dueDate`
2. **Review** — karty `review` z `dueDate <= now`, posortowane po `dueDate`
3. **New** — karty `new`, ograniczone do `newCardsPerDay` minus już wprowadzone dziś

**Priorytet pobierania:** learning → review → new.

Jeśli karta learning czeka (due za chwilę) ale nie ma review/new — wyświetlany jest **ekran oczekiwania** z odliczaniem (mm:ss aktualizowane co sekundę) i przyciskiem "Zakończ sesję". Automatyczne przejście do karty gdy dueDate minie.

Nagłówek sesji wyświetla trzy liczniki (learning + review + new remaining) oraz pasek postępu.

### 3.2. Faza pytania

- Treść pytania, ponumerowane odpowiedzi
- Odpowiedzi shufflowane losowo (lub oryginalna kolejność jeśli ustawienie `shuffleAnswers` wyłączone)
- Zawsze tryb multi-select: "Zaznacz wszystkie poprawne"
- Użytkownik klika odpowiedzi (toggle zaznaczenia) i klika "Pokaż odpowiedź" / "Sprawdź odpowiedź"
- Tekst przycisku zmienia się: "Pokaż odpowiedź" gdy nic nie zaznaczone → "Sprawdź odpowiedź" gdy coś zaznaczone
- Przycisk edycji pytania (ikona ołówka) → otwiera edytor inline

### 3.3. Faza feedback

Po kliknięciu "Pokaż/Sprawdź odpowiedź":

**Kolorowanie odpowiedzi:**
- Poprawna + zaznaczona → zielone tło, ikona ✓ (sukces)
- Błędna + zaznaczona → czerwone tło, ikona ✗ (błąd)
- Poprawna + niezaznaczona → żółte tło, ikona ✓ (pominięta)
- Gdy użytkownik nic nie zaznaczył → tylko poprawne podświetlone na zielono

**Wyjaśnienie:** jeśli pytanie ma pole `explanation`, wyświetlane jako blok pod odpowiedziami.

**4 przyciski oceny:**
- **Powtórz** (Again) — kolor czerwony
- **Trudne** (Hard) — kolor żółty
- **Dobrze** (Good) — kolor zielony
- **Łatwe** (Easy) — kolor niebieski/fioletowy

Każdy przycisk pokazuje:
- Etykietę (np. "Powtórz")
- Przewidywany interwał (np. "1m", "10m", "1d")
- Skrót klawiszowy (dynamiczny z ustawień, np. "1")

Pod przyciskami: hint tekstowy np. "Spacja / Enter = Dobrze" (dynamiczny z keybindings).

Przycisk edycji pytania (ołówek) także dostępny w tej fazie.

### 3.4. Podsumowanie sesji

Po przejściu wszystkich kart:
- Liczba kart przeglądanych (suma ocen)
- Nowe karty wprowadzone
- Powtórek wykonanych
- Rozkład ocen — 4 słupki (Powtórz / Trudne / Dobrze / Łatwe) z liczbami
- Przycisk powrotu do listy talii

---

## 4. Algorytm SM-2 (Spaced Repetition)

### 4.1. Model karty

Każda karta posiada:
- `state`: `new` | `learning` | `review` | `relearning`
- `easeFactor`: mnożnik trudności (start 2.5, min 1.3)
- `interval`: interwał w dniach (dla kart w review)
- `stepIndex`: aktualny krok nauki (index w tablicy kroków)
- `dueDate`: timestamp następnej powtórki
- `lapses`: ile razy karta wróciła do relearning z review
- `reviewCount`: łączna liczba powtórek
- `lastReviewDate`: timestamp ostatniej powtórki
- `firstStudiedDate`: timestamp pierwszego kontaktu

### 4.2. Ustawienia algorytmu (konfigurowalne)

```
learningSteps:        [1, 10]       minuty — kroki dla nowych kart
relearningSteps:      [10]          minuty — kroki po pomyłce w review
graduatingInterval:   1             dni — interwał po ukończeniu kroków
easyInterval:         4             dni — interwał "Łatwe"
startingEase:         2.5
minimumEase:          1.3
easyBonus:            1.3           mnożnik dla "Łatwe" w review
hardIntervalMultiplier: 1.2         mnożnik dla "Trudne" w review
newIntervalMultiplier:  0.7         mnożnik interwału po lapse
minimumInterval:      1             dni
maximumInterval:      36500         dni (~100 lat)
newCardsPerDay:       20
maxReviewsPerDay:     200
```

### 4.3. Przetwarzanie oceny — karty Learning / Relearning

| Ocena | Zachowanie |
|---|---|
| **Again (1)** | Resetuje `stepIndex` do 0. `dueDate` = teraz + steps[0] minut. |
| **Hard (2)** | `stepIndex` się NIE zmienia. Jeśli stepIndex=0 i są ≥2 kroki: delay = średnia steps[0] i steps[1]. Inaczej: delay = steps[stepIndex] × 1.5. |
| **Good (3)** | Jeśli to ostatni krok → graduation (przejście do review). Inaczej: stepIndex++, dueDate = teraz + steps[stepIndex] minut. |
| **Easy (4)** | Natychmiastowe graduation z `easyInterval`. |

**Graduation:**
- Z learning: `interval` = `graduatingInterval` (Good) lub `easyInterval` (Easy)
- Z relearning: `interval` = max(stary interval, `minimumInterval`) dla Good, max(stary interval, `easyInterval`) dla Easy
- Stan zmienia się na `review`
- `dueDate` = start dnia (midnight) + interval × 24h
- Fuzz factor zapobiega grupowaniu kart tego samego dnia

### 4.4. Przetwarzanie oceny — karty Review

`daysLate` = ile dni karta była przeterminowana (0 jeśli na czas).

| Ocena | Zachowanie |
|---|---|
| **Again (1)** | `easeFactor` -= 0.20 (min 1.3). `lapses`++. `interval` = max(minimumInterval, floor(interval × `newIntervalMultiplier`)). Stan → `relearning`, stepIndex=0. `dueDate` = teraz + relearningSteps[0] minut. |
| **Hard (2)** | `easeFactor` -= 0.15 (min 1.3). `interval` = max(interval+1, floor(interval × `hardIntervalMultiplier`)). |
| **Good (3)** | `interval` = max(interval+1, floor((interval + daysLate/2) × easeFactor)). |
| **Easy (4)** | `easeFactor` += 0.15. `interval` = max(interval+1, floor((interval + daysLate) × easeFactor × `easyBonus`)). |

Dla Hard/Good/Easy: fuzz, clamp do maximumInterval, `dueDate` = start dnia + interval × 24h.

### 4.5. Fuzz factor

- interval < 2 → brak fuzz
- interval = 2 → losowo 2 lub 3
- interval ≥ 3 → ±5% zakresu (min ±1 dzień), losowy int z tego zakresu

### 4.6. Wyświetlanie interwałów na przyciskach

Każdy przycisk oceny wyświetla przewidywany interwał. Format: `<1m`, `1m`, `10m`, `2h`, `1.5h`, `1d`, `3d`, `1.5mo`, `1y`.

Osobna logika obliczania dla kart learning/relearning (bazuje na krokach minutowych) vs review (bazuje na dniach i easeFactor).

### 4.7. Po ocenie

Sekwencja po wybraniu oceny:
1. Oblicz nowy stan karty algorytmem SM-2
2. Zapisz stan karty do storage
3. Zapisz statystykę dzienną (rating count, source)
4. Jeśli karta nadal w learning/relearning → wstaw z powrotem do kolejki (posortowanej po dueDate)
5. Zaktualizuj licznik postępu
6. Pobierz następną kartę

---

## 5. Edytor pytań (inline)

Dostępny w trybie Anki, zarówno w fazie pytania jak i feedback. Wejście przez przycisk ołówka.

### Formularz:
- **Treść pytania** — textarea, wieloliniowa
- **Odpowiedzi** — lista istniejących odpowiedzi, każda:
  - Toggle switch (on/off) — czy poprawna
  - Text input — treść odpowiedzi
- **Wyjaśnienie** — textarea (opcjonalne)
- Przyciski: **Anuluj**, **Zapisz zmiany**

### Walidacja:
- Treść pytania nie może być pusta
- Żadna odpowiedź nie może mieć pustego tekstu
- Co najmniej jedna odpowiedź musi być poprawna

### Zachowanie:
- Zapisuje zmienione pytanie do bazy (storage)
- Aktualizuje referencje in-memory (bieżące pytanie i shuffled answers)
- Powrót do fazy, z której weszło (question → re-render pytania; feedback → re-render feedback)
- Notyfikacja "Pytanie zostało zaktualizowane"
- Anuluj → powrót bez zmian
- Podczas edycji skróty klawiszowe sesji nauki są wyłączone

**Ograniczenia:** nie pozwala dodawać/usuwać odpowiedzi — jedynie edytować istniejące treści i przełączać poprawność.

---

## 6. Tryb testowy

### 6.1. Konfiguracja testu

Slider z liczbą pytań (zakres: 1 do łączna liczba pytań w talii). Domyślnie: min(10, total). Przycisk "Rozpocznij test".

### 6.2. Przebieg testu

- Pytania losowane z puli (shuffle), obcięte do wybranej liczby
- Wyświetlane po kolei: treść, odpowiedzi (shufflowane lub nie wg ustawień), hint multi-select
- Użytkownik zaznacza odpowiedzi (toggle), klika "Następne pytanie" (disabled dopóki nic nie zaznaczone)
- Na ostatnim pytaniu: przycisk "Zakończ test"
- **Cofanie:** od pytania 2 dostępny przycisk "Wstecz"
- Progress bar i licznik "X / Y"

### 6.3. Cofanie do poprzedniego pytania

Przy cofaniu:
- Zaznaczenia bieżącego pytania są zapisywane
- Kolejność odpowiedzi (shuffle order) jest zapamiętana per pytanie i przywracana (odpowiedzi nie są re-shufflowane)
- Poprzednie zaznaczenia są przywracane (widoczne jako zaznaczone)
- Przycisk "Następne pytanie" jest aktywny jeśli coś było zaznaczone

### 6.4. Wynik testu

**Logika poprawności:** odpowiedź uznana za poprawną TYLKO gdy zaznaczono **dokładnie** te same odpowiedzi co poprawne (identyczny zbiór ID — ni mniej, ni więcej).

Wyświetlane informacje:
- Wynik: X / Y
- Procent
- Kolorowy wskaźnik: <50% czerwony, 50–74% żółty, ≥75% zielony
- Pasek postępu w kolorze wyniku
- Przyciski: "Powtórz test" (→ konfiguracja), "Powrót do talii"

**Lista przeglądowa wyników:**
Każde pytanie z ikoną ✓/✗ i treścią. Kliknięcie rozwija szczegóły:
- Każda odpowiedź z kolorowym oznaczeniem:
  - Zaznaczona + poprawna → zielona ✓
  - Zaznaczona + błędna → czerwona ✗
  - Niezaznaczona + poprawna → żółta ✓ (pominięta)
  - Niezaznaczona + błędna → bez wyróżnienia

---

## 7. Przeglądanie pytań (Browse)

- Lista wszystkich pytań talii z numeracją
- Każde pytanie: treść, wszystkie odpowiedzi (poprawne wyróżnione kolorem + ikoną ✓), opcjonalne wyjaśnienie
- **Wyszukiwarka** na górze — filtruje pytania po tekście pytania (case-insensitive, substring match)
- Gdy brak wyników — komunikat "Brak wyników dla podanego zapytania"

---

## 8. Ustawienia algorytmu SM-2

Dostępne per talia (przycisk "Ustawienia" na karcie talii).

### Konfigurowalne parametry:

| Parametr | Typ | Zakres | Domyślnie |
|---|---|---|---|
| Nowe karty dziennie | int | 1–100 | 20 |
| Maks. powtórek dziennie | int | 1–9999 | 200 |
| Kroki nauki | lista minut | >0 | 1, 10 |
| Kroki ponownej nauki | lista minut | >0 | 10 |
| Interwał początkowy | int dni | 1–30 | 1 |
| Łatwy interwał | int dni | 1–60 | 4 |
| Maks. interwał | int dni | 1–36500 | 365 |

Kroki nauki/relearning: wpisywane jako tekst, oddzielone przecinkami. Walidacja: min. 1 wartość, każda > 0.

Przyciski: **Zapisz**, **Przywróć domyślne** (resetuje formularz do wartości domyślnych).

**Strefa zagrożenia:** przycisk "Resetuj postęp talii" — po potwierdzeniu modalem resetuje wszystkie karty do stanu `new` i czyści statystyki. Nieodwracalne.

---

## 9. Ustawienia aplikacji

Dostępne z headerze strony głównej (przycisk "Ustawienia").

### 9.1. Skróty klawiszowe

Tabela akcji z przypisanymi klawiszami:

| Akcja | Domyślne klawisze |
|---|---|
| Pokaż odpowiedź | Spacja, Enter |
| Powtórz (Again) | 1 |
| Trudne (Hard) | 2 |
| Dobrze (Good) | 3 |
| Łatwe (Easy) | 4 |

Każdy wiersz wyświetla: nazwę akcji, wizualne "badge" z nazwami klawiszy, przycisk **"Zmień"**.

**Key recorder:**
1. Klik "Zmień" → przycisk zmienia tekst na "Naciśnij klawisz...", wizualna animacja pulsowania
2. Użytkownik naciska dowolny klawisz → zapisywany jako nowe przypisanie
3. Escape → anuluje bez zmian
4. Aktywne nagrywanie jest zawsze max 1 (nowe anuluje poprzednie)
5. Nagrywanie przechwytuje klawisz na poziomie capture phase, blokuje propagację

**Przywróć domyślne skróty** — resetuje wszystkie do wartości domyślnych. Notyfikacja.

Nazwy klawiszy wyświetlane czytelnie: Spacja zamiast `' '`, Enter, Esc, ↑↓←→, ⌫ itd.

### 9.2. Motyw (theme)

Trzy opcje do wyboru: **Jasny** / **Ciemny** / **Auto** (systemowy).

- Jasny → wymusza jasny motyw
- Ciemny → wymusza ciemny motyw
- Auto → wykrywa preferencje systemu przez `matchMedia('(prefers-color-scheme: dark)')` z nasłuchiwaniem zmian w czasie rzeczywistym

Zmiana natychmiastowa i zapisywana do storage.

Ciemny motyw zmienia kolory tła, tekstu, bordery, kolory ocen, odpowiedzi, modali — wszystko przez zmienne CSS (atrybut `data-theme` na `<html>`).

### 9.3. Mieszanie odpowiedzi

Toggle switch on/off. Domyślnie: **włączony**.

- **ON** → odpowiedzi w sesjach Anki i testach losowo permutowane (Fisher-Yates shuffle)
- **OFF** → odpowiedzi w oryginalnej kolejności z JSON

Zmiana natychmiastowa i zapisywana. Dotyczy zarówno trybu Anki jak i testowego.

---

## 10. Skróty klawiszowe

### Tryb nauki — faza pytania:
- **1–9** → klik na odpowiedź o danym numerze
- **keybindings.showAnswer** (domyślnie Spacja/Enter) → pokaż feedback

### Tryb nauki — faza feedback:
- **keybindings.again** (domyślnie 1) → ocena Again
- **keybindings.hard** (domyślnie 2) → ocena Hard
- **keybindings.good** (domyślnie 3) → ocena Good
- **keybindings.easy** (domyślnie 4) → ocena Easy
- **keybindings.showAnswer** (domyślnie Spacja/Enter) → ocena Good (skrót)

### Tryb testowy:
- **1–9** → klik na odpowiedź o danym numerze
- **Spacja/Enter** → następne pytanie (jeśli coś zaznaczono i przycisk aktywny)

### Blokowanie skrótów:
- Gdy focus w `<input>` lub `<textarea>` — skróty nieaktywne
- Gdy Ctrl/Meta/Alt wciśnięty — skróty nieaktywne
- Gdy aktywny key recorder — skróty przechwytywane przez recorder
- Gdy aktywny edytor pytań — skróty sesji wyłączone

---

## 11. Skalowanie czcionki

Stały kontroler w rogu ekranu: przyciski **A−** i **A+**.

6 poziomów skalowania: `0.85`, `0.925`, `1.0`, `1.1`, `1.25`, `1.4`. Domyślny poziom: 2 (= 1.0).

Skalowanie wpływa na treść pytań i odpowiedzi (przez zmienną CSS `--font-scale`). Poziom zapisywany w localStorage.

---

## 12. Powiadomienia (Toast)

Wyświetlane u góry ekranu, centrowane. Auto-znikają po 3 sekundach z animacją fade-out.

Typy: `success` (zielone), `error` (czerwone), `info` (niebieskie).

Max 1 powiadomienie na ekranie — nowe zastępuje poprzednie.

---

## 13. Modal potwierdzenia

Overlay przyciemniający ekran z boxem: tytuł, tekst, przyciski "Anuluj" i "Usuń" (czerwony).

Zamykanie: klik "Anuluj", klik "Usuń" (potwierdza), klik na overlay poza boxem (anuluje).

Używany przy: usuwaniu talii, resetowaniu postępu.

---

## 14. Przechowywanie danych

Wszystko w `localStorage` z prefixem `bazunia_`:

| Klucz | Zawartość |
|---|---|
| `bazunia_decks` | JSON — tablica metadanych talii |
| `bazunia_cards_{deckId}` | JSON — tablica kart (stan SRS) |
| `bazunia_questions_{deckId}` | JSON — tablica pytań z odpowiedziami |
| `bazunia_stats_{deckId}` | JSON — statystyki dzienne (klucz YYYY-MM-DD) |
| `bazunia_settings` | JSON — ustawienia algorytmu SM-2 |
| `bazunia_appSettings` | JSON — ustawienia aplikacji |
| `bazunia_fontLevel` | int — poziom skalowania czcionki |

Przy braku miejsca w localStorage — błąd z komunikatem.

### Statystyki dzienne (per talia, per dzień):

```
newStudied:    int  — nowe karty wprowadzone
reviewsDone:   int  — powtórki review
learningSteps: int  — kroki learning
againCount:    int  — ocena "Powtórz"
hardCount:     int  — ocena "Trudne"
goodCount:     int  — ocena "Dobrze"
easyCount:     int  — ocena "Łatwe"
```

---

## 15. Znane ograniczenia i reguły

- Nawigacja SPA bez routera URL — odświeżenie wraca na listę talii
- Brak offline (Service Worker) i synchronizacji (backend)
- Brak eksportu danych / backupu
- Usunięcie talii i reset postępu są nieodwracalne
- Wszystkie pytania traktowane jako multi-select (`isMultiSelect` = true, zawsze)
- Edytor pytań dostępny tylko w trybie Anki, nie pozwala dodawać/usuwać odpowiedzi
- Key recorder nadpisuje binding jednym klawiszem (nie kumuluje, nie obsługuje Ctrl/Alt/Meta kombinacji)
- Dane per-talia: pytania, karty (SRS) i statystyki mają osobne klucze w localStorage

---

## 16. Warstwa społecznościowa (username, udostępnianie, subskrypcje)

### 16.1. Publiczny username

- Każde konto ma `username` (losowany przy rejestracji).
- `username` jest unikalny globalnie (case-insensitive).
- Edycja `username` jest dostępna w profilu użytkownika.
- W widokach społecznościowych pokazywany jest `username`, nie e-mail autora.

### 16.2. Zakładki listy talii

Lista główna ma 3 zakładki:

- `Ogólne`
- `Udostępnione`
- `Moje`

W `Moje` są 2 sekcje:

- `Własne`
- `Subskrybowane`

### 16.3. Udostępnianie talii prywatnych

- Właściciel prywatnej talii może ją opublikować w katalogu `Udostępnione`.
- Publikacja tworzy snapshot pytań i metadanych w bazie.
- Wyłączenie udostępniania ustawia publikację jako nieaktywną (`soft-unpublish`).
- Jeśli talia jest udostępniona, zmiany treści/metadanych synchronizują snapshot automatycznie.

### 16.4. Subskrypcje talii udostępnionych

- Użytkownik może subskrybować talię z katalogu `Udostępnione`.
- Subskrybowane talie są read-only (nauka/test/browse dostępne, edycja treści wyłączona).
- Postęp SRS subskrybenta jest lokalny i niezależny od autora.
- Synchronizacja subskrypcji odbywa się przy logowaniu i wejściu do zakładki `Moje`.
- Gdy autor wyłączy udostępnianie, subskrypcja zostaje oznaczona jako `niedostępna` i pozostaje lokalnie.

### 16.5. Kopiowanie talii

- Talię można kopiować z `Ogólne`, `Udostępnione` i `Moje`.
- Kopia zawsze tworzy nową, niezależną prywatną talię.
- Przy kopiowaniu użytkownik wybiera tryb:
  - `Start od zera` (karty `new`, puste statystyki),
  - `Kopiuj postęp` (kopiowanie kart/statystyk, jeśli źródło je posiada).
