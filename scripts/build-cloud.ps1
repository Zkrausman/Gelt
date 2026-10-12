Write-Host "Building linux cross-compilation binaries..."

New-Item -ItemType Directory -Force -Path bin\linux | Out-Null

$env:CGO_ENABLED = "0"
$env:GOOS = "linux"
$env:GOARCH = "amd64"

Write-Host "Compiling cmd/gelt..."
go build -ldflags="-s -w" -o bin/linux/gelt ./cmd/gelt

Write-Host "Compiling cmd/orchestrator..."
go build -ldflags="-s -w" -o bin/linux/orchestrator ./cmd/orchestrator

Write-Host "Build complete. Artifacts in bin/linux/"
