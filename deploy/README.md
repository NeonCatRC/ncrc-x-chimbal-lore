# Деплой — self-host на своём сервере

Сайт полностью статический (HTML + JSON + картинки). Бэкенд не нужен: счётчик
запросов (`js/requests.js`) бьёт в публичный Abacus API из браузера. Отдаём
одним nginx. React лежит локально, JSX предкомпилирован — сторонних CDN нет.

## Стек

- **nginx:1.27-alpine** — единственный сервис.
- Конфиг: [`nginx.conf`](nginx.conf) — gzip для текста, `immutable` кэш для
  картинок/шрифтов, ревалидация для HTML/JSON/JS, запрет dotfiles.

## Контент статей (важно)

Контент статей — `data/articles/<slug>/{index.html, images/, meta.json, …}` —
**не в git** (см. `.gitignore`): репозиторий хранит только приложение и стек
деплоя. В git остаются лишь индексы `data/articles.json`, `data/reviews.json`,
`data/articles/index.json`.

Перед сборкой образа разверните полную копию архива в `data/articles/` (rsync /
распаковка вашего бэкапа). Структура: `data/articles/<slug>/images/<file>`.
`docker compose build` упакует всё, что лежит в дереве, в образ.

## Фронтенд (предкомпиляция JSX)

Компоненты пишутся в `js/*.jsx`, в браузер уходит обычный JS из `js/build/`.
После правки `.jsx` пересоберите:

```bash
npm install        # один раз (babel-тулчейн, dev-зависимости)
npm run build      # js/*.jsx -> js/build/*.js
```

`js/build/` и `js/vendor/` (локальный React) коммитятся — на сервере сборка не
нужна, nginx отдаёт готовое.

## Запуск (прод, самодостаточный образ)

```bash
cd deploy
docker compose up -d --build      # http://<host>:8080
```

Образ включает картинки (~3 ГБ при полном архиве). Собирайте там, где контент уже
развёрнут, или пушьте образ в свой registry.

## Запуск (dev / без сборки, bind-mount)

Без большого образа — монтируем рабочее дерево напрямую (dotfiles закрыты в конфиге):

```bash
docker run --rm -p 8080:80 \
  -v "$PWD/..":/usr/share/nginx/html:ro \
  -v "$PWD/nginx.conf":/etc/nginx/conf.d/default.conf:ro \
  nginx:1.27-alpine
```

## TLS / домен

Контейнер слушает только HTTP:80. TLS вешайте обратным прокси на хосте
(Caddy/Traefik/nginx) — он терминирует HTTPS и проксирует на `:8080`. Включите
там HTTP/2.
