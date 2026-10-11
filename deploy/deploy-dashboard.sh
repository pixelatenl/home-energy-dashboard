#!/usr/bin/env bash
# Pull the latest dashboard code, rebuild the frontend,
# and restart the web server on the mini PC.
set -euo pipefail

REPO_DIR="$HOME/home-energy-dashboard"

cd "$REPO_DIR"

echo "Pulling latest code..."
git pull --ff-only

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building frontend..."
pnpm build

echo "Restarting ems-dashboard service..."
sudo systemctl restart ems-dashboard

echo "Status:"
systemctl status ems-dashboard --no-pager --lines=5

echo "Done. Dashboard: http://$(hostname -I | awk '{print $1}'):8080"
