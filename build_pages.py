#!/usr/bin/env python3
"""生成 docs/ 静态版，用于 GitHub Pages。

静态版使用 web/storage.js 把数据存到浏览器的 IndexedDB，
不会上传任何数据；本机的 Python 版不受影响。
"""

import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"
DOCS = ROOT / "docs"
ASSETS = ("app.js", "styles.css", "storage.js")


def main():
    if DOCS.exists():
        shutil.rmtree(DOCS)
    DOCS.mkdir()
    (DOCS / "static").mkdir()

    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-mode="static">')
    (DOCS / "index.html").write_text(html, encoding="utf-8")

    for name in ASSETS:
        shutil.copy2(WEB / name, DOCS / "static" / name)

    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    print("已生成 docs/：静态版（数据保存在浏览器中）。")


if __name__ == "__main__":
    main()
