#!/usr/bin/env bash
#
# Serve a production build and run a browser verification against it.
#
# Exists because `next start &` followed by `kill %1` does not reliably stop
# the process that holds the port: Next runs the server in a child, the job
# control kill reaps the parent, and the next run silently binds nothing and
# tests the STALE server instead. That failure is invisible — the old server
# answers every request — so it is the kind that makes a verification lie.
#
# Usage: scripts/serve-verify.sh <port> <verify-command...>
set -uo pipefail

PORT="${1:?port required}"
shift
[ "$#" -gt 0 ] || { echo "a verify command is required" >&2; exit 2; }

# Fixture auth is OPT-IN. Gates that were verified against the real Supabase
# configuration must keep being verified against it, so this script never
# quietly substitutes one environment for another.
#
# NOTE: NEXT_PUBLIC_* are inlined at BUILD time, so a run using fixture auth
# needs a build made with these same values. Setting them here only covers the
# server half.
if [ "${VEO_FIXTURE_AUTH:-0}" = "1" ]; then
  export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54330}"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-fixture-anon-key-not-a-real-credential}"
fi

PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    # The whole group: Next's child is what holds the port.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  done
  # Give them a moment, then make sure the port is actually free.
  for _ in $(seq 1 20); do
    port_busy || return 0
    sleep 0.25
  done
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
  done
}
trap cleanup EXIT INT TERM

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && { exec 3<&- 3>&-; return 0; }
  return 1
}

# --- refuse to start on top of something else ------------------------------
if port_busy; then
  echo "port $PORT is already in use; stop whatever holds it first" >&2
  exit 1
fi

# --- start ------------------------------------------------------------------
if [ "${VEO_FIXTURE_AUTH:-0}" = "1" ]; then
  setsid node scripts/fixture-auth-server.mjs > /dev/null 2>&1 &
  PIDS+=("$!")
fi

setsid npx next start -p "$PORT" > /tmp/veo-verify-$PORT.log 2>&1 &
SERVER_PID=$!
PIDS+=("$SERVER_PID")

for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "the server exited before it was ready:" >&2
    tail -20 "/tmp/veo-verify-$PORT.log" >&2
    exit 1
  fi
  curl -sf "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1 && break
  sleep 1
done

curl -sf "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1 || {
  echo "the server never became healthy on port $PORT:" >&2
  tail -20 "/tmp/veo-verify-$PORT.log" >&2
  exit 1
}

# --- verify -----------------------------------------------------------------
"$@"
