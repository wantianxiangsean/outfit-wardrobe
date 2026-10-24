#!/usr/bin/env python3
"""把本机衣橱数据导出为备份，保存到私有的数据仓库。

默认通过 GitHub API 上传（需要本机 gh 已登录），这样在 github.com
直连不稳定时也能备份；也可以用 --git-repo 走本地 git 仓库。
"""

import argparse
import base64
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"


def gh_token():
    try:
        return subprocess.check_output(
            ["gh", "auth", "token"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def api_call(method, path, token, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "outfit-wardrobe-backup",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def fetch_backup(port):
    url = "http://127.0.0.1:%d/api/backup" % port
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError):
        sys.exit("连不上本机衣橱服务（%s）。请先启动 启动.bat 再运行备份。" % url)


def save_via_api(payload, stamp, repo):
    token = gh_token()
    if not token:
        sys.exit("没有找到 GitHub 登录信息。请先在这台电脑运行 gh auth login。")
    content = base64.b64encode(
        json.dumps(payload, ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    path = "backups/wardrobe-%s.json" % stamp
    try:
        result = api_call(
            "PUT",
            "/repos/%s/contents/%s" % (repo, path),
            token,
            {"message": "衣橱备份 %s" % stamp, "content": content, "branch": "main"},
        )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:200]
        sys.exit("上传失败（HTTP %s）：%s" % (exc.code, detail))
    except (urllib.error.URLError, OSError) as exc:
        sys.exit("上传失败：%s" % exc)
    print("已备份到私有仓库：%s" % result.get("content", {}).get("html_url", path))


def save_via_git(payload, stamp, git_repo, no_push):
    repo = pathlib.Path(git_repo).expanduser().resolve()
    if not (repo / ".git").exists():
        sys.exit("找不到 git 仓库：%s" % repo)
    folder = repo / "backups"
    folder.mkdir(exist_ok=True)
    target = folder / ("wardrobe-%s.json" % stamp)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print("已导出：%s" % target)

    def git(*extra):
        return subprocess.run(["git", "-C", str(repo), *extra], check=False)

    git("add", str(target))
    if git("commit", "-m", "衣橱备份 %s" % stamp).returncode != 0:
        sys.exit("git commit 失败。")
    if not no_push and git("push").returncode != 0:
        sys.exit("git push 失败；可稍后重试，或改用默认的 API 上传方式。")


def main():
    parser = argparse.ArgumentParser(description="同步衣橱备份到私有数据仓库")
    parser.add_argument(
        "--repo",
        default="wantianxiangsean/outfit-wardrobe-data",
        help="私有数据仓库 owner/name",
    )
    parser.add_argument("--port", type=int, default=8765, help="衣橱服务端口")
    parser.add_argument(
        "--git-repo",
        default="",
        help="改用本地 git 仓库路径（离线或已有克隆时）",
    )
    parser.add_argument("--no-push", action="store_true", help="git 模式只提交不推送")
    parser.add_argument("--dry-run", action="store_true", help="只检查备份内容，不上传")
    args = parser.parse_args()

    payload = fetch_backup(args.port)
    if args.dry_run:
        size = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        print(
            "备份检查：%d 件单品、%d 套搭配，约 %.1f KB"
            % (len(payload.get("items") or []), len(payload.get("outfits") or []), size / 1024)
        )
        return
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if args.git_repo:
        save_via_git(payload, stamp, args.git_repo, args.no_push)
    else:
        save_via_api(payload, stamp, args.repo)


if __name__ == "__main__":
    main()
