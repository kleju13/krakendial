# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
# Stops KrakenDial and removes the autostart entry and the Start menu entry. Settings, faces and media in %LOCALAPPDATA%\krakendial
# stay unless -Purge is given.
param([switch]$Purge)
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Get-Process krakendial, krakenlcd -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-ItemProperty $run -Name 'KrakenDial' -ErrorAction SilentlyContinue
Remove-ItemProperty $run -Name 'KrakenLCD' -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'KrakenDial.lnk') -ErrorAction SilentlyContinue
if ($Purge) {
    Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'krakendial') -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'krakenlcd') -ErrorAction SilentlyContinue
}
Write-Host 'KrakenDial uninstalled.'
