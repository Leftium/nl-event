#!/bin/sh
# Keep Vite attached to stdin so its terminal shortcuts remain available.
watch_rescript() {
  compiler_pid=
  stop_compiler() {
    trap '' INT TERM
    if [ -n "$compiler_pid" ]; then
      kill "$compiler_pid" 2>/dev/null || :
      wait "$compiler_pid" 2>/dev/null || :
    fi
  }
  trap stop_compiler EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # A queued watch.lock removal (or a separate one-shot build) can stop
  # ReScript 12.3 cleanly. Resume watching until Vite shuts down.
  while :; do
    rescript watch &
    compiler_pid=$!
    wait "$compiler_pid"
    code=$?
    compiler_pid=
    [ "$code" -eq 0 ] || return "$code"
    # Avoid a restart loop while macOS is delivering old lock-file events.
    sleep 1
  done
}
cleanup() {
  trap '' INT TERM
  kill "$watcher_pid" 2>/dev/null || :
  wait "$watcher_pid" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
watch_rescript &
watcher_pid=$!
vite dev
exit $?
