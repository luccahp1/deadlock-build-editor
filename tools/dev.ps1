<#
.SYNOPSIS
  One-command in-game test loop: build, install, (re)launch Deadlock, wait
  until the game has loaded the new build, then show the mod's log lines.

.DESCRIPTION
  Mods load at game start only, so every in-game test needs a restart. This
  script does the whole loop without anyone touching the game, so a Claude
  session on the PC can run it and read the result:

    powershell -ExecutionPolicy Bypass -File tools\dev.ps1 -Restart

  Then open the shop in the hideout, press Edit, then Easy Editor (the mod's
  script loads with the in-game HUD, not in the main menu). Afterwards:

    python tools\gamelog.py --check

  Always run tests\ first (node --test tests/): they catch most mistakes
  without a restart. See docs\TESTING.md.

.PARAMETER Restart
  Close a running Deadlock first. Without it the script stops if the game is
  running, so it never kills a match by surprise.

.PARAMETER NoLaunch
  Build and install only.

.PARAMETER Pak
  VPK number (default 42), as in build.py --pak.

.PARAMETER LaunchArgs
  Extra launch options. -condebug is needed for console.log.
#>
param(
    [switch]$Restart,
    [switch]$NoLaunch,
    [int]$Pak = 42,
    [string]$Root = $env:DEADLOCK_ROOT,
    [string]$LaunchArgs = "-condebug -dev -novid",
    [int]$WaitSeconds = 600
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ($Root) { $env:DEADLOCK_ROOT = $Root }

# 1. Offline tests first: a failing test is cheaper than a restart.
if (Get-Command node -ErrorAction SilentlyContinue) {
    Push-Location $repo
    node --test "tests/*.test.js" | Select-String -Pattern "^# (pass|fail)" | ForEach-Object { $_.Line }
    $testsFailed = $LASTEXITCODE -ne 0
    Pop-Location
    if ($testsFailed) { throw "offline tests failed, fix them before testing in game" }
} else {
    Write-Warning "node not found, skipping offline tests"
}

# 2. The VPK cannot be replaced while the game has it open.
$game = Get-Process -Name deadlock -ErrorAction SilentlyContinue
if ($game) {
    if (-not $Restart) { throw "Deadlock is running. Close it or rerun with -Restart." }
    Write-Host "closing Deadlock"
    $game | Stop-Process -Force
    $game | Wait-Process -Timeout 60 -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 3. Build and install.
$out = python "$repo\build.py" --pak $Pak --install 2>&1
$out | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw "build failed" }
$id = ($out | Select-String -Pattern "build id (\S+)").Matches | Select-Object -Last 1 | ForEach-Object { $_.Groups[1].Value }
if (-not $id) { throw "build id not found in build.py output" }

if ($NoLaunch) { Write-Host "installed build $id"; exit 0 }

# 4. Launch through Steam.
$steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamExe -ErrorAction SilentlyContinue).SteamExe
if (-not $steam) { $steam = "${env:ProgramFiles(x86)}\Steam\steam.exe" }
Write-Host "launching Deadlock ($LaunchArgs)"
Start-Process -FilePath $steam -ArgumentList (@("-applaunch", "1422450") + $LaunchArgs.Split(" "))

# 5. Wait for the new build to load.
Write-Host "waiting for build $id; enter the hideout and open the shop if it does not show up"
python "$repo\tools\gamelog.py" --wait-build $id --timeout $WaitSeconds
if ($LASTEXITCODE -ne 0) { throw "the game never logged build $id (is -condebug set? did the HUD load?)" }
python "$repo\tools\gamelog.py"
