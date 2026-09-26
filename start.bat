@echo off
chcp 65001 >nul
echo Starting Lockin & Build...

if not exist "node_modules" (
    echo Installing dependencies...
    call npm run install:all
    call npm install
)

echo Opening browser at http://localhost:3000
start http://localhost:3000

echo Launching Frontend and Backend servers...
npm run dev
