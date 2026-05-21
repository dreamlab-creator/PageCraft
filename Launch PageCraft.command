#!/bin/zsh
# PageCraft launcher. Double-click to start the dev server and open the app.
# Press Ctrl + C in this Terminal window to stop the server.

set -e

# Ensure Node is on PATH (installed at ~/.node-lts during initial setup).
export PATH="$HOME/.node-lts/bin:$PATH"

# Move to the project folder, regardless of where this file was launched from.
cd "$(dirname "$0")"

echo ""
echo "  PageCraft"
echo "  ---------"
echo "  Starting dev server..."
echo ""

# First-run install if node_modules is missing.
if [ ! -d node_modules ]; then
  echo "  First run — installing dependencies. This may take a minute..."
  npm install --no-audit --no-fund
  echo ""
fi

# Start Vite. Once it prints "ready", open the browser in the background.
( sleep 2 && open "http://localhost:5173" ) &

npm run dev
