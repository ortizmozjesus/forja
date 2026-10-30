#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no esta instalado. Instalalo desde https://nodejs.org"
  read -r -p "Pulsa Enter para salir..."
  exit 1
fi
( sleep 1.5; (command -v open >/dev/null && open http://localhost:4180) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4180) ) >/dev/null 2>&1 &
node server.js
