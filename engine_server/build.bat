@echo off
echo ========================================================
echo   Compiling OmegaChess C++ Engine (v4.2)
echo ========================================================

cd /d "%~dp0"
set "PATH=C:\msys64\ucrt64\bin;%PATH%"

where g++ >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] g++ compiler not found in PATH or C:\msys64\ucrt64\bin!
    exit /b 1
)

if exist BUILD_4.2.stamp del BUILD_4.2.stamp

echo Using compiler: g++
g++ -std=c++17 -O3 -static -static-libgcc -static-libstdc++ -I./src -o engine_server.exe ^
    src/main.cpp ^
    src/ChessRules.cpp ^
    src/Evaluator.cpp ^
    src/ChessEngine.cpp ^
    src/LearningSystem.cpp ^
    src/HttpServer.cpp ^
    src/Arena.cpp ^
    src/Coach.cpp ^
    -lws2_32 -lpthread

if %ERRORLEVEL% equ 0 (
    echo built> BUILD_4.2.stamp
    echo.
    echo [SUCCESS] Built engine_server.exe
    echo   Server:     start.bat  (or engine_server.exe)
    echo   Self test:  test.bat   (engine_server.exe --perft)
    echo   Training:   train.bat  (engine_server.exe --train 30 --opp club)
    echo   Proof:      match.bat  (engine_server.exe --match 48: new beginner vs learned bot)
) else (
    echo.
    echo [ERROR] Build failed. Check compiler errors above.
    exit /b 1
)
