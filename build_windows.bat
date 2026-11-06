@echo off
rem Сборка PLL Studio для Windows (обёртка над build_windows.ps1)
rem   build_windows.bat            - NSIS + MSI
rem   build_windows.bat -WithServer
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_windows.ps1" %*
exit /b %ERRORLEVEL%
