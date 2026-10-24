@echo off
cd /d "%~dp0"
if not exist "BUILD_4.2.stamp" call build.bat
echo ============================================================
echo  Proof of improvement: a brand-new beginner bot (all stats
echo  level 1) against the learned bot, alternating colours over
echo  24 opening lines.
echo ============================================================
set GAMES=%1
if "%GAMES%"=="" set GAMES=48
engine_server.exe --match %GAMES% --a beginner
echo.
echo Per-game results in data\match_results.csv
pause
