# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
# Installs KrakenDial to %LOCALAPPDATA%\krakendial, adds it to the Start menu and starts it now and at
# every logon. No admin needed.
#
# From a clone with Rust installed it builds the exe; anywhere else it downloads the latest release:
#   irm https://raw.githubusercontent.com/kleju13/krakendial/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$github = 'kleju13/krakendial'
$dir = Join-Path $env:LOCALAPPDATA 'krakendial'
$exe = Join-Path $dir 'krakendial.exe'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$repo = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { '' }
$fromSource = $repo -and (Test-Path (Join-Path $repo 'Cargo.toml')) -and (Get-Command cargo -ErrorAction SilentlyContinue)

if ($fromSource) {
    cargo build --release --manifest-path (Join-Path $repo 'Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }
    $built = Join-Path $repo 'target\release\krakendial.exe'
} else {
    $release = Invoke-RestMethod "https://api.github.com/repos/$github/releases/latest" -Headers @{ 'User-Agent' = 'krakendial-install' } -UseBasicParsing
    $asset = $release.assets | Where-Object { $_.name -eq 'krakendial.exe' } | Select-Object -First 1
    $sum = $release.assets | Where-Object { $_.name -eq 'krakendial.exe.sha256' } | Select-Object -First 1
    if (-not $asset -or -not $sum) { throw "release $($release.tag_name) has no krakendial.exe" }
    Write-Host "Downloading KrakenDial $($release.tag_name)..."
    $built = Join-Path $env:TEMP 'krakendial.exe'
    Invoke-WebRequest $asset.browser_download_url -OutFile $built -UseBasicParsing
    # Saved to a file: .Content of an octet-stream download is bytes, not text.
    Invoke-WebRequest $sum.browser_download_url -OutFile "$built.sha256" -UseBasicParsing
    $want = ((Get-Content "$built.sha256" -Raw) -split '\s+')[0]
    $have = (Get-FileHash $built -Algorithm SHA256).Hash
    if ($have -ne $want) { Remove-Item $built; throw "download does not match its checksum ($have, expected $want)" }
    Unblock-File $built
}

Get-Process krakendial, krakenlcd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 300

# Earlier versions were called krakenlcd: keep their settings, faces and media.
$old = Join-Path $env:LOCALAPPDATA 'krakenlcd'
if ((Test-Path $old) -and -not (Test-Path $dir)) {
    Move-Item $old $dir
    Remove-Item (Join-Path $dir 'krakenlcd.exe') -ErrorAction SilentlyContinue
}
Remove-ItemProperty $run -Name 'KrakenLCD' -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item $built $exe -Force
Set-ItemProperty $run -Name 'KrakenDial' -Value "`"$exe`""
# Start menu entry: starts KrakenDial after Quit, and brings back a hidden tray icon
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'KrakenDial.lnk'))
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $dir
$shortcut.Description = 'The dial for the NZXT Kraken Elite LCD'
$shortcut.Save()
Start-Process $exe

Write-Host "Installed: $exe (starts at every logon, and from the Start menu)"
Write-Host 'Its icon is in the tray: click it for the status and the address.'
Write-Host 'URL for NZXT CAM Web Integration: http://127.0.0.1:30640/  (CAM''s Configure button opens the settings)'
Write-Host 'Face editor: http://127.0.0.1:30640/editor'
Write-Host 'Preview in a browser: http://127.0.0.1:30640/lcd?mock'
