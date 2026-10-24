@echo off
cd /d "%~dp0"
if not exist "BUILD_4.2.stamp" call build.bat
echo Running move-generation self test (perft)...
engine_server.exe --perft
pause
