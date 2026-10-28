#!/usr/bin/env python3
"""Собирает index.html для локального просмотра: основной блок + блок эффектов,
обёрнутые так же, как их оборачивает Tilda (T123 внутри #allrecords).

Запуск из корня репозитория:  python3 tools/build-preview.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
main = (ROOT / "tilda" / "01-main-block.html").read_text(encoding="utf-8")
fx = (ROOT / "tilda" / "02-fx-block.html").read_text(encoding="utf-8")


def t123(code: str, rec: str) -> str:
    return (f'<div id="{rec}" class="r t-rec"><div class="t123"><div class="t-container_100">'
            f'<div class="t-width t-width_100">\n{code}\n</div></div></div></div>')


page = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OnAir — превью с эффектами</title>
<meta name="robots" content="noindex" />
<style>body{{margin:0}}</style>
</head>
<body class="t-body">
<!-- Превью собрано скриптом tools/build-preview.py. На Tilda вставляются только файлы из папки tilda/. -->
<div id="allrecords" class="t-records">
{t123(main, "rec-main")}
{t123(fx, "rec-fx")}
</div>
</body>
</html>
"""
(ROOT / "index.html").write_text(page, encoding="utf-8")
print("index.html собран:", len(page), "байт")
