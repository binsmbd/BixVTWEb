#!/usr/bin/env bash
# Bix Transform launcher (macOS / Linux).
# Starts the local server and opens the app in your browser.
# Node.js is used when available; otherwise it falls back to Python.

set -u

# Always work from the folder this script lives in — double-clicking a launcher
# leaves the shell in your home directory, which would serve the wrong files.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$HERE" || exit 1

PORT="${PORT:-5173}"
URL="http://localhost:${PORT}"

# Fail early and clearly rather than starting a server that 404s everything.
if [ ! -f "$HERE/index.html" ] || [ ! -d "$HERE/js" ]; then
  cat <<MSG

  Bix Transform can't start: the app files are missing.

  This launcher is in:
    $HERE

  It expects index.html, css/ and js/ right next to it. Move the launcher back
  into the Bix Transform folder (or re-download the project) and try again.

MSG
  exit 1
fi

open_browser() {
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  else echo "  Open this address in your browser: $1"
  fi
}

if command -v node >/dev/null 2>&1; then
  exec node "$HERE/server.mjs" "$@"
fi

PYTHON=""
if command -v python3 >/dev/null 2>&1; then PYTHON="python3"
elif command -v python >/dev/null 2>&1; then PYTHON="python"
fi

if [ -n "$PYTHON" ]; then
  echo ""
  echo "  Bix Transform is running (Python fallback — Node.js not found)"
  echo ""
  echo "  Local     $URL"
  echo "  Folder    $HERE"
  echo ""
  echo "  Press Ctrl+C to stop."
  echo ""
  open_browser "$URL" &
  exec "$PYTHON" -m http.server "$PORT" --bind 127.0.0.1 --directory "$HERE"
fi

cat <<'MSG'

  Bix Transform needs a local web server to run.

  Neither Node.js nor Python was found on this machine.
  Install Node.js from https://nodejs.org and run this file again.

  (A server is required because the app uses ES modules, which browsers
  refuse to load straight off the file system.)

MSG
exit 1
