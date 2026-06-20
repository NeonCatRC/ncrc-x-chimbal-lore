# Статический архив на nginx. Контекст сборки = корень репозитория:
#   docker compose -f deploy/docker-compose.yml up -d --build
FROM nginx:1.27-alpine

# Конфиг сервера.
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Только приложение (index.html, css, js, assets/fonts). Контент (data/) НЕ
# зашивается — он монтируется томом в рантайме. .dockerignore держит data/, .git,
# page_raw.html, .done, jsx-исходники и доки вне образа.
COPY . /usr/share/nginx/html

# Убираем служебные файлы, попавшие в веб-корень широким COPY.
RUN rm -rf /usr/share/nginx/html/deploy \
           /usr/share/nginx/html/.dockerignore

EXPOSE 80
