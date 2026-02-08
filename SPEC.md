# Bazunia — Specyfikacja funkcjonalna (wersja uproszczona)

Ten dokument opisuje to, co użytkownik faktycznie widzi i robi w aplikacji.
Bez szczegółów implementacyjnych.

---

## 1. Dostęp i konto

### 1.1. Tryby pracy

- `Gość`:
  - dostęp do nauki na taliach publicznych,
  - dane zapisywane lokalnie w przeglądarce.
- `Użytkownik zalogowany`:
  - dostęp do własnych talii,
  - import/edycja/udostępnianie,
  - subskrypcje talii,
  - synchronizacja danych z kontem.

### 1.2. Logowanie

Aplikacja obsługuje:
- logowanie e-mail + hasło,
- rejestrację,
- reset hasła,
- opcjonalnie logowanie Google.

---

## 2. Struktura talii w UI

Aplikacja pokazuje trzy zakładki:

1. `Ogólne`
- talie dostępne dla wszystkich,
- treść zwykle tylko do nauki (bez edycji dla zwykłego użytkownika).

2. `Udostępnione`
- katalog talii publikowanych przez użytkowników,
- wyszukiwanie + paginacja,
- akcje (po zalogowaniu): kopiowanie, subskrypcja/odsubskrypcja.

3. `Moje` (po zalogowaniu)
- sekcja `Własne`: Twoje talie,
- sekcja `Subskrybowane`: talie zasubskrybowane z katalogu.

W sekcji `Własne` są akcje globalne:
- `Nowa talia`,
- `Importuj talię`,
- przełączanie listy aktywne/archiwalne.

---

## 3. Akcje na talii

Z menu karty talii (`⋯`) użytkownik może:

- `Kopiuj` (utworzenie prywatnej kopii),
- `Eksportuj JSON`,
- `Ustawienia` talii,
- `Archiwizuj` / `Przywróć` (dla własnych),
- `Udostępnij` / `Wyłącz udostępnianie` (dla własnych),
- `Odsubskrybuj` (dla subskrybowanych).

Uwaga: część akcji zależy od typu talii i uprawnień.

---

## 4. Kategorie

Jeżeli talia ma zdefiniowane kategorie, przed wyborem trybu nauki pojawia się ekran kategorii:
- `Wszystkie pytania`,
- albo konkretna kategoria.

Dla każdej kategorii pokazywane są liczniki nowych i zaległych kart.

---

## 5. Tryby nauki

### 5.1. Anki

- Nauka oparta o SM-2.
- Kolejność kart: priorytet mają karty w nauce i powtórki, potem nowe.
- Po pokazaniu odpowiedzi użytkownik ocenia kartę:
  - `Powtórz`,
  - `Trudne`,
  - `Dobrze`,
  - `Łatwe`.
- Nagłówek sesji pokazuje liczniki (w nauce / powtórki / nowe).

Dodatkowe możliwości:
- oznaczanie pytania flagą,
- edycja pytania (jeśli talia jest edytowalna),
- ponowne losowanie wariantu pytania (jeśli pytanie wspiera randomizację).

### 5.2. Test

- Użytkownik wybiera liczbę pytań.
- Pytania są testowe (bez fiszek).
- Po zakończeniu jest wynik procentowy i przegląd odpowiedzi.
- Można wracać do poprzedniego pytania podczas testu.
- Tryb testu nie zmienia postępu SRS.

### 5.3. Przeglądanie

- Lista pytań z odpowiedziami i wyjaśnieniem.
- Wyszukiwarka pytań.
- W edytowalnych taliach: dodawanie i edycja pytań.

### 5.4. Oznaczone

- Tryb dostępny po oznaczeniu pytań flagą.
- Pokazuje wyłącznie oznaczone pytania.
- Umożliwia rozpoczęcie nauki Anki tylko na tej podgrupie.

### 5.5. Głosy społeczności (poprawność odpowiedzi)

- Funkcja działa dla talii:
  - `Ogólne`,
  - `Subskrybowane` z katalogu `Udostępnione`.
- Głos dotyczy konkretnej odpowiedzi i jest zapisywany per:
  `użytkownik + talia + pytanie + odpowiedź`.
- Znaczenie głosów:
  - `+1` = „ta odpowiedź powinna być poprawna”,
  - `-1` = „ta odpowiedź powinna być błędna”.
- W pytaniach `single` UI pokazuje tylko `+1`.
- W pytaniach `multiple` UI pokazuje `+1` i `-1`.
- Przełącznik głosu:
  - brak głosu -> `+1` lub `-1`,
  - klik aktywnego głosu usuwa głos (`0`),
  - klik przeciwnego głosu zmienia głos.
