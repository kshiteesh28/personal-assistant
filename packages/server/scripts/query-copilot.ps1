# query-copilot.ps1
# Sends a prompt to M365 Copilot via the clipboard + Edge automation,
# then writes the response to .cache/copilot-llm-response.json

param(
  [Parameter(Mandatory=$true)]
  [string]$Prompt,
  
  [string]$OutputPath,
  [int]$WaitSeconds = 15
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $OutputPath) {
  $cacheDir = Join-Path $root ".." ".." ".cache"
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  $OutputPath = Join-Path $cacheDir "copilot-llm-response.json"
}

Write-Host "=== Copilot Query ===" -ForegroundColor Cyan
Write-Host "Prompt: $($Prompt.Substring(0, [Math]::Min(80, $Prompt.Length)))..."
Write-Host "Output: $OutputPath"

# Place prompt in clipboard for paste
$Prompt | Set-Clipboard

# Try to open M365 Copilot in browser
$copilotUrl = "https://m365.cloud.microsoft/chat"
Write-Host "Opening $copilotUrl ..." -ForegroundColor Yellow

try {
  Start-Process "msedge" "--new-window $copilotUrl"
  Write-Host "Waiting ${WaitSeconds}s for page to load..." -ForegroundColor Gray
  Start-Sleep -Seconds 5
  
  # Send Ctrl+V to paste, then Enter
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  
  Write-Host "Waiting ${WaitSeconds}s for response..." -ForegroundColor Gray
  Start-Sleep -Seconds $WaitSeconds
  
  Write-Host "Response should now be in the M365 Copilot window." -ForegroundColor Green
  Write-Host "NOTE: Automated response extraction requires the server to be polling." -ForegroundColor Yellow
} catch {
  Write-Host "Browser automation failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Write a stub response file so the server knows a query was attempted
$stubResponse = @{
  prompt      = $Prompt
  response    = "Copilot response pending. Check the M365 Copilot window."
  generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  events      = @()
} | ConvertTo-Json -Depth 3

$stubResponse | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "Stub response written to: $OutputPath" -ForegroundColor Green
