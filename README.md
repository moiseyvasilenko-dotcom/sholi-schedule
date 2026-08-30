# Молодёжка · Темы

Простая страница для молодёжной группы: список тем, каждый может взять тему,
вписать своё имя и дату. Все видят одно и то же.

- Сайт: https://moiseyvasilenko-dotcom.github.io/sholi-schedule/
- Данные: textdb.dev, ключ `sholi-schedule-x9k2` (файл `app.js`)
- Бэкенда нет: страница читает и пишет JSON напрямую в textdb.dev

## Локальный запуск

```
python3 -m http.server 8091
# открыть http://localhost:8091/
```

## Сброс данных

```
curl -X POST "https://textdb.dev/api/data/sholi-schedule-x9k2" \
  -H "Content-Type: text/plain" --data-raw '{"topics":[]}'
```

## Структура

- `index.html` — разметка
- `styles.css` — стили
- `app.js` — логика (чтение/запись стора, CRUD тем)
- `sw.js` + `manifest.webmanifest` + `icons/` — PWA-обвязка