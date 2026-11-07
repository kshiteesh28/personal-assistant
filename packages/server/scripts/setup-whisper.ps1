# Setup Whisper for Personal Secretary
# Run this script ONCE to download the whisper binaries and model.
# Requires: PowerShell 5+ and an internet connection.

param(
  [string]$WhisperVersion = "1.7.2",
  [string]$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$binDir    = Join-Path $root "bin"
$modelsDir = Join-Path $root "models"

Write-Host "=== Personal Secretary — Whisper Setup ===" -ForegroundColor Cyan
Write-Host "Root:    $root"
Write-Host "Bin dir: $binDir"
Write-Host "Models:  $modelsDir"

# Create directories
New-Item -ItemType Directory -Force -Path $binDir    | Out-Null
New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

# --- Download Whisper binaries ---
$zipUrl  = "https://github.com/ggerganov/whisper.cpp/releases/download/v$WhisperVersion/whisper-bin-x64.zip"
$zipPath = Join-Path $env:TEMP "whisper-bin-x64.zip"

Write-Host ""
Write-Host "Downloading whisper-bin-x64.zip from GitHub..." -ForegroundColor Yellow
Write-Host "URL: $zipUrl"

try {
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  Write-Host "Download complete." -ForegroundColor Green
} catch {
  Write-Host "ERROR: Failed to download whisper binary. Check your internet connection." -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

# --- Extract binaries ---
Write-Host "Extracting binaries to $binDir ..." -ForegroundColor Yellow
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $env:TEMP\whisper-extract -Force
  
  $exeFiles = @("whisper-cli.exe")
  $dllFiles = @("whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll")
  
  $extractedRoot = Get-ChildItem $env:TEMP\whisper-extract -Recurse -File | Select-Object -First 1 | Split-Path -Parent
  
  foreach ($file in ($exeFiles + $dllFiles)) {
    $src = Get-ChildItem $env:TEMP\whisper-extract -Recurse -Filter $file | Select-Object -First 1
    if ($src) {
      Copy-Item $src.FullName -Destination (Join-Path $binDir $file) -Force
      Write-Host "  Extracted: $file" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: $file not found in zip" -ForegroundColor Yellow
    }
  }
} catch {
  Write-Host "ERROR: Failed to extract binaries." -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

# --- Download Whisper model ---
$modelPath = Join-Path $modelsDir "ggml-base.en.bin"
Write-Host ""
Write-Host "Downloading ggml-base.en.bin model (~142 MB)..." -ForegroundColor Yellow
Write-Host "URL: $ModelUrl"

try {
  Invoke-WebRequest -Uri $ModelUrl -OutFile $modelPath -UseBasicParsing
  Write-Host "Model downloaded." -ForegroundColor Green
} catch {
  Write-Host "ERROR: Failed to download model." -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

# --- Verify ---
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$binFiles = @("whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll")
foreach ($f in $binFiles) {
  $path = Join-Path $binDir $f
  if (Test-Path $path) {
    Write-Host "  OK: bin\$f" -ForegroundColor Green
  } else {
    Write-Host "  MISSING: bin\$f" -ForegroundColor Red
  }
}
if (Test-Path $modelPath) {
  Write-Host "  OK: models\ggml-base.en.bin" -ForegroundColor Green
} else {
  Write-Host "  MISSING: models\ggml-base.en.bin" -ForegroundColor Red
}

Write-Host ""
Write-Host "Setup complete! Restart the server to enable voice transcription." -ForegroundColor Cyan
