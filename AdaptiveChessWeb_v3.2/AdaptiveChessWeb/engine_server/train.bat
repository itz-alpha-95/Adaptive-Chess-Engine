@echo off
cd /d "%~dp0"
if not exist "BUILD_4.2.stamp" call build.bat
echo ============================================================
echo  Automated training. OmegaBot plays the "club" bot (all stats
echo  level 5); after every game the coach reviews each move and the
echo  bot earns stat points where it lacked (4 per game for the
echo  first 50 games, then fewer and fewer, never below 1).
echo  CLOSE the server window first, otherwise it will overwrite
echo  the learning file with its own copy.
echo ============================================================
set GAMES=%1
if "%GAMES%"=="" set GAMES=30
engine_server.exe --train %GAMES% --opp club
echo.
echo Skill levels saved to data\learning_data.json, per-game log in data\learning_history.csv
pause
