# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Język komunikacji

Odpowiadaj **po polsku**. Projekt, komentarze i logi są po polsku (firma Nautil Sp. z o.o.).

## Czym jest ten projekt

`display-gallery` to **strona wyświetlająca (read side)** systemu galerii zdjęć Nautil. Składa się z dwóch części w jednym repo:

1. **Backend (`index.js`)** — scentralizowany serwer **Express** działający jako **proxy tylko-do-odczytu** do Google Drive. Jeden serwer obsługuje wiele stron klientów (multi-tenant przez `galleries.config.json`). Rozwiązuje problem blokowania obrazów/wideo z Drive przez przeglądarki (third-party cookies, hotlinking) — wszystko leci przez własne endpointy proxy.
2. **Frontend (`masonry_frontend.js` + `lighthouse.css` + `index.html`)** — uniwersalny "silnik galerii" (vanilla JS), który **wkleja się do stron WordPress klientów przez Code Snippets**. Renderuje albumy i media pobrane z backendu.

To jedna z **dwóch aplikacji** systemu galerii. **Tu się dane tylko WYŚWIETLA; tworzy i edytuje je `galeria-app`** (panel Next.js, `D:\Projekty\galeria-app`).

## System dwóch aplikacji (kluczowy kontekst)

| Aplikacja | Rola | Dostęp do Drive | Repo |
|-----------|------|-----------------|------|
| **`galeria-app`** | Panel — **zapis i edycja** albumów przez klientów | Service Account z domain-wide delegation, scope **pełny `drive`** | `D:\Projekty\galeria-app` |
| **`display-gallery`** (to repo) | API proxy + frontend w WordPressie — **tylko odczyt** | Service Account, scope **`drive.readonly`**, bez impersonacji | `D:\Projekty\display-gallery` |

Obie używają **tego samego `google-credentials.json`** i tej samej struktury Drive: master folder **`Galeria Klientów`** → foldery klientów (`Parafia`, `Muzeum`, `A11y`, `Aktywne`) → foldery-albumy (`YYYY-MM-DD <tytuł>`) → pliki mediów. **Nie ma między nimi API ani wspólnej bazy — integracja jest wyłącznie przez konwencję nazewnictwa plików na Drive** (patrz "Kontrakt nazewnictwa").

## Stack

- **Node.js + Express 4**, **googleapis 150** (Drive API v3), **cors**, **dotenv**
- Frontend bez frameworka i bez build-stepu: **Masonry** (układ), **PhotoSwipe 4** (lightbox zdjęć), **imagesLoaded**; biblioteki ładowane z CDN w `index.html`
- **Brak bazy danych** — Google Drive jest źródłem danych

## Polecenia

```bash
npm start        # uruchamia serwer: node index.js (port z env PORT lub 3010)
```

`npm test` to placeholder (`exit 1`) — **testów nie ma**. Brak konfiguracji CI w repo.

### Wymagane pliki lokalne (oba gitignorowane — muszą istnieć na maszynie)

- **`google-credentials.json`** — klucz Service Account.
- **`.env`**:
  - `GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json` (googleapis czyta klucz z tej zmiennej automatycznie)
  - `MASTER_GALLERY_FOLDER_ID` — ID master folderu `Galeria Klientów` na Drive
  - opcjonalnie `PORT`

## Architektura

### Backend (`index.js`) — proxy multi-tenant

- **Konfiguracja klientów: [galleries.config.json](galleries.config.json)** wczytywany na starcie (krytyczny — brak pliku = `process.exit(1)`). Mapuje `galleryId → { clientFolderName, allowedOrigin }`. Przykład: `"kultura": { "clientFolderName": "Muzeum", "allowedOrigin": "https://kulturakosakowo.pl" }`.
- **Middleware `loadGalleryConfig`** — z `:galleryId` w URL wyciąga config albo zwraca 404.
- **CORS dynamiczny** — dozwolone są tylko `allowedOrigin` z configu (plus żądania bez origin).
- **Autoryzacja** — Service Account, scope **`drive.readonly`**, **bez impersonacji** (zwykłe `GoogleAuth`, klucz z `GOOGLE_APPLICATION_CREDENTIALS`).

Endpointy (wszystkie pod `:galleryId`, przez `loadGalleryConfig`):

| Endpoint | Opis |
|----------|------|
| `GET /` | Health check |
| `GET /api/:galleryId/folders` | Znajduje folder klienta (`clientFolderName`) pod `MASTER_GALLERY_FOLDER_ID` → listuje albumy; dla każdego liczy okładkę (plik z `_cover`, inaczej pierwszy) i thumbnail `=w400`. Sortowane malejąco po nazwie (najnowsze daty pierwsze) |
| `GET /api/:galleryId/folder/:folderId` | Listuje media (zdjęcia+wideo) w albumie. Zwraca `{ media: [{id, filename, type, thumbnailUrl, width, height}] }` |
| `GET /api/:galleryId/image/:fileId` | **Proxy obrazka** — strumień pliku Drive jako `image/jpeg` |
| `GET /api/:galleryId/video/:fileId` | **Proxy wideo** z obsługą HTTP **Range** (206 Partial Content) — pozwala na seekowanie w odtwarzaczu |

