Write-Host "Starting Flutter download via BITS (reliable)..."
$url = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.32.5-stable.zip"
$dest = "C:\src\flutter.zip"

# Use BITS transfer - much more reliable than Invoke-WebRequest
Start-BitsTransfer -Source $url -Destination $dest -DisplayName "Flutter SDK Download" -Description "Downloading Flutter 3.32.5"

$size = (Get-Item $dest).Length / 1MB
Write-Host "Download complete! Size: $([math]::Round($size, 1)) MB"
