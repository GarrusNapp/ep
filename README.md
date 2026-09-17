# Mikroserwis plikowy

Mikroserwis (NestJS) przechowujący pliki z podziałem na dwa tiery: **hot**
(szybki dostęp) i **archive**. Pełne uzasadnienie decyzji architektonicznych
w [SPECYFIKACJA.md](./SPECYFIKACJA.md).

## Uruchomienie

```bash
npm install
npm run start:dev
```

Konfiguracja przez zmienne środowiskowe — plik .env na podstawie schematu w
[src/config/configuration.ts](./src/config/configuration.ts), przykładowe wartości
w [.example.env](./.example.env).

| Zmienna                                                                                | Wymagana?                  | Znaczenie                                                                          |
| -------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `ALLOWED_TYPES`                                                                        | tak                        | zamknięta whitelista typów plików                                                  |
| `ARCHIVE_AFTER_MS`                                                                     | tak                        | próg kwalifikacji pliku do archiwizacji                                            |
| `ARCHIVE_SWEEP_INTERVAL_MS`                                                            | tak                        | co ile sprawdzany jest próg                                                        |
| `ARCHIVE_PATH`                                                                         | opcjonalna*                | katalog archiwum na dysku                                                          |
| `HOT_PATH`                                                                             | opcjonalna, **nieużywana** | zarezerwowana pod przyszłe `DiskFileStorage` jako hot tier                         |
| `HOT_MAX_SIZE`                                                                         | tak                        | bezpiecznik wyzwalający natychmiastową archiwizację (bajty albo `"512MB"`/`"1GB"`) |
| `MAX_FILE_SIZE`                                                                        | tak                        | maksymalny rozmiar pojedynczego pliku (bajty albo `"512MB"`/`"1GB"`)               |
| `PORT`, `ARCHIVE_BATCH_SIZE`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`, `EXISTS_BATCH_MAX` | tak                        | patrz configuration.ts                                                             |

`*` `ARCHIVE_PATH`/`HOT_PATH` są opcjonalne na poziomie schematu configu — schemat
nie wie, który tier faktycznie korzysta z dysku.

## Testy

```bash
npm run test       # unit
npm run test:e2e   # pełne sekwencje HTTP
npm run lint       # oxlint
```

## Kontrakt API

```
POST   /files/:type/:id          zapis (multipart/form-data, pole "file")
GET    /files/:type/:id          pobranie bajtów
HEAD   /files/:type/:id          istnienie + tier, bez transferu (X-Storage-Tier)
DELETE /files/:type/:id          usunięcie
GET    /files/:type              lista ID, paginacja kursorowa
POST   /files/:type/_exists      batch: lista ID → tier ({"ids":[...]})
```

`type` musi należeć do `ALLOWED_TYPES`
`id`/`type` są walidowane whitelistą znaków — patrz
[safe-id.validator.ts](./src/common/validators/safe-id.validator.ts).

swagger dostępny pod `http://localhost:3000/docs`

## uwagi

1. **Hot jest tierem, nie cache'em.** Plik trafia wyłącznie do hot storage;
   archiwum nie widzi go, dopóki scheduler go nie przeniesie. Przy
   domyślnym adapterze `MemoryFileStorage` (in-memory) restart procesu kasuje
   wszystko, co nie zdążyło zmigrować do archiwum.

2. **Odrzucona alternatywa**:
   - _write-through_ (każdy zapis od razu na archive, hot jako
     cache) — odrzucone, bo np. przy S3 oznaczałoby
     to płatny zapis nawet dla plików usuniętych po chwili

3. **Skalowanie poziome wymaga**: (a) `FileIndex` na
   wspólny backend (np. Redis adapter), (b) hot
   storage też na wspólny backend (inaczej instancja B nie znajdzie u siebie
   pliku, który indeks każe jej szukać lokalnie), (c) lock/leader election dla
   crona archiwizacyjnego (bez tego dwie instancje zarchiwizują ten sam plik
   równolegle).

Skrypt wypełniający serwis plikami: `scripts/seed-files.sh`
