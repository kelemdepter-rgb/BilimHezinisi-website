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

rem ---- Copy the backup into OneDrive so it leaves this computer ----
rem OneDrive syncs it to the cloud on its own; if OneDrive is missing or
rem signed out the backup still exists locally, so this never fails the run.
set "CLOUD=%OneDrive%\BilimHezinisi-Backups"

if defined OneDrive (
  if not exist "%CLOUD%" mkdir "%CLOUD%" >nul 2>&1
  copy /y "backups\*.ndjson.gz" "%CLOUD%\" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo DIQQET: OneDrive gha kochurgili bolmidi.
    echo Zapas yenila "backups" qisquchida bar - uni qolingiz bilen kochurung.
  ) else (
    echo.
    echo OneDrive gha kochuruldi:
    echo    %CLOUD%
  )
) else (
  echo.
  echo DIQQET: OneDrive tepilmidi - zapas peqet bu kompyutirda.
)

echo.
echo ============================================
echo   TAMAM!
echo ============================================
echo.

explorer "%~dp0backups"
pause
