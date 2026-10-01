# TOTK Explorer v3 — финальная сборка исходников

Цель: Nintendo Switch + Atmosphère + Tesla, The Legend of Zelda: Tears of the Kingdom.

Целевая версия:
- Game version: `1.4.3`
- Title ID: `0100F2C0115B6000`
- Build ID: `277178B7DBA1B6D4`

## Что реализовано

- Tesla overlay на libtesla.
- Подключение к Atmosphère `dmnt:cht`.
- Автоматическое обнаружение процесса TOTK.
- Сканирование heap памяти по тройкам `float`.
- Двухэтапная калибровка координат:
  1. запускается скан;
  2. игрок проходит заметное расстояние и нажимает X;
  3. игрок прыгает/меняет высоту и снова нажимает X.
- Кандидат получает баллы за горизонтальное и вертикальное движение.
- Найденный профиль сохраняется на SD.
- После повторного запуска overlay пытается загрузить сохранённый профиль.
- Live X/Y/Z после нахождения профиля.
- Грубое определение слоя Sky / Surface / Depths по Y.
- Динамическая локальная карта вокруг игрока.
- Nearby с расстоянием до объектов из `points.csv`.
- Диагностика Title ID / PID / heap / количества map points.
- Memory writes отключены.

## Честные ограничения

Это не «магический» гарантированный memory scanner: общий поиск `float,float,float` в памяти любой игры имеет ложные совпадения. Код использует несколько снимков, но первый найденный кандидат всё ещё требует проверки на реальной консоли.

Полная база всех 152 Shrine / 1000 Korok / 120 Lightroot не зашита в `.ovl`. Она вынесена в `points.csv`, чтобы база данных могла обновляться отдельно от бинарника. В текущем пакете `points.csv` пустой и служит шаблоном формата.

## Сборка через GitHub Actions

Этот репозиторий уже содержит `.github/workflows/build.yml`.

1. Загрузите все файлы проекта в репозиторий.
2. Откройте GitHub → Actions.
3. Выберите `Build TOTK Explorer v3`.
4. Нажмите `Run workflow`.
5. После зелёной сборки скачайте artifact `TOTK-Explorer-v3`.

В artifact будет:

```text
sd/
└── switch/
    ├── .overlays/
    │   └── TOTK-Explorer-v3.ovl
    └── totk_explorer/
        └── points.csv
```

Всю папку `sd` можно скопировать в корень SD-карты.

## Локальная сборка

Нужен devkitPro + devkitA64 + libnx.

```bash
make setup
make -j2
```

## Управление

Главное меню:
- A — открыть раздел.
- B — назад/закрыть overlay.

Auto Discovery:
- A на `Start / Restart Scan` — начать поиск.
- После окончания первого scan пройтись с Link.
- X — отфильтровать движущиеся кандидаты.
- Прыгнуть/изменить высоту.
- X — второй фильтр и выбор кандидата.
- Y — начать новую калибровку.

## Установка

```text
sd:/switch/.overlays/TOTK-Explorer-v3.ovl
sd:/switch/totk_explorer/points.csv
```

## Использованные открытые компоненты

- libtesla — Tesla overlay support.
- Atmosphère `dmnt:cht` — process metadata/memory access.
- `libdmntcht.a` для Switch — из открытого репозитория Shiny-Stash-Live-Map.

Все сторонние компоненты остаются под своими исходными лицензиями; см. их LICENSE/README.
