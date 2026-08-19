#!/usr/bin/env bash
# Double-click this file in Finder to launch Bix Transform.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$HERE" || exit 1

# Call through bash rather than executing start.sh directly: downloading the
# project as a ZIP strips the executable bit, and "./start.sh" would then fail.
bash "$HERE/start.sh" "$@"
status=$?
if [ $status -ne 0 ]; then
  echo ""
  read -n 1 -s -r -p "Press any key to close this window…"
  echo ""
fi
exit $status
