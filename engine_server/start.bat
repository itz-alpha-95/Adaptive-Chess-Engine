@echo off
cd /d "%~dp0"
if not exist "BUILD_4.2.stamp" (
    echo Engine not built for v4.2 yet, compiling now...
    call build.bat
)
if not exist "BUILD_4.2.stamp" (
    echo Compilation failed. Cannot start server.
    pause
    exit /b 1
)

echo Starting OmegaChess C++ Backend Server on http://localhost:8080...
engine_server.exe
pause
