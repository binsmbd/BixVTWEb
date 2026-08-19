#!/usr/bin/env bash
# Double-click this file in Finder to launch Bix Transform.
cd "$(dirname "$0")" || exit 1
./start.sh "$@"
status=$?
if [ $status -ne 0 ]; then
  echo ""
  read -n 1 -s -r -p "Press any key to close this window…"
  echo ""
fi
exit $status
