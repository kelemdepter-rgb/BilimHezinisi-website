@echo off
chcp 65001 >nul
title Bilim Hezinisi - Zapaslash
cd /d "%~dp0"

echo.
echo ============================================
echo   BILIM HEZINISI - KITABLARNI ZAPASLASH
echo ============================================
echo.

if not exist ".env.local" (
  echo XATALIQ: .env.local hojjiti tepilmidi.
  echo Bu hojjet mushu qisqucta bolushi kerek.
  echo.
  pause
  exit /b 1
)

node --env-file=.env.local scripts/backup.mjs
if errorlevel 1 (
  echo.
  echo ============================================
  echo   XATALIQ CHIQTI - yuqiridiki xetni Claude gha korsiting
  echo ============================================
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   TAMAM! Zapas "backups" qisquchigha chushti.
echo   Uni USB yaki bulut diskigha kochurup qoyung.
echo ============================================
echo.

explorer "%~dp0backups"
pause
