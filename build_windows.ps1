# Сборка PLL Studio для Windows: установщики NSIS (.exe) и MSI (Tauri 2).
#
#   .\build_windows.ps1                  # NSIS + MSI
#   .\build_windows.ps1 -Bundles nsis    # только NSIS-установщик
#   .\build_windows.ps1 -WithServer      # плюс консольный pll-server.exe (веб-режим)
#
# Версия берётся из config\version.json. Результат: release\vX.Y.Z\ + checksum.txt (SHA-256).
# Требования: Rust (rustup, toolchain MSVC), Node.js 20+, Visual Studio Build Tools (C++),
# WebView2 (есть в Windows 10/11; установщик докачает при необходимости).

[CmdletBinding()]
param(
    [ValidateSet("nsis", "msi", "nsis,msi")]
    [string]$Bundles = "nsis,msi",
    [switch]$WithServer,
    [switch]$SkipVersionCheck,
    [switch]$Open
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root
$Slug = "PLL-Studio"

function Info($m) { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "OK $m" -ForegroundColor Green }
function Fail($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Need($tool, $hint) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "не найден '$tool' — $hint" }
}
function Run([string]$exe, [string[]]$argv) {
    Write-Host "  `$ $exe $($argv -join ' ')" -ForegroundColor DarkGray
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { Fail "команда завершилась с кодом ${LASTEXITCODE}: $exe $($argv -join ' ')" }
}

$Version = (Get-Content (Join-Path $Root "config\version.json") -Raw | ConvertFrom-Json).app_info.version
Write-Host ""
Write-Host "PLL Studio v$Version — сборка Windows ($Bundles)" -ForegroundColor White
Write-Host ""
$t0 = Get-Date

# 1. окружение
Need "cargo" "установите Rust: https://rustup.rs (toolchain stable-msvc)"
Need "node"  "установите Node.js 20+: https://nodejs.org"
Need "npm"   "входит в Node.js"
Ok "инструменты найдены"

# 2. версии
if (-not $SkipVersionCheck) {
    $py = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
    if ($py) {
        Info "проверка версий (tools\update_version.py status)"
        & $py tools\update_version.py status | Out-Host
        if ($LASTEXITCODE -ne 0) { Fail "версии расходятся — выполните: $py tools\update_version.py sync" }
        Ok "версия v$Version синхронизирована"
    } else {
        Write-Host "  (Python не найден — проверка версий пропущена)" -ForegroundColor Yellow
    }
}

# 3. зависимости фронтенда
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Info "установка npm-зависимостей"
    Run "npm" @("ci")
}

# 4. тесты модели
Info "тесты pll-core"
Run "cargo" @("test", "-q", "-p", "pll-core")

# 5. сборка
Info "сборка приложения (tauri build)"
Run "npx" @("tauri", "build", "--bundles", $Bundles)

$bundle = Join-Path $Root "target\release\bundle"
$out = Join-Path $Root "release\v$Version"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$produced = @()

$nsis = Get-ChildItem (Join-Path $bundle "nsis") -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nsis) {
    $dst = Join-Path $out "$Slug-Setup-v$Version-x64.exe"
    Copy-Item $nsis.FullName $dst -Force
    $produced += $dst
}
$msi = Get-ChildItem (Join-Path $bundle "msi") -Filter *.msi -ErrorAction SilentlyContinue | Select-Object -First 1
if ($msi) {
    $dst = Join-Path $out "$Slug-v$Version-x64.msi"
    Copy-Item $msi.FullName $dst -Force
    $produced += $dst
}
if ($produced.Count -eq 0) { Fail "установщики не найдены в $bundle" }

if ($WithServer) {
    Info "сборка pll-server"
    Run "cargo" @("build", "--release", "-p", "pll-server")
    $dst = Join-Path $out "pll-server-v$Version-x64.exe"
    Copy-Item (Join-Path $Root "target\release\pll-server.exe") $dst -Force
    $produced += $dst
}

# 6. контрольные суммы
$lines = foreach ($p in $produced) {
    $h = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower()
    "$h  $(Split-Path $p -Leaf)"
}
Set-Content -Path (Join-Path $out "checksum.txt") -Value $lines -Encoding UTF8

Write-Host ""
Ok ("готово за {0:N0} с -> release\v$Version\" -f ((Get-Date) - $t0).TotalSeconds)
foreach ($p in $produced) {
    "    {0}  ({1:N1} МБ)" -f (Split-Path $p -Leaf), ((Get-Item $p).Length / 1MB) | Write-Host
}
Write-Host "    checksum.txt"
Write-Host ""
Write-Host "Установщик не подписан — SmartScreen может показать предупреждение: «Подробнее» -> «Выполнить в любом случае»." -ForegroundColor Yellow
if ($Open) { Invoke-Item $out }
