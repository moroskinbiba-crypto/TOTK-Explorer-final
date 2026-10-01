# TOTK Explorer v3.0.1

Tesla overlay for **The Legend of Zelda: Tears of the Kingdom 1.4.3**.

Target:
- Title ID: `0100F2C0115B6000`
- Build ID: `277178B7DBA1B6D4`
- Atmosphère + Tesla

## Что исправлено

Эта версия использует стабильную схему сборки Tesla Template с фиксированным корнем проекта, поэтому `include/explorer.hpp` не теряется при рекурсивной сборке `build/`.

`data/points.csv` не участвует в компиляции; он копируется в SD-пакет отдельно.

## Возможности

- Tesla overlay.
- Подключение к Atmosphère `dmnt:cht`.
- Auto Discovery кандидатов X/Y/Z в heap.
- Калибровка движением и изменением высоты.
- Сохранение найденного профиля.
- Live X/Y/Z после обнаружения.
- Dynamic local map по `points.csv`.
- Nearby с расчётом расстояния.
- Только чтение памяти; записи в игру нет.

## Сборка

В GitHub Actions workflow уже есть автоматическая сборка через `devkitpro/devkita64`.

После зелёной сборки скачай artifact `TOTK-Explorer-v3`.

SD layout:

```text
sd:/switch/.overlays/TOTK-Explorer-v3.ovl
sd:/switch/totk_explorer/points.csv
```

## Auto Discovery

Открой:

`Tesla -> TOTK EXPLORER -> Auto Discovery -> Start / Restart Scan`

После окончания первого сканирования:

1. выйди в игру и пройди несколько метров;
2. снова открой overlay;
3. на экране Auto Discovery нажми **X**;
4. затем подпрыгни/измени высоту;
5. снова нажми **X**.

Это эвристический RAM scan. Он не гарантирует правильный кандидат на каждой сборке, поэтому результат отображается только после успешной фильтрации.

## Важно

`points.csv` в поставляемом проекте содержит только заголовок. Я намеренно не вставляю непроверенные координаты Shrine/Korok/Lightroot.
