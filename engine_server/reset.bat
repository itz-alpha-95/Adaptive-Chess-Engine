@echo off
cd /d "%~dp0"
if not exist "BUILD_4.2.stamp" call build.bat
echo This makes OmegaBot a beginner again (all stats level 1, Elo 400).
echo Close the server window first.
pause
engine_server.exe --reset
pause
