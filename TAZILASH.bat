@echo off
chcp 65001 >nul
title Bilim Hezinisi - Exlet Tazilash
cd /d "%~dp0"

echo.
echo ============================================
echo   BILIM HEZINISI - EXLET TAZILASH
echo ============================================
echo.
echo   Ochurulgen kitablarning qalduqini tapidu
echo   we boshluqni qandaq qayturushni korsitidu.
echo.

if not exist ".env.local" (
  echo XATALIQ: .env.local hojjiti tepilmidi.
  echo Bu hojjet mushu qisqucta bolushi kerek.
  echo.
  pause
  exit /b 1
)

node --env-file=.env.local scripts/cleanup.mjs
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
pause
