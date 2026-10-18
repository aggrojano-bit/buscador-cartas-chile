@echo off
chcp 65001 >nul
title Buscador de Cartas Chile
cd /d "%~dp0"

rem Las librerias se instalan fuera de OneDrive para que no se sincronicen
set "VENV=%LOCALAPPDATA%\BuscadorCartasChile\venv"

if not exist "%VENV%\Scripts\python.exe" (
    echo Primera vez: creando el entorno de Python. Esto tarda un par de minutos...
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo No encontre Python. Instalalo desde https://www.python.org y marca "Add Python to PATH".
        pause
        exit /b 1
    )
)

echo Revisando librerias...
"%VENV%\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
    echo No se pudieron instalar las librerias. Revisa tu conexion a internet.
    pause
    exit /b 1
)

"%VENV%\Scripts\python.exe" -m app.lanzar
pause