**Kolejność wyświetlania mediów (`/folder/:folderId`)** — sortowanie w 3 krokach (to celowa, "kuratorska" kolejność, lustro konwencji z `galeria-app`):
1. plik z **`_cover`** w nazwie → na samym początku,
2. pliki z **`(n)`** w nazwie → numerycznie rosnąco,
3. reszta → alfabetycznie.

### Frontend (osadzany w WordPressie przez Code Snippets)

- **`index.html`** — same tagi `<link>`/`<script>` do CDN (PhotoSwipe 4, Masonry, imagesLoaded, lightGallery). *Uwaga:* biblioteki **lightGallery** są tu jeszcze ładowane, ale obecny `masonry_frontend.js` ich **nie używa** (wideo obsługuje własnym modalem — patrz niżej).
- **`masonry_frontend.js`** — silnik galerii. **Konfiguracja per strona klienta na samej górze pliku** (jedyne, co się zmienia przy wdrożeniu na nowej stronie):
  - `GALLERY_ID` — ID galerii z `galleries.config.json`
  - `API_BASE_URL` — adres backendu (prod: `https://galeria-api.nautil2.hekko24.pl`)
  - `SHOW_DATES_IN_ALBUM_TITLES` — czy pokazywać prefiks daty `YYYY-MM-DD` w tytule albumu
  - `GALLERY_LAYOUT_STYLE` — `'default'` lub `'large-tiles'`
- **`lighthouse.css`** — style galerii + dwa układy kafelków (`.gallery.default`, `.gallery.large-tiles`), spinner, przycisk "Powrót".
- **Przepływ:** `loadAlbums()` → siatka okładek albumów → klik → `loadPhotos(albumId)` → inicjalizacja **Masonry** + **PhotoSwipe** dla zdjęć + **własny modal `<video>`** dla filmów. Pełne URL-e do mediów budowane na froncie z `API_BASE_URL` + endpointy proxy.

### Podział odpowiedzialności (ważna konwencja — utrzymuj)

- **Backend** robi CAŁĄ logikę biznesową: autoryzacja, znajdowanie folderów, wybór okładki, **sortowanie/kolejność**, filtrowanie mediów, streaming z Range.
- **Frontend** TYLKO renderuje gotowy obiekt `media` i inicjalizuje biblioteki wizualne (Masonry/PhotoSwipe/modal).

Nie przenoś logiki sortowania/filtrowania na front. Nowe reguły kolejności czy doboru plików → do `index.js`.

### Kontrakt nazewnictwa plików (wspólny z `galeria-app`)

Backend czyta stan z nazw plików/folderów ustawianych przez panel `galeria-app`:
- **`_cover`** → okładka albumu,
- **`(n)`** → kolejność (sort numeryczny),
- prefiks **`YYYY-MM-DD `** w nazwie folderu → data albumu (front może ją ukryć przez `SHOW_DATES_IN_ALBUM_TITLES`).

(Sufiks `_compressed` ustawia `galeria-app`; backend go nie interpretuje — pokazuje wszystkie pliki obrazów/wideo.)

## Pułapki i konwencje

- **`galleries.config.json` ↔ `galeria-app`:** wartości `clientFolderName` muszą się zgadzać z nazwami folderów na Drive ORAZ z `clientFolderMapping` w `galeria-app/src/lib/permissions.ts`. **Dodanie/zmiana klienta = edycja obu repo.**
- **`MASTER_GALLERY_FOLDER_ID`** wskazuje ten sam master folder `Galeria Klientów`, który `galeria-app` znajduje po nazwie.
- Thumbnaile Drive skalowane podmianą w URL: `.replace(/=s\d+$/, '=w400')`.
- Proxy obrazka ma **na sztywno `Content-Type: image/jpeg`** (działa też dla innych formatów rasterowych, ale nagłówek jest stały).
- **Rozbieżność ze starszym podsumowaniem (Gemini):** opisuje ono lightGallery do wideo — obecny kod używa **własnego modala**, nie lightGallery. Źródłem prawdy jest kod, nie tamto podsumowanie.
- **Commity:** krótkie polskie wiadomości w stylu repo (np. `naprawa wyswietlania galeria na firefox`, `dodanie sortowania po numerze`). Bez Conventional Commits.

## Deployment

Backend to długo żyjący proces Express, **deployowany ręcznie przez `pm2`** (bez CI/CD). Stoi na **tym samym firmowym VPS Nautil co `galeria-app`**. Dostępny produkcyjnie pod `https://galeria-api.nautil2.hekko24.pl` (ten adres jest wpisany jako `API_BASE_URL` we froncie). Frontend (`masonry_frontend.js` + `lighthouse.css` + zawartość `index.html`) wkleja się ręcznie do **WordPress Code Snippets** na stronie danego klienta i ustawia `GALLERY_ID` / `GALLERY_LAYOUT_STYLE` na górze JS.

> Do uzupełnienia (dopytaj Bartka): nazwa procesu w pm2, ścieżka na serwerze, jak `nautil2.hekko24.pl` mapuje się na proces (reverse proxy / port).
