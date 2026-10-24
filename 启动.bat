@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 衣橱 - 穿搭记录

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo 没有找到 Python。请先安装 Python 3.10 或更高版本：
  echo https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

python server.py
echo.
echo 服务已停止，按任意键关闭窗口。
pause >nul
