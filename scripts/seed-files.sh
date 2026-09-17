#!/usr/bin/env bash
# Load-test seeding script: uploads randomly generated files across the
# service's categories via POST /files/:type/:id (multipart, field "file").
#
# Usage:
#   scripts/seed-files.sh [options]
#
# Options:
#   -H, --host URL         Base URL of the service (default: http://localhost:3000)
#   -c, --categories N     Number of categories to use, taken in order from the
#                          fixed 10-category list below (default: 10, max: 10)
#   -n, --count N          Number of files to upload per category (default: 100)
#   -s, --size KB          Average file size in KB; actual size per file is
#                          randomized within +/-30% of this value (default: 100)
#   -p, --parallel N       Number of concurrent uploads (default: 8)
#   -h, --help             Show this help and exit
#
# Example (the eventual full load: 10 categories x 30k files x ~100KB):
#   scripts/seed-files.sh -c 10 -n 30000 -s 100
#
# Example (small smoke test):
#   scripts/seed-files.sh -c 3 -n 50 -s 100

set -euo pipefail

# Must match ALLOWED_TYPES in .example.env / .env.
ALL_CATEGORIES=(invoice receipt contract report statement certificate manifest photo ticket backup)

HOST="http://localhost:3000"
NUM_CATEGORIES=10
COUNT_PER_CATEGORY=100
AVG_SIZE_KB=100
PARALLEL=8

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -H|--host) HOST="$2"; shift 2 ;;
    -c|--categories) NUM_CATEGORIES="$2"; shift 2 ;;
    -n|--count) COUNT_PER_CATEGORY="$2"; shift 2 ;;
    -s|--size) AVG_SIZE_KB="$2"; shift 2 ;;
    -p|--parallel) PARALLEL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if ! [[ "$NUM_CATEGORIES" =~ ^[0-9]+$ ]] || [[ "$NUM_CATEGORIES" -lt 1 ]] || [[ "$NUM_CATEGORIES" -gt ${#ALL_CATEGORIES[@]} ]]; then
  echo "error: --categories must be between 1 and ${#ALL_CATEGORIES[@]}" >&2
  exit 1
fi
if ! [[ "$COUNT_PER_CATEGORY" =~ ^[0-9]+$ ]] || [[ "$COUNT_PER_CATEGORY" -lt 1 ]]; then
  echo "error: --count must be a positive integer" >&2
  exit 1
fi
if ! [[ "$AVG_SIZE_KB" =~ ^[0-9]+$ ]] || [[ "$AVG_SIZE_KB" -lt 1 ]]; then
  echo "error: --size must be a positive integer (KB)" >&2
  exit 1
fi
if ! [[ "$PARALLEL" =~ ^[0-9]+$ ]] || [[ "$PARALLEL" -lt 1 ]]; then
  echo "error: --parallel must be a positive integer" >&2
  exit 1
fi

CATEGORIES=("${ALL_CATEGORIES[@]:0:$NUM_CATEGORIES}")
TOTAL=$(( NUM_CATEGORIES * COUNT_PER_CATEGORY ))

WORK_DIR=$(mktemp -d)
LOG_FILE="$WORK_DIR/results.log"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Host:                $HOST"
echo "Categories (${NUM_CATEGORIES}):     ${CATEGORIES[*]}"
echo "Files per category:   $COUNT_PER_CATEGORY"
echo "Average size:         ${AVG_SIZE_KB}KB (+/-30%)"
echo "Parallel uploads:     $PARALLEL"
echo "Total files:          $TOTAL"
echo

upload_one() {
  local type="$1" id="$2" size_bytes="$3"
  local tmp_file
  tmp_file=$(mktemp "$WORK_DIR/payload.XXXXXX")
  head -c "$size_bytes" /dev/urandom > "$tmp_file" 2>/dev/null

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$HOST/files/$type/$id" \
    -F "file=@${tmp_file}") || code="000"
  rm -f "$tmp_file"

  case "$code" in
    201) echo "OK $type $id" >> "$LOG_FILE" ;;
    409) echo "SKIP $type $id" >> "$LOG_FILE" ;;
    *) echo "FAIL($code) $type $id" >> "$LOG_FILE" ;;
  esac
}

# Random size in bytes within +/-30% of the configured average.
random_size_bytes() {
  local avg_bytes=$(( AVG_SIZE_KB * 1024 ))
  local min=$(( avg_bytes * 70 / 100 ))
  local max=$(( avg_bytes * 130 / 100 ))
  echo $(( min + RANDOM % (max - min + 1) ))
}

dispatched=0
start_ts=$(date +%s)
pids=()

for type in "${CATEGORIES[@]}"; do
  for ((i = 1; i <= COUNT_PER_CATEGORY; i++)); do
    # Bounded parallelism: wait on the oldest job once the pool is full.
    # (Portable to bash 3.2/macOS, which lacks `wait -n`.)
    if [[ ${#pids[@]} -ge $PARALLEL ]]; then
      wait "${pids[0]}" 2>/dev/null || true
      pids=("${pids[@]:1}")
    fi

    id=$(printf '%s-%06d' "$type" "$i")
    upload_one "$type" "$id" "$(random_size_bytes)" &
    pids+=("$!")

    dispatched=$(( dispatched + 1 ))
    if (( dispatched % 500 == 0 || dispatched == TOTAL )); then
      echo "dispatched $dispatched/$TOTAL..."
    fi
  done
done

wait

elapsed=$(( $(date +%s) - start_ts ))
ok=$(grep -c '^OK ' "$LOG_FILE" || true)
skip=$(grep -c '^SKIP ' "$LOG_FILE" || true)
fail=$(grep -c '^FAIL' "$LOG_FILE" || true)

echo
echo "Done in ${elapsed}s — ok=$ok skip=$skip(already existed) fail=$fail"

if [[ "$fail" -gt 0 ]]; then
  echo
  echo "First failures:"
  grep '^FAIL' "$LOG_FILE" | head -10
  exit 1
fi
