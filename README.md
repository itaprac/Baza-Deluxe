# Bazunia

Aplikacja webowa do nauki pytań egzaminacyjnych i fiszek z algorytmem powtórek SM-2.
Stan użytkownika (talie, karty, statystyki, ustawienia, progres) zapisuje w Supabase.

## Publiczne vs prywatne talie

- `Ogólne` — talie wbudowane z katalogu `data/`, widoczne dla każdego (także gościa), tylko do nauki/przeglądu.
- `Moje` — talie prywatne użytkownika, widoczne po zalogowaniu.
- W zakładce `Moje` możesz tworzyć talie ręcznie (`Nowa talia`) i dodawać pytania w trybie `Przeglądanie` (`+ Dodaj pytanie`).
- Import własnej talii jest dostępny wyłącznie po zalogowaniu i tylko w zakładce `Moje`.
- W taliach `Ogólne` nie można usuwać talii ani edytować pytań, ale można uczyć się, robić testy i używać własnych ustawień SRS.

## Wymagania

- Docker + Docker Compose (np. Docker Desktop)
- Wolny port `8080`
- Projekt Supabase

## Szybki start (Docker Compose)

W katalogu projektu uruchom:

```bash
docker compose up -d
```

Aplikacja będzie dostępna pod adresem:

- `http://localhost:8080`

## Konfiguracja Supabase

1. W Supabase SQL Editor uruchom skrypt: `supabase/schema.sql`.
2. Skopiuj plik `.env.example` do `.env` i ustaw:

```bash
cp .env.example .env
```

`.env`:

```env
BAZUNIA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
BAZUNIA_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

3. W panelu Supabase włącz provider `Email` oraz opcjonalnie `Google` (`Authentication -> Providers`).
4. Uruchom aplikację. Możesz zalogować się lub kontynuować jako gość (tryb lokalny).

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
- Auth + baza: Supabase (`auth.users` + tabela `public.user_storage`)

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
  supabase.js
  supabase-config.js
  runtime-config.template.js
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

supabase/
  schema.sql            # tabela i polityki RLS dla danych użytkownika
```

## Tworzenie i import własnej talii

Po zalogowaniu przejdź do zakładki `Moje`:
- `Nowa talia` — tworzy prywatną talię ręcznie.
- `Importuj talię` — importuje plik JSON.

Po utworzeniu talii możesz w trybie `Przeglądanie` dodawać nowe pytania przyciskiem `+ Dodaj pytanie`.

Minimalny format JSON do importu:
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
- Brak logowania: sprawdź URL/anon key Supabase w `.env` i zrestartuj kontener (`docker compose down && docker compose up -d`).
- Brak zapisu postępu: sprawdź czy wykonano `supabase/schema.sql` i czy RLS policies są aktywne.
