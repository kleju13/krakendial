# Stops krakenlcd and removes the autostart entry. Settings and history in %LOCALAPPDATA%\krakenlcd stay
# unless -Purge is given.
param([switch]$Purge)
Get-Process krakenlcd -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'KrakenLCD' -ErrorAction SilentlyContinue
if ($Purge) { Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'krakenlcd') -ErrorAction SilentlyContinue }
Write-Host 'KrakenLCD uninstalled.'
