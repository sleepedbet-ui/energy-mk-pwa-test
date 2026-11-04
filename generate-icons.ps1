Add-Type -AssemblyName System.Drawing

$sizes = @(192, 512)
$dir = "C:\Users\Adadawsda\.gemini\antigravity\scratch\energy-mk-pwa\icons"

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 76, 140))
    $g.FillRectangle($brush, 0, 0, $size, $size)
    $brush.Dispose()

    # Lightning Bolt
    $gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250, 204, 21))
    $points = @(
        New-Object System.Drawing.PointF ($size * 0.55), ($size * 0.16)
        New-Object System.Drawing.PointF ($size * 0.31), ($size * 0.53)
        New-Object System.Drawing.PointF ($size * 0.51), ($size * 0.53)
        New-Object System.Drawing.PointF ($size * 0.45), ($size * 0.84)
        New-Object System.Drawing.PointF ($size * 0.72), ($size * 0.47)
        New-Object System.Drawing.PointF ($size * 0.52), ($size * 0.47)
    )
    $g.FillPolygon($gold, $points)
    $gold.Dispose()

    $g.Dispose()
    $outPath = Join-Path $dir "icon-$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated $outPath"
}
