# Baza Deluxe

Aplikacja webowa do nauki pytań egzaminacyjnych i fiszek z algorytmem powtórek SM-2.
Działa w przeglądarce, a stan nauki zapisuje lokalnie w `localStorage`.

## Wymagania

- Docker + Docker Compose (np. Docker Desktop)
- Wolny port `8080`

## Szybki start (Docker Compose)

W katalogu projektu uruchom:

```bash
docker compose up -d
```

Aplikacja będzie dostępna pod adresem:

- `http://localhost:8080`

## Najczęstsze komendy

Podgląd logów kontenera:

```bash
docker compose logs -f web
```

Zatrzymanie i usunięcie kontenera:

```bash
docker compose down
```

Restart po zmianach:

```bash
docker compose restart web
```

## Jak to działa technicznie

- Serwer: `nginx:alpine`
- Mapowanie portów: `8080:80`
- Kod projektu montowany do kontenera jako `read-only`
- Konfiguracja Nginx z `nginx.conf`

## Struktura projektu

```text
index.html              # główny widok aplikacji
docs.html               # dokumentacja funkcji w UI
docker-compose.yml      # uruchamianie przez Docker Compose
nginx.conf              # konfiguracja serwera

css/
  main.css
  components.css

js/
  app.js
  card.js
  deck.js
  importer.js
  randomizers.js
  sm2.js
  storage.js
  ui.js
  utils.js

data/                   # talie wbudowane (auto-import przy starcie)
  poi-egzamin.json
  si-egzamin.json
  sample-exam.json
  randomize-demo.json
  ii-egzamin.json
  ii-egzamin-fiszki.json
  zi2-egzamin.json
```

## Import własnej talii

W aplikacji użyj przycisku `Importuj talię` i wskaż plik JSON.
Minimalny format:

```json
{
  "deck": {
    "id": "moja-talia",
    "name": "Nazwa talii"
  },
  "questions": [
    {
      "id": "q001",
      "text": "Treść pytania",
      "answers": [
        { "id": "a", "text": "A", "correct": false },
        { "id": "b", "text": "B", "correct": true }
      ]
    }
  ]
}
```

## Rozwiązywanie problemów

- Błąd portu `8080` zajęty: zmień mapowanie w `docker-compose.yml` (np. `8081:80`) i uruchom ponownie.
- Brak danych/„dziwne” zachowanie po zmianie formatu kart: wyczyść `localStorage` dla `localhost` i odśwież stronę.
