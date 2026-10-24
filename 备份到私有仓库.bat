@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 衣橱 - 备份到私有仓库

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo 没有找到 Python，请先安装 Python 3.10 或更高版本。
  pause
  exit /b 1
)

python sync_backup.py
echo.
pause
