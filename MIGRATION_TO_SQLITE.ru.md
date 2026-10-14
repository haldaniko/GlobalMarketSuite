# GlobalMarketSuite: перенос production на SQLite

Старая production-база находится в PostgreSQL Docker volume. Статические обложки лежат в `frontend/public/covers/`, а загруженные изображения — в отдельном Docker volume `globalmarketsuite_globalmarketsuite_prod_uploads` и используются по адресам `/uploads/covers/...`. Новая версия переносит записи PostgreSQL в `db.sqlite3`, а оба источника изображений — в `media/` **в корне проекта на Linux-хосте**. Frontend обслуживает `/covers/...` и `/uploads/...` из этой папки.

## Первый переход на сервере

Выполняйте команды из старого каталога проекта **до обновления кода**. Узнайте прежнее имя Compose project:

```bash
docker compose ls
export PROJECT=ИМЯ_ПРОЕКТА_ИЗ_ВЫВОДА
docker volume inspect "${PROJECT}_globalmarketsuite_prod_postgres_data" >/dev/null
docker volume inspect "${PROJECT}_globalmarketsuite_prod_uploads" >/dev/null
```

Если volume не найден, остановитесь и выясните правильное имя проекта. Используйте тот же `PROJECT` в командах резервного копирования старой конфигурации.

Новая конфигурация закрепляет имя Compose-проекта `globalmarketsuite` и подключает оба старых volume как внешние. Если прежнее имя проекта отличается от `globalmarketsuite`, **до запуска новой конфигурации** исправьте строку `name:` в начале `docker-compose.prod.yml` и значения `name` у обоих volumes. При ошибке в имени Compose остановится, не создав пустые volumes.

Остановите старые веб-контейнеры, чтобы во время резервного копирования не было новых записей:

```bash
docker compose -p "$PROJECT" --env-file .env.production -f docker-compose.prod.yml stop backend frontend
```

Сохраните PostgreSQL и текущие обложки отдельно от проекта:

```bash
export BACKUP_DIR="$HOME/globalmarketsuite-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
docker compose -p "$PROJECT" --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/postgres.dump"
docker compose -p "$PROJECT" --env-file .env.production -f docker-compose.prod.yml cp frontend:/app/dist/covers "$BACKUP_DIR/covers"
docker run --rm -v "${PROJECT}_globalmarketsuite_prod_uploads:/source:ro" -v "$BACKUP_DIR:/backup" alpine sh -c 'cd /source && tar -cf /backup/uploads.tar .'
test -s "$BACKUP_DIR/postgres.dump" && test -d "$BACKUP_DIR/covers" && test -s "$BACKUP_DIR/uploads.tar"
```

После этого разверните обновлённый код. Сохраните существующие `.env.production` и `backend/.env.production`. Проверьте, что в корне проекта нет случайного `db.sqlite3`: при наличии этого файла импорт PostgreSQL пропускается. Если изображения внутри старого frontend-контейнера были изменены вручную и отличаются от файлов `frontend/public/covers/`, сначала восстановите нужные изображения из резервной копии в исходный каталог или в `media/covers/`.

Запустите обычный production Compose из корня проекта:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Сервис `import-legacy-data` сначала прочитает все шесть таблиц старой базы, проверит количество строк и целостность SQLite, скопирует статические и загруженные изображения и проверит пути `/covers/...` и `/uploads/...` из статей. Только после его успешного завершения запустится backend. Готовый файл `db.sqlite3` появляется после завершения проверок; старые volumes не удаляются. При повторном запуске база не импортируется заново, а отсутствующие изображения добавляются в `media/` без перезаписи существующих файлов.

Проверьте результат:

```bash
docker compose -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.prod.yml logs --tail=100 import-legacy-data backend
test -s db.sqlite3 && test -d media/covers
find media -type f | wc -l
curl -f http://127.0.0.1:4100/api/health
curl -f http://127.0.0.1:4100/api/posts
curl -I http://127.0.0.1:8095/covers/market-map.svg
```

Проверьте статьи, вход администратора и изображения на сайте. При ошибке импорта backend не должен стартовать. Посмотрите `logs import-legacy-data`; не удаляйте старый PostgreSQL volume. Если ошибка сообщает `password authentication failed`, пароль пользователя внутри существующего PostgreSQL volume не совпадает с `POSTGRES_PASSWORD` в `.env.production`. Не меняйте пароль наугад: сначала проверьте старую базу через локальный `psql` и резервную копию. Если остался `.db.sqlite3.importing`, осмотрите его и удалите **только временный файл** перед повтором.

Если перед сайтом стоит Nginx, его `api.globalmarketsuite.com` должен вести на `127.0.0.1:4100`, а `globalmarketsuite.com` — на `127.0.0.1:8095`. Обложки `/covers/` и `/uploads/covers/` отдаёт frontend с хостовой папки `media/covers/`.

Если `db.sqlite3` уже появился, а `/uploads/covers/...` ещё отсутствуют, обновите код и повторите `docker compose -f docker-compose.prod.yml up --build -d`. Импортёр сохранит существующий SQLite-файл и синхронизирует недостающие изображения из старого uploads volume.

## Следующие обновления и резервные копии

Для последующих обновлений используйте ту же команду:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Backend после импорта читает и пишет только `db.sqlite3` на хосте. Frontend читает `media/covers/` на хосте. PostgreSQL и uploads volumes остаются в Compose как источники для импортёра, но backend больше к ним не обращается.

Для последующих резервных копий сохраняйте `db.sqlite3` и `media/` вместе. При активных записях делайте снимок через SQLite backup API или кратко останавливайте backend перед копированием файла. Не запускайте `docker compose down -v`, пока не проверены данные и резервные копии.
