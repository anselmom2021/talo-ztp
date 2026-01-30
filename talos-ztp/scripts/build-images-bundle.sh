#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-images-bundle.sh --images-file ./scripts/images.txt --output ./images.tar [--runtime docker|nerdctl]

Builds an images.tar bundle by pulling all images listed in the file.
USAGE
}

images_file=""
output="images.tar"
runtime=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --images-file)
      images_file="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    --runtime)
      runtime="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$images_file" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ ! -f "$images_file" ]]; then
  echo "Images file $images_file not found." >&2
  exit 1
fi

if [[ -z "$runtime" ]]; then
  if command -v docker >/dev/null 2>&1; then
    runtime="docker"
  elif command -v nerdctl >/dev/null 2>&1; then
    runtime="nerdctl"
  else
    echo "No supported runtime found (docker or nerdctl)." >&2
    exit 1
  fi
fi

mapfile -t images < <(grep -v '^\s*#' "$images_file" | awk 'NF{print $0}')

if [[ "${#images[@]}" -eq 0 ]]; then
  echo "No images found in $images_file." >&2
  exit 1
fi

case "$runtime" in
  docker)
    for image in "${images[@]}"; do
      docker pull "$image"
    done
    docker save -o "$output" "${images[@]}"
    ;;
  nerdctl)
    for image in "${images[@]}"; do
      nerdctl pull "$image"
    done
    nerdctl save -o "$output" "${images[@]}"
    ;;
  *)
    echo "Unsupported runtime: $runtime (use docker or nerdctl)." >&2
    exit 1
    ;;
esac

echo "Image bundle written to $output."
