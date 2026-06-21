# Деплой — self-host на своём сервере

Сайт статический (HTML + JSON + картинки). React локально, JSX предкомпилирован —
сторонних CDN нет. Чтение — один nginx. Запись правок (комментарии/разборы) —
отдельный admin-api только на 127.0.0.1.

## Тома и образы

| что | где | монтаж |
|-----|-----|--------|
| приложение | образ `web` (nginx) | — |
| контент архива | `CONTENT_DIR` | web: `/…/html/data` **:ro** |
| слой правок | `OVERLAY_DIR` | web: `/…/html/overlay` **:ro**; admin-api: `/overlay` **:rw** |

Контент и overlay в образ НЕ зашиваются (`.dockerignore`). Пересборка приложения
не трогает гигабайты картинок.

```
/usr/share/nginx/html/
├── index.html  css/  js/  assets/      ← образ web
├── data/                               ← CONTENT_DIR (:ro)
│   ├── articles.json
│   └── articles/<slug>/{index.html, images/, meta.json}
└── overlay/                            ← OVERLAY_DIR (:ro для web)
    ├── reviews.json
    └── annotations/<id>.json
```

## Почему так (защита от случайного редактирования)

- `web` монтирует контент и overlay **только :ro** — веб-сервер физически не
  может ничего изменить.
- Единственный, кто пишет, — `admin-api`, и он монтирует **только overlay :rw**
  (контент ему недоступен вообще). Слушает 127.0.0.1, доступ по SSH-туннелю.
- Контент-архив неизменяем; меняется лишь overlay и лишь через admin-api.

## Запуск

```bash
cd deploy
# прод: контент и overlay — постоянные каталоги хоста
CONTENT_DIR=/srv/chimbal/data OVERLAY_DIR=/srv/chimbal/overlay \
  docker compose up -d --build                       # сайт на :8080 (read-only)
# редактирование (по необходимости): поднять admin-api на 127.0.0.1:8090
CONTENT_DIR=… OVERLAY_DIR=… docker compose --profile admin up -d --build admin-api
```

dev без переменных → берутся `../data` и `../overlay` репозитория.

## Комментарии и разборы (admin-api)

В режиме редактора кнопки «💾 Сохранить» шлют POST на admin-api → пишет
`overlay/annotations/<id>.json` и `overlay/reviews.json`. Если admin-api недоступен —
фолбэк: «↓ Экспорт» (скачать) и «↑ Импорт» (загрузить обратно). Правишь удалённо:

```bash
ssh -L 8080:localhost:8080 -L 8090:localhost:8090 user@server
# сайт localhost:8080; сохранение уходит на localhost:8090 (admin-api)
```

Подробнее: [../admin-api/README.md](../admin-api/README.md). Токен — env `ADMIN_TOKEN`.

## Миграция на overlay (один раз)

Если правки лежали внутри папок статей (старый формат) — перенести:

```bash
python deploy/migrate-overlay.py CONTENT_DIR OVERLAY_DIR
# data/articles/<id>_*/annotations.json -> overlay/annotations/<id>.json
# data/reviews.json                     -> overlay/reviews.json
```

## Экспортёр статей (наполнение контента)

Контейнер `updater` тянет новые посты overclockers.ru в тот же том контента
(`:rw`) и обновляет `articles.json`. web читает том `:ro` вживую — перезапуск не
нужен. Контракт — [../docs/exporter-spec.md](../docs/exporter-spec.md), реализация —
репозиторий overclockers-exporter. Образ `overclockers-content-exporter:latest`
собирается из того репозитория (по его Dockerfile/инструкции), затем:

```bash
# профиль updater (не стартует при обычном up):
CONTENT_DIR=/srv/chimbal/data docker compose --profile updater up -d updater
```

Перед боевым запуском — сухой прогон: `DRY_RUN=1 RUN_ONCE=1` (скан без записи).
Проверено: вывод экспортёра отдаётся web 1:1 (структура, `articles.json`,
сжатие ≤1000px). Пишет атомарно, права 0644, идемпотентно, overlay не трогает.

## Фронтенд (предкомпиляция JSX)

```bash
npm install        # один раз
npm run build      # js/*.jsx -> js/build/*.js (коммитится)
```

## TLS / домен

Контейнер `web` слушает HTTP:80. TLS — обратным прокси на хосте
(Caddy/Traefik/nginx), HTTP/2 там же. admin-api за прокси НЕ выставлять.
