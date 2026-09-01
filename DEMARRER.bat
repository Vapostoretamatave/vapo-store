@echo off
title VAPO STORE - Serveur
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)

echo.
echo ==========================================
echo   VAPO STORE - Lancement du site
echo ==========================================
echo   Boutique :  http://localhost:3000
echo   Admin    :  http://localhost:3000/admin
echo.
echo   La boutique va s'ouvrir dans votre
echo   navigateur dans un instant...
echo.
echo   IMPORTANT : ne fermez PAS cette fenetre.
echo   Pour arreter le site, fermez cette
echo   fenetre ou appuyez sur Ctrl+C
echo ==========================================
echo.

rem Ouvre le navigateur automatiquement apres 2 secondes
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000/"

node server.js
pause