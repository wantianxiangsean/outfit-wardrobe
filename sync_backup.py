#!/usr/bin/env python3
"""把本机衣橱数据导出为备份，并提交到私有的数据仓库。

用法：
    python sync_backup.py --repo "..\\outfit-wardrobe-data"

需要本机的衣橱服务正在运行（默认 8765 端口）。
"""

import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description="同步衣橱备份到私有 git 仓库")
    parser.add_argument("--repo", default="../outfit-wardrobe-data", help="私有数据仓库的本地路径")
    parser.add_argument("--port", type=int, default=8765, help="衣橱服务端口")
    parser.add_argument("--no-push", action="store_true", help="只提交到本地，不推送")
    args = parser.parse_args()

    repo = pathlib.Path(args.repo).expanduser().resolve()
    if not (repo / ".git").exists():
        sys.exit("找不到 git 仓库：%s\n请先把私有数据仓库克隆到这个路径。" % repo)

    url = "http://127.0.0.1:%d/api/backup" % args.port
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError):
        sys.exit("连不上本机衣橱服务（%s）。请先启动 启动.bat 再运行备份。" % url)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    folder = repo / "backups"
    folder.mkdir(exist_ok=True)
    target = folder / ("wardrobe-%s.json" % stamp)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print("已导出：%s" % target)

    def git(*extra):
        return subprocess.run(["git", "-C", str(repo), *extra], check=False)

    git("add", str(target))
    commit = git("commit", "-m", "衣橱备份 %s" % stamp)
    if commit.returncode != 0:
        sys.exit("git commit 失败，请检查上面的提示。")
    if not args.no_push:
        if git("push").returncode != 0:
            sys.exit("git push 失败，请确认已登录 GitHub 并有该私有仓库的权限。")
    print("备份已保存到私有仓库。")


if __name__ == "__main__":
    main()
