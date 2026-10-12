#!/usr/bin/env bash
set -e

echo "Building linux cross-compilation binaries..."

mkdir -p bin/linux

export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64

echo "Compiling cmd/gelt..."
go build -ldflags="-s -w" -o bin/linux/gelt ./cmd/gelt

echo "Compiling cmd/orchestrator..."
go build -ldflags="-s -w" -o bin/linux/orchestrator ./cmd/orchestrator

echo "Build complete. Artifacts in bin/linux/"
