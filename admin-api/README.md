# admin-api — запись overlay (комментарии / разборы)

Крошечный HTTP-сервис на stdlib (без зависимостей). Пишет **только** в overlay
(`:rw`); контент-архив остаётся `:ro`. Слушает 127.0.0.1 на хосте, доступ — через
SSH-туннель. Публично НЕ выставлять.

## Эндпоинты

| метод | путь | тело | результат |
|-------|------|------|-----------|
| GET   | `/health` | — | `{"ok":true}` |
| POST  | `/annotations/<id>` | JSON-массив | `overlay/annotations/<id>.json` |
| POST  | `/reviews` | JSON-объект | `overlay/reviews.json` |
| POST  | `/tags` | JSON-объект `{id:[теги]}` | `overlay/tags.json` |

`<id>` — только цифры (защита от path traversal). Тело ≤ 5 МБ.

## Переменные окружения

- `OVERLAY_DIR` (по умолч. `/overlay`) — каталог записи.
- `PORT` (8090).
- `ADMIN_TOKEN` — если задан, требуется заголовок `Authorization: Bearer <token>`.
- `ALLOW_ORIGIN` — CORS Origin (по умолч. `*`; сервис всё равно на 127.0.0.1).

## Запуск

```bash
cd deploy
docker compose --profile admin up -d --build admin-api   # 127.0.0.1:8090
```

Правишь с другой машины — туннель:

```bash
ssh -L 8080:localhost:8080 -L 8090:localhost:8090 user@server
# сайт: localhost:8080, сохранение правок уходит на localhost:8090
```

Если сервис не запущен — в UI работает фолбэк: экспорт/импорт json вручную.