- Głosować mogą tylko użytkownicy zalogowani.
- Liczniki `+N/-N` są widoczne także dla gości (jeśli Supabase jest skonfigurowany).
- Widoczność liczników:
  - `Anki`: po `Pokaż odpowiedź`,
  - `Test`: w ekranie wyniku (sekcja przeglądu odpowiedzi),
  - `Przeglądanie`: od razu przy odpowiedziach.
- Głosy mają charakter informacyjny:
  - nie zmieniają oficjalnego klucza odpowiedzi,
  - nie wpływają na scoring testu ani ocenę SRS.

---

## 6. Import talii JSON

### 6.1. Wymagane pola

Plik musi mieć:
- `deck.id` (unikalny identyfikator),
- `deck.name` (nazwa),
- opcjonalnie: `deck.defaultSelectionMode` (`single` lub `multiple`),
- `questions` (niepusta tablica pytań).

### 6.2. Zasady pytań

Dla każdego pytania:
- wymagane: `id`, `text`.
- opcjonalnie: `selectionMode` (`single` lub `multiple`) dla pytań testowych,
- odpowiedzi:
  - `0` odpowiedzi = fiszka,
  - `2+` odpowiedzi = pytanie testowe,
  - `1` odpowiedź = błąd walidacji.

Dla pytań testowych:
- odpowiedź musi mieć `id`, `text`,
- poprawność przez `correct` (boolean) lub `correctWhen` (warunek dynamiczny),
- musi istnieć co najmniej jedna odpowiedź poprawna,
- tryb wyboru wyznaczany jest kolejno:
  1. `question.selectionMode`,
  2. `deck.defaultSelectionMode`,
  3. domyślnie `multiple` (zgodność wsteczna),
- dla `selectionMode=single`:
  - pytanie statyczne musi mieć dokładnie 1 poprawną odpowiedź,
  - pytanie z `correctWhen` jest dozwolone; jeśli po losowaniu wyjdzie >1 poprawna, UI tymczasowo przełącza pytanie na `multiple`.

### 6.3. Reimport

Import tej samej talii (`deck.id`) aktualizuje pytania i dodaje nowe,
z zachowaniem istniejącego postępu kart.

### 6.4. Minimalny przykład

```json
{
  "deck": {
    "id": "moja-talia",
    "name": "Nazwa talii",
    "defaultSelectionMode": "single"
  },
  "questions": [
    {
      "id": "q001",
      "text": "Treść pytania",
      "selectionMode": "single",
      "answers": [
        { "id": "a", "text": "A", "correct": false },
        { "id": "b", "text": "B", "correct": true }
      ]
    }
  ]
}
```

---

## 7. Randomizacja pytań

Aplikacja obsługuje dwa typy losowości:

1. `Pytania szablonowe` (`randomize` w JSON)
- wartości losowane na podstawie definicji pytania,
- mogą dynamicznie wpływać na poprawność odpowiedzi.

2. `Wbudowane warianty obliczeniowe`
- przełącznik per talia w ustawieniach,
- dotyczy pytań z przygotowanym generatorem.

W sesji Anki można ręcznie losować nowy wariant pytania (przycisk z ikoną kości).

---

## 8. Ustawienia

### 8.1. Ustawienia aplikacji

- motyw i paleta kolorów,
- szerokość układu,
- widok listy talii (kompaktowy/klasyczny),
- skróty klawiszowe,
- mieszanie odpowiedzi,
- kolejność pytań w teście (losowa/po kolei),
- uwzględnianie oznaczonych pytań w standardowej sesji Anki.

### 8.2. Ustawienia talii

- nazwa/opis/grupa (dla talii edytowalnych),
- limity dzienne (`newCardsPerDay`, `maxReviewsPerDay`),
- kroki nauki i ponownej nauki,
- interwał początkowy, łatwy i maksymalny,
- przełącznik wbudowanych wariantów obliczeniowych,
- reset postępu talii.

---

## 9. Skróty klawiszowe

### 9.1. Anki

- `1-9` — wybór odpowiedzi,
- `Spacja` / `Enter` — pokaż odpowiedź,
- `1` / `2` / `3` / `4` — oceny,
- `F` — flaga pytania.

### 9.2. Test

- `1-9` — wybór odpowiedzi,
- `Spacja` / `Enter` — przejście dalej (po zaznaczeniu).

---

## 10. Zapis i synchronizacja

- W trybie gościa dane są lokalne.
- Po zalogowaniu dane są zapisywane na koncie użytkownika.
- Aplikacja może przenieść dane lokalne na konto po pierwszym logowaniu,
  żeby zachować wcześniejszy postęp.

---

## 11. Ograniczenia i uprawnienia

- Edycja treści pytań jest dostępna tylko dla talii edytowalnych.
- Talia prywatna może być archiwalna (bez wejścia do nauki do momentu przywrócenia).
- Panel administracyjny jest widoczny tylko dla ról `admin` / `dev`.
