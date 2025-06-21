@echo off
echo 🃏 MTG Card Database Builder (Windows)
echo =====================================

echo.
echo 📋 Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python is not installed or not in PATH
    echo Please install Python from https://python.org
    pause
    exit /b 1
)

echo ✅ Python is installed

echo.
echo 📦 Installing Python dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo 🏗️ Building MTG card database...
python build_card_database.py
if %errorlevel% neq 0 (
    echo ❌ Database build failed
    pause
    exit /b 1
)

echo.
echo 🎉 Database build complete!
echo You can now run your Electron app with: npm start
echo.
pause 