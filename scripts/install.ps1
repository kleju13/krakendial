# Builds krakenlcd, installs it to %LOCALAPPDATA%\krakenlcd and starts it at every logon (no admin needed).
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $env:LOCALAPPDATA 'krakenlcd'
$exe = Join-Path $dir 'krakenlcd.exe'

cargo build --release --manifest-path (Join-Path $repo 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }

Get-Process krakenlcd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 300
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $repo 'target\release\krakenlcd.exe') $exe -Force

Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'KrakenLCD' -Value "`"$exe`""
Start-Process $exe

Write-Host "Zainstalowano: $exe (autostart przy logowaniu)"
Write-Host 'Adres dla NZXT CAM: http://127.0.0.1:30640/'
Write-Host 'Wybór stylu:        http://127.0.0.1:30640/settings'
