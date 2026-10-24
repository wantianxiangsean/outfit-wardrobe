#!/usr/bin/env python3
"""衣橱 · 本地穿搭管理服务（仅使用 Python 标准库）"""

import argparse
import base64
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATA_DIR = os.path.join(BASE_DIR, "data")
IMG_DIR = os.path.join(DATA_DIR, "images")
DB_PATH = os.path.join(DATA_DIR, "outfit.db")

CATEGORIES = ["outerwear", "top", "bottom", "shoes", "accessory"]
CATEGORY_SET = set(CATEGORIES)
SLEEVES = ["short", "long"]
SLEEVE_SET = set(SLEEVES)
MAX_BODY = 200 * 1024 * 1024
MAX_IMAGE_BYTES = 12 * 1024 * 1024

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    os.makedirs(IMG_DIR, exist_ok=True)
    conn = get_db()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                category   TEXT NOT NULL,
                color      TEXT NOT NULL DEFAULT '',
                seasons    TEXT NOT NULL DEFAULT '',
                sleeve     TEXT NOT NULL DEFAULT '',
                tags       TEXT NOT NULL DEFAULT '',
                image      TEXT NOT NULL DEFAULT '',
                notes      TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS outfits (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                occasion   TEXT NOT NULL DEFAULT '',
                notes      TEXT NOT NULL DEFAULT '',
                kind       TEXT NOT NULL DEFAULT 'own',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS outfit_items (
                outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
                item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                position  INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (outfit_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS outfit_images (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                outfit_id  INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
                image      TEXT NOT NULL,
                position   INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_outfit_items_item ON outfit_items(item_id);
            CREATE INDEX IF NOT EXISTS idx_outfit_images_outfit ON outfit_images(outfit_id);
            """
        )
        columns = [r["name"] for r in conn.execute("PRAGMA table_info(items)")]
        if "sleeve" not in columns:
            conn.execute("ALTER TABLE items ADD COLUMN sleeve TEXT NOT NULL DEFAULT ''")
        outfit_columns = [r["name"] for r in conn.execute("PRAGMA table_info(outfits)")]
        if "kind" not in outfit_columns:
            conn.execute("ALTER TABLE outfits ADD COLUMN kind TEXT NOT NULL DEFAULT 'own'")
        conn.commit()
    finally:
        conn.close()


def row_to_item(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "color": row["color"],
        "seasons": row["seasons"],
        "sleeve": row["sleeve"],
        "tags": row["tags"],
        "image": row["image"],
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def decode_image(data_url):
    """把 data:image/...;base64,... 存成文件，返回 /images/xxx.jpg。"""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        raise ValueError("图片格式不正确")
    header, _, b64 = data_url.partition(",")
    if not header or not b64:
        raise ValueError("图片数据不完整")
    raw = base64.b64decode(b64, validate=False)
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("图片太大，请换一张")
    name = uuid.uuid4().hex + ".jpg"
    with open(os.path.join(IMG_DIR, name), "wb") as f:
        f.write(raw)
    return "/images/" + name


def remove_image(path):
    if not path or not path.startswith("/images/"):
        return
    name = os.path.basename(path)
    if not re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
        return
    try:
        os.remove(os.path.join(IMG_DIR, name))
    except OSError:
        pass


def image_to_data_url(path):
    name = os.path.basename(path) if path else ""
    if not name or not re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
        return ""
    full = os.path.join(IMG_DIR, name)
    if not os.path.isfile(full):
        return ""
    with open(full, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")


def clean(value, limit=200):
    return (value or "").strip()[:limit]


class Handler(BaseHTTPRequestHandler):
    server_version = "Wardrobe/1.0"

    # ---------- 基础响应 ----------
    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json({"error": message}, status)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("请求内容过大")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("请求内容不是有效的 JSON")

    def send_file(self, path, cache=False):
        if not os.path.isfile(path):
            self.send_error_json(404, "文件不存在")
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = STATIC_TYPES.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header(
            "Cache-Control", "public, max-age=31536000, immutable" if cache else "no-cache"
        )
        self.end_headers()
        self.wfile.write(data)

    # ---------- 路由 ----------
    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        try:
            if path.startswith("/api/"):
                self.handle_api(method, path, query)
            elif method == "GET":
                self.handle_static(path)
            else:
                self.send_error_json(405, "不支持的方法")
        except ValueError as exc:
            self.send_error_json(400, str(exc))
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write("处理请求出错: %r\n" % (exc,))
            try:
                self.send_error_json(500, "服务器内部错误")
            except OSError:
                pass

    def handle_static(self, path):
        if path == "/" or path == "/index.html":
            self.send_file(os.path.join(WEB_DIR, "index.html"))
            return
        if path.startswith("/static/"):
            target = os.path.realpath(os.path.join(WEB_DIR, path[len("/static/"):]))
            if not target.startswith(os.path.realpath(WEB_DIR) + os.sep):
                self.send_error_json(403, "无权访问")
                return
            self.send_file(target)
            return
        if path.startswith("/images/"):
            name = os.path.basename(path)
            if not re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
                self.send_error_json(404, "图片不存在")
                return
            self.send_file(os.path.join(IMG_DIR, name), cache=True)
            return
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        self.send_error_json(404, "页面不存在")

    # ---------- API ----------
    def handle_api(self, method, path, query):
        parts = [p for p in path.split("/") if p]
        # /api/<resource>/<id>
        resource = parts[1] if len(parts) > 1 else ""
        try:
            ident = int(parts[2]) if len(parts) > 2 else None
        except ValueError:
            raise ValueError("无效的编号")

        if resource == "items":
            if method == "GET" and ident is None:
                return self.list_items(query)
            if method == "GET":
                return self.get_item(ident)
            if method == "POST":
                return self.create_item()
            if method == "PUT":
                return self.update_item(ident)
            if method == "DELETE":
                return self.delete_item(ident)
        elif resource == "outfits":
            if method == "GET" and ident is None:
                return self.list_outfits(query)
            if method == "GET":
                return self.get_outfit(ident)
            if method == "POST":
                return self.create_outfit()
            if method == "PUT":
                return self.update_outfit(ident)
            if method == "DELETE":
                return self.delete_outfit(ident)
        elif resource == "backup" and method == "GET" and ident is None:
            return self.backup()
        elif resource == "restore" and method == "POST" and ident is None:
            return self.restore()
        elif resource == "stats" and method == "GET" and ident is None:
            return self.stats()
        self.send_error_json(404, "接口不存在")

    # ----- 单品 -----
    def list_items(self, query):
        category = (query.get("category") or [""])[0]
        keyword = (query.get("q") or [""])[0].strip()
        season = (query.get("season") or [""])[0].strip()
        sleeve = (query.get("sleeve") or [""])[0].strip()
        sql = "SELECT * FROM items WHERE 1=1"
        args = []
        if category in CATEGORY_SET:
            sql += " AND category = ?"
            args.append(category)
        if sleeve in SLEEVE_SET:
            sql += " AND sleeve = ?"
            args.append(sleeve)
        if keyword:
            like = "%" + keyword + "%"
            sql += " AND (name LIKE ? OR color LIKE ? OR tags LIKE ? OR notes LIKE ?)"
            args += [like, like, like, like]
        if season:
            sql += " AND seasons LIKE ?"
            args.append("%" + season + "%")
        sql += (
            " ORDER BY CASE category"
            " WHEN 'outerwear' THEN 0 WHEN 'top' THEN 1 WHEN 'bottom' THEN 2"
            " WHEN 'shoes' THEN 3 ELSE 4 END, id DESC"
        )
        conn = get_db()
        try:
            rows = conn.execute(sql, args).fetchall()
            items = [row_to_item(r) for r in rows]
            counts = {c: 0 for c in CATEGORIES}
            for r in conn.execute("SELECT category, COUNT(*) AS n FROM items GROUP BY category"):
                counts[r["category"]] = r["n"]
        finally:
            conn.close()
        self.send_json({"items": items, "counts": counts, "total": len(items)})

    def get_item(self, ident):
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.send_error_json(404, "单品不存在")
            item = row_to_item(row)
            outfits = conn.execute(
                """SELECT o.id, o.name, o.occasion FROM outfits o
                   JOIN outfit_items oi ON oi.outfit_id = o.id
                   WHERE oi.item_id = ? ORDER BY o.updated_at DESC""",
                (ident,),
            ).fetchall()
            item["outfits"] = [dict(o) for o in outfits]
        finally:
            conn.close()
        self.send_json(item)

    @staticmethod
    def item_fields(body):
        name = clean(body.get("name"), 80)
        category = (body.get("category") or "").strip()
        if not name:
            raise ValueError("请填写单品名称")
        if category not in CATEGORY_SET:
            raise ValueError("请选择正确的类别")
        sleeve = (body.get("sleeve") or "").strip()
        if sleeve not in SLEEVE_SET:
            sleeve = ""
        return {
            "name": name,
            "category": category,
            "color": clean(body.get("color"), 40),
            "seasons": clean(body.get("seasons"), 60),
            "sleeve": sleeve,
            "tags": clean(body.get("tags"), 120),
            "notes": clean(body.get("notes"), 1000),
        }

    def create_item(self):
        body = self.read_body()
        fields = self.item_fields(body)
        image = ""
        if body.get("image_data"):
            image = decode_image(body["image_data"])
        stamp = now()
        conn = get_db()
        try:
            cur = conn.execute(
                """INSERT INTO items (name, category, color, seasons, sleeve, tags, image, notes,
                                      created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    fields["name"], fields["category"], fields["color"], fields["seasons"],
                    fields["sleeve"], fields["tags"], image, fields["notes"], stamp, stamp,
                ),
            )
            conn.commit()
            new_id = cur.lastrowid
            row = conn.execute("SELECT * FROM items WHERE id = ?", (new_id,)).fetchone()
        finally:
            conn.close()
        self.send_json(row_to_item(row), 201)

    def update_item(self, ident):
        body = self.read_body()
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.send_error_json(404, "单品不存在")
            fields = self.item_fields(body)
            image = row["image"]
            old_image = image
            if body.get("image_data"):
                image = decode_image(body["image_data"])
            elif body.get("remove_image"):
                image = ""
            conn.execute(
                """UPDATE items SET name=?, category=?, color=?, seasons=?, sleeve=?, tags=?,
                                    image=?, notes=?, updated_at=? WHERE id=?""",
                (
                    fields["name"], fields["category"], fields["color"], fields["seasons"],
                    fields["sleeve"], fields["tags"], image, fields["notes"], now(), ident,
                ),
            )
            conn.commit()
            if old_image != image:
                remove_image(old_image)
            row = conn.execute("SELECT * FROM items WHERE id = ?", (ident,)).fetchone()
        finally:
            conn.close()
        self.send_json(row_to_item(row))

    def delete_item(self, ident):
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.send_error_json(404, "单品不存在")
            affected = conn.execute(
                "SELECT COUNT(DISTINCT outfit_id) AS n FROM outfit_items WHERE item_id = ?",
                (ident,),
            ).fetchone()["n"]
            conn.execute("DELETE FROM items WHERE id = ?", (ident,))
            conn.commit()
        finally:
            conn.close()
        remove_image(row["image"])
        self.send_json({"ok": True, "removed_from": affected})

    # ----- 搭配 -----
    def outfit_payload(self, conn, row):
        items = conn.execute(
            """SELECT i.* FROM items i JOIN outfit_items oi ON oi.item_id = i.id
               WHERE oi.outfit_id = ? ORDER BY oi.position, i.id""",
            (row["id"],),
        ).fetchall()
        items = [row_to_item(r) for r in items]
        images = [
            r["image"]
            for r in conn.execute(
                "SELECT image FROM outfit_images WHERE outfit_id = ? ORDER BY position, id",
                (row["id"],),
            )
        ]
        cover = {}
        for it in items:
            if it["category"] not in cover and it["image"]:
                cover[it["category"]] = it["image"]
        return {
            "id": row["id"],
            "name": row["name"],
            "occasion": row["occasion"],
            "notes": row["notes"],
            "kind": row["kind"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "items": items,
            "item_count": len(items),
            "cover": cover,
            "images": images,
        }

    def list_outfits(self, query):
        kind = (query.get("kind") or [""])[0]
        sql = "SELECT * FROM outfits"
        args = []
        if kind in ("own", "reference"):
            sql += " WHERE kind = ?"
            args.append(kind)
        sql += " ORDER BY updated_at DESC, id DESC"
        conn = get_db()
        try:
            rows = conn.execute(sql, args).fetchall()
            outfits = [self.outfit_payload(conn, r) for r in rows]
        finally:
            conn.close()
        self.send_json({"outfits": outfits})

    def get_outfit(self, ident):
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM outfits WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.send_error_json(404, "搭配不存在")
            payload = self.outfit_payload(conn, row)
        finally:
            conn.close()
        self.send_json(payload)

    @staticmethod
    def outfit_fields(body):
        name = clean(body.get("name"), 80)
        if not name:
            raise ValueError("请填写搭配名称")
        ids = body.get("items") or []
        if not isinstance(ids, list):
            raise ValueError("单品列表格式不正确")
        cleaned = []
        for value in ids:
            try:
                value = int(value)
            except (TypeError, ValueError):
                continue
            if value not in cleaned:
                cleaned.append(value)
        kind = body.get("kind") or "own"
        if kind not in ("own", "reference"):
            raise ValueError("搭配类型不正确")
        images = body.get("images") or []
        if not isinstance(images, list):
            raise ValueError("照片列表格式不正确")
        return (
            name,
            clean(body.get("occasion"), 40),
            clean(body.get("notes"), 1000),
            cleaned,
            kind,
            images,
        )

    def save_outfit_items(self, conn, outfit_id, item_ids):
        conn.execute("DELETE FROM outfit_items WHERE outfit_id = ?", (outfit_id,))
        for position, item_id in enumerate(item_ids):
            exists = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
            if not exists:
                raise ValueError("有单品已被删除，请刷新后重试")
            conn.execute(
                "INSERT INTO outfit_items (outfit_id, item_id, position) VALUES (?, ?, ?)",
                (outfit_id, item_id, position),
            )

    def save_outfit_images(self, conn, outfit_id, entries):
        conn.execute("DELETE FROM outfit_images WHERE outfit_id = ?", (outfit_id,))
        saved = []
        for entry in entries:
            if not isinstance(entry, str):
                continue
            if entry.startswith("data:image/"):
                saved.append(decode_image(entry))
                continue
            name = os.path.basename(entry)
            if (
                entry.startswith("/images/")
                and re.fullmatch(r"[0-9a-f]{32}\.jpg", name)
                and os.path.isfile(os.path.join(IMG_DIR, name))
            ):
                saved.append(entry)
        for position, path in enumerate(saved):
            conn.execute(
                "INSERT INTO outfit_images (outfit_id, image, position) VALUES (?, ?, ?)",
                (outfit_id, path, position),
            )
        return saved

    def create_outfit(self):
        body = self.read_body()
        name, occasion, notes, item_ids, kind, images = self.outfit_fields(body)
        if kind == "reference" and not images:
            raise ValueError("参考穿搭至少要放一张照片")
        stamp = now()
        conn = get_db()
        try:
            cur = conn.execute(
                """INSERT INTO outfits (name, occasion, notes, kind, created_at, updated_at)
                   VALUES (?,?,?,?,?,?)""",
                (name, occasion, notes, kind, stamp, stamp),
            )
            outfit_id = cur.lastrowid
            if kind == "own":
                self.save_outfit_items(conn, outfit_id, item_ids)
            else:
                self.save_outfit_images(conn, outfit_id, images)
            conn.commit()
            row = conn.execute("SELECT * FROM outfits WHERE id = ?", (outfit_id,)).fetchone()
            payload = self.outfit_payload(conn, row)
        finally:
            conn.close()
        self.send_json(payload, 201)

    def update_outfit(self, ident):
        body = self.read_body()
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM outfits WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.send_error_json(404, "搭配不存在")
            name, occasion, notes, item_ids, _kind, images = self.outfit_fields(body)
            kind = row["kind"]
            if kind == "reference" and not images:
                raise ValueError("参考穿搭至少要放一张照片")
            old_images = [
                r["image"]
                for r in conn.execute(
                    "SELECT image FROM outfit_images WHERE outfit_id = ?", (ident,)
                )
            ]
            conn.execute(
                "UPDATE outfits SET name=?, occasion=?, notes=?, updated_at=? WHERE id=?",
                (name, occasion, notes, now(), ident),
            )
            if kind == "own":
                self.save_outfit_items(conn, ident, item_ids)
            else:
                new_images = self.save_outfit_images(conn, ident, images)
                for path in old_images:
                    if path not in new_images:
                        remove_image(path)
            conn.commit()
            row = conn.execute("SELECT * FROM outfits WHERE id = ?", (ident,)).fetchone()
            payload = self.outfit_payload(conn, row)
        finally:
            conn.close()
        self.send_json(payload)

    def delete_outfit(self, ident):
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM outfits WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.send_error_json(404, "搭配不存在")
            images = [
                r["image"]
                for r in conn.execute(
                    "SELECT image FROM outfit_images WHERE outfit_id = ?", (ident,)
                )
            ]
            conn.execute("DELETE FROM outfits WHERE id = ?", (ident,))
            conn.commit()
        finally:
            conn.close()
        for path in images:
            remove_image(path)
        self.send_json({"ok": True})

    # ----- 备份 -----
    def stats(self):
        conn = get_db()
        try:
            items = conn.execute("SELECT COUNT(*) AS n FROM items").fetchone()["n"]
            outfits = conn.execute("SELECT COUNT(*) AS n FROM outfits").fetchone()["n"]
            own_outfits = conn.execute(
                "SELECT COUNT(*) AS n FROM outfits WHERE kind = 'own'"
            ).fetchone()["n"]
            reference_outfits = conn.execute(
                "SELECT COUNT(*) AS n FROM outfits WHERE kind = 'reference'"
            ).fetchone()["n"]
            counts = {c: 0 for c in CATEGORIES}
            for r in conn.execute("SELECT category, COUNT(*) AS n FROM items GROUP BY category"):
                counts[r["category"]] = r["n"]
        finally:
            conn.close()
        self.send_json(
            {
                "items": items,
                "outfits": outfits,
                "own_outfits": own_outfits,
                "reference_outfits": reference_outfits,
                "counts": counts,
            }
        )

    def backup(self):
        conn = get_db()
        try:
            items = [row_to_item(r) for r in conn.execute("SELECT * FROM items ORDER BY id")]
            outfits = []
            for r in conn.execute("SELECT * FROM outfits ORDER BY id"):
                item_ids = [
                    row["item_id"]
                    for row in conn.execute(
                        "SELECT item_id FROM outfit_items WHERE outfit_id = ? ORDER BY position",
                        (r["id"],),
                    )
                ]
                image_paths = [
                    row["image"]
                    for row in conn.execute(
                        "SELECT image FROM outfit_images WHERE outfit_id = ? ORDER BY position",
                        (r["id"],),
                    )
                ]
                outfits.append(
                    {
                        "name": r["name"],
                        "occasion": r["occasion"],
                        "notes": r["notes"],
                        "kind": r["kind"],
                        "created_at": r["created_at"],
                        "items": item_ids,
                        "images": image_paths,
                    }
                )
        finally:
            conn.close()

        for item in items:
            path = item.pop("image", "")
            item["image_data"] = image_to_data_url(path)
        for outfit in outfits:
            outfit["images"] = [image_to_data_url(p) for p in outfit["images"]]
            outfit["images"] = [p for p in outfit["images"] if p]

        payload = {
            "app": "outfit-wardrobe",
            "version": 1,
            "exported_at": now(),
            "items": items,
            "outfits": outfits,
        }
        self.send_json(payload)

    def restore(self):
        body = self.read_body()
        if body.get("app") != "outfit-wardrobe" or not isinstance(body.get("items"), list):
            raise ValueError("这不是本系统导出的备份文件")
        items = body["items"]
        outfits = body.get("outfits") or []
        conn = get_db()
        id_map = {}
        old_images = [
            r["image"] for r in conn.execute("SELECT image FROM items WHERE image != ''")
        ]
        old_images += [r["image"] for r in conn.execute("SELECT image FROM outfit_images")]
        try:
            conn.execute("DELETE FROM outfit_items")
            conn.execute("DELETE FROM outfit_images")
            conn.execute("DELETE FROM outfits")
            conn.execute("DELETE FROM items")
            stamp = now()
            for raw in items:
                name = clean(raw.get("name"), 80)
                category = raw.get("category")
                if not name or category not in CATEGORY_SET:
                    continue
                image = ""
                if raw.get("image_data"):
                    try:
                        image = decode_image(raw["image_data"])
                    except ValueError:
                        image = ""
                sleeve = raw.get("sleeve") if raw.get("sleeve") in SLEEVE_SET else ""
                cur = conn.execute(
                    """INSERT INTO items (name, category, color, seasons, sleeve, tags, image, notes,
                                          created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        name, category, clean(raw.get("color"), 40),
                        clean(raw.get("seasons"), 60), sleeve, clean(raw.get("tags"), 120),
                        image, clean(raw.get("notes"), 1000),
                        raw.get("created_at") or stamp, stamp,
                    ),
                )
                old_id = raw.get("id")
                if old_id is not None:
                    id_map[old_id] = cur.lastrowid
            for raw in outfits:
                name = clean(raw.get("name"), 80)
                if not name:
                    continue
                kind = raw.get("kind") if raw.get("kind") in ("own", "reference") else "own"
                cur = conn.execute(
                    """INSERT INTO outfits (name, occasion, notes, kind, created_at, updated_at)
                       VALUES (?,?,?,?,?,?)""",
                    (
                        name, clean(raw.get("occasion"), 40), clean(raw.get("notes"), 1000),
                        kind, raw.get("created_at") or stamp, stamp,
                    ),
                )
                outfit_id = cur.lastrowid
                if kind == "reference":
                    position = 0
                    for entry in raw.get("images") or []:
                        if not isinstance(entry, str) or not entry.startswith("data:image/"):
                            continue
                        try:
                            path = decode_image(entry)
                        except ValueError:
                            continue
                        conn.execute(
                            "INSERT INTO outfit_images (outfit_id, image, position) VALUES (?,?,?)",
                            (outfit_id, path, position),
                        )
                        position += 1
                    continue
                position = 0
                for old_item_id in raw.get("items") or []:
                    new_id = id_map.get(old_item_id)
                    if new_id is None:
                        continue
                    conn.execute(
                        "INSERT OR IGNORE INTO outfit_items (outfit_id, item_id, position) VALUES (?,?,?)",
                        (outfit_id, new_id, position),
                    )
                    position += 1
            conn.commit()
        finally:
            conn.close()
        for image in old_images:
            remove_image(image)
        self.send_json({"ok": True, "items": len(id_map), "outfits": len(outfits)})


class WardrobeServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 上 SO_REUSEADDR 会允许两个进程抢同一端口，关掉才能正确检测占用
    allow_reuse_address = os.name != "nt"


def lan_addresses():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        ips.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    return sorted(ips)


def main():
    parser = argparse.ArgumentParser(description="衣橱 · 本地穿搭管理")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="监听地址；默认允许同一 Wi-Fi 下的手机 / 平板访问",
    )
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    init_db()

    server = None
    port = args.port
    for _ in range(20):
        try:
            server = WardrobeServer((args.host, port), Handler)
            break
        except OSError:
            port += 1
    if server is None:
        raise SystemExit("找不到可用端口，请关闭占用 8765 附近的程序后重试。")

    url = "http://127.0.0.1:%d/" % port
    print("衣橱已启动，本机访问：%s" % url)
    if args.host not in ("127.0.0.1", "localhost"):
        lan = lan_addresses()
        if lan:
            for ip in lan:
                print("手机 / 平板访问（连同一个 Wi-Fi）：http://%s:%d/" % (ip, port))
            print("提示：同一网络下的设备都能打开这个页面，请只在家庭等可信网络中使用。")
            print("首次启动时如果 Windows 防火墙弹出询问，请勾选“专用网络”并允许访问。")
    print("数据保存在：%s" % DATA_DIR)
    print("关闭这个窗口即可停止服务。")

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
