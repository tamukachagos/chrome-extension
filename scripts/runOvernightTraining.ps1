param(
  [double]$Hours = 8,
  [int]$IntervalMinutes = 30,
  [int]$HeartbeatMinutes = 1,
  [switch]$OpenBrowser,
  [switch]$Once,
  [switch]$Background
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$argsList = @(
  ".\scripts\runOvernightTraining.js",
  "--hours", "$Hours",
  "--interval-minutes", "$IntervalMinutes",
  "--heartbeat-minutes", "$HeartbeatMinutes"
)

if ($OpenBrowser) { $argsList += "--open-browser" }
if ($Once) { $argsList += "--once" }

Push-Location $root
try {
  if ($Background) {
    $logDir = Join-Path $root "training\overnight_runs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdout = Join-Path $logDir "overnight-background-$stamp.out.log"
    $stderr = Join-Path $logDir "overnight-background-$stamp.err.log"
    $argString = ($argsList | ForEach-Object { if ($_ -match "\s") { '"' + $_ + '"' } else { $_ } }) -join " "
    $process = Start-Process -FilePath "node" -ArgumentList $argString -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    Write-Output "Started overnight training in background."
    Write-Output "PID: $($process.Id)"
    Write-Output "stdout: $stdout"
    Write-Output "stderr: $stderr"
  } else {
    node @argsList
  }
} finally {
  Pop-Location
}
