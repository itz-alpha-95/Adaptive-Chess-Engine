@echo off
echo ========================================================
echo   Starting OmegaChess (Adaptive C++ Chess Engine)
echo ========================================================

cd /d "%~dp0"

if not exist "engine_server\BUILD_4.2.stamp" (
    echo [INFO] Compiling C++ engine v4.2...
    call "%~dp0engine_server\build.bat"
    cd /d "%~dp0"
)
if not exist "engine_server\BUILD_4.2.stamp" (
    echo [ERROR] engine_server.exe could not be built. See the errors above.
    echo         Close any running "OmegaChess C++ Server" window and try again.
    pause
    exit /b 1
)

echo [INFO] Launching C++ Engine Backend on port 8080...
start "OmegaChess C++ Server" /min cmd /c "cd /d "%~dp0engine_server" && engine_server.exe"

timeout /t 1 >nul 2>nul

echo [INFO] Opening OmegaChess Web App in browser...
start "" "%~dp0index.html"

echo.
echo OmegaChess is running!
echo C++ Backend: https://itz-alpha-95.github.io/Adaptive-Chess-Engine/#
echo.
pause
