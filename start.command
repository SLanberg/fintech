#!/bin/bash
echo "Starting Lockin & Build..."

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm run install:all
    npm install
fi

echo "Opening browser at http://localhost:3000..."
if command -v open &> /dev/null; then
    open http://localhost:3000
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
fi

echo "Launching Frontend and Backend servers..."
npm run dev
