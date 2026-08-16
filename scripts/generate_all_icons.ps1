Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\SSK\.gemini\antigravity-ide\brain\6c0a1502-f541-4fce-bfc3-a96f6402f1d1\.user_uploaded\media_1786904619795.jpg"
$baseDir = "c:\HaulBoX\haulbox-restored\Faisal"

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source image not found at $sourcePath"
    exit 1
}

$srcImage = [System.Drawing.Image]::FromFile($sourcePath)

function Save-ResizedImage {
    param(
        [System.Drawing.Image]$Image,
        [int]$Width,
        [int]$Height,
        [string]$TargetPath
    )
    $dir = [System.IO.Path]::GetDirectoryName($TargetPath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $destRect = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
    $destImage = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    
    $graphics = [System.Drawing.Graphics]::FromImage($destImage)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $graphics.DrawImage($Image, $destRect, 0, 0, $Image.Width, $Image.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()

    # If target is ICO, save as PNG internally or convert
    $destImage.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destImage.Dispose()
    Write-Host "Generated: $TargetPath ($Width x $Height)"
}

# 1. Public assets (Web App)
Save-ResizedImage -Image $srcImage -Width 1024 -Height 1024 -TargetPath "$baseDir\public\assets\haulbox-logo-full.png"
Save-ResizedImage -Image $srcImage -Width 512 -Height 512 -TargetPath "$baseDir\public\assets\haulbox-logo-icon.png"
Save-ResizedImage -Image $srcImage -Width 1024 -Height 1024 -TargetPath "$baseDir\public\assets\haulbox-3d-dice-hero.png"

# Public favicon
Save-ResizedImage -Image $srcImage -Width 64 -Height 64 -TargetPath "$baseDir\public\favicon.png"

# 2. Capacitor Android assets
Save-ResizedImage -Image $srcImage -Width 1024 -Height 1024 -TargetPath "$baseDir\android\app\src\main\assets\public\assets\haulbox-logo-full.png"
Save-ResizedImage -Image $srcImage -Width 512 -Height 512 -TargetPath "$baseDir\android\app\src\main\assets\public\assets\haulbox-logo-icon.png"
Save-ResizedImage -Image $srcImage -Width 1024 -Height 1024 -TargetPath "$baseDir\android\app\src\main\assets\public\assets\haulbox-3d-dice-hero.png"

# 3. Capacitor iOS assets
Save-ResizedImage -Image $srcImage -Width 1024 -Height 1024 -TargetPath "$baseDir\ios\App\App\public\assets\haulbox-logo-full.png"
Save-ResizedImage -Image $srcImage -Width 512 -Height 512 -TargetPath "$baseDir\ios\App\App\public\assets\haulbox-logo-icon.png"
Save-ResizedImage -Image $srcImage -Width 1024 -Height 1024 -TargetPath "$baseDir\ios\App\App\public\assets\haulbox-3d-dice-hero.png"

# 4. Flutter Web Assets
Save-ResizedImage -Image $srcImage -Width 32 -Height 32 -TargetPath "$baseDir\haulbox_app\web\favicon.png"
Save-ResizedImage -Image $srcImage -Width 192 -Height 192 -TargetPath "$baseDir\haulbox_app\web\icons\Icon-192.png"
Save-ResizedImage -Image $srcImage -Width 512 -Height 512 -TargetPath "$baseDir\haulbox_app\web\icons\Icon-512.png"
Save-ResizedImage -Image $srcImage -Width 192 -Height 192 -TargetPath "$baseDir\haulbox_app\web\icons\Icon-maskable-192.png"
Save-ResizedImage -Image $srcImage -Width 512 -Height 512 -TargetPath "$baseDir\haulbox_app\web\icons\Icon-maskable-512.png"

# 5. Android Mipmap Icons (Both Flutter haulbox_app and Capacitor android)
$androidSizes = @{
    'mipmap-mdpi' = 48
    'mipmap-hdpi' = 72
    'mipmap-xhdpi' = 96
    'mipmap-xxhdpi' = 144
    'mipmap-xxxhdpi' = 192
}

foreach ($folder in $androidSizes.Keys) {
    $size = $androidSizes[$folder]
    
    # Flutter app
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\haulbox_app\android\app\src\main\res\$folder\ic_launcher.png"
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\haulbox_app\android\app\src\main\res\$folder\ic_launcher_round.png"
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\haulbox_app\android\app\src\main\res\$folder\ic_launcher_foreground.png"

    # Capacitor android
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\android\app\src\main\res\$folder\ic_launcher.png"
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\android\app\src\main\res\$folder\ic_launcher_round.png"
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\android\app\src\main\res\$folder\ic_launcher_foreground.png"
}

# 6. iOS App Icons (Flutter haulbox_app)
$iosIcons = @{
    'Icon-App-1024x1024@1x.png' = 1024
    'Icon-App-83.5x83.5@2x.png' = 167
    'Icon-App-76x76@2x.png' = 152
    'Icon-App-76x76@1x.png' = 76
    'Icon-App-60x60@3x.png' = 180
    'Icon-App-60x60@2x.png' = 120
    'Icon-App-40x40@3x.png' = 120
    'Icon-App-40x40@2x.png' = 80
    'Icon-App-40x40@1x.png' = 40
    'Icon-App-29x29@3x.png' = 87
    'Icon-App-29x29@2x.png' = 58
    'Icon-App-29x29@1x.png' = 29
    'Icon-App-20x20@3x.png' = 60
    'Icon-App-20x20@2x.png' = 40
    'Icon-App-20x20@1x.png' = 20
}

foreach ($fileName in $iosIcons.Keys) {
    $size = $iosIcons[$fileName]
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\haulbox_app\ios\Runner\Assets.xcassets\AppIcon.appiconset\$fileName"
}

# 7. macOS Flutter app icons
$macosIcons = @{
    'app_icon_1024.png' = 1024
    'app_icon_512.png' = 512
    'app_icon_256.png' = 256
    'app_icon_128.png' = 128
    'app_icon_64.png' = 64
    'app_icon_32.png' = 32
    'app_icon_16.png' = 16
}

foreach ($fileName in $macosIcons.Keys) {
    $size = $macosIcons[$fileName]
    Save-ResizedImage -Image $srcImage -Width $size -Height $size -TargetPath "$baseDir\haulbox_app\macos\Runner\Assets.xcassets\AppIcon.appiconset\$fileName"
}

$srcImage.Dispose()
Write-Host "All icons generated successfully!"
