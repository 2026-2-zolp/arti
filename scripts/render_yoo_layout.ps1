param(
    [string]$InputFile = (Join-Path $PSScriptRoot '../docs/execution-plan/2026-11-07/records/W06/readiness/layout-draft.json'),
    [string]$OutputFile = (Join-Path $PSScriptRoot '../docs/execution-plan/2026-11-07/records/W06/readiness/layout-draft.png')
)
# 작품 이미지를 사용하지 않고 시연 구획·식별번호 배치 초안을 그립니다. 실제 도면이 아닙니다.
Add-Type -AssemblyName System.Drawing
$layoutData = Get-Content -LiteralPath $InputFile -Raw -Encoding utf8 | ConvertFrom-Json
$bitmap = [System.Drawing.Bitmap]::new(1600, 1100)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::White)
$titleFont = [System.Drawing.Font]::new('Malgun Gothic', 26, [System.Drawing.FontStyle]::Bold)
$zoneFont = [System.Drawing.Font]::new('Malgun Gothic', 17, [System.Drawing.FontStyle]::Bold)
$labelFont = [System.Drawing.Font]::new('Malgun Gothic', 12)
$smallFont = [System.Drawing.Font]::new('Malgun Gothic', 14)
$numberFont = [System.Drawing.Font]::new('Malgun Gothic', 16, [System.Drawing.FontStyle]::Bold)
$inkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#18334b'))
$linePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#aebdca'), 2)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$zoneBrushes = @{}
try {
    $graphics.DrawString('ARTI 유영국 16점 · 시연 구성안', $titleFont, $inkBrush, 70, 30)
    $graphics.DrawString('독자 재구성 초안입니다. 실제 전시장·출품 배치·보행 경로를 뜻하지 않습니다.', $smallFont, $inkBrush, 73, 98)
    $zoneColors = @{ A = '#eef2f8'; B = '#fff5df'; C = '#eaf6f1' }
    $leftEdges = @{ A = 8; B = 38; C = 68 }
    foreach ($zone in $layoutData.zones) {
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($zoneColors[$zone.id]))
        $zoneBrushes[$zone.id] = $brush
        $rect = [System.Drawing.RectangleF]::new((100 + 14 * $leftEdges[$zone.id]), 180, 336, 620)
        $graphics.FillRectangle($brush, $rect)
        $graphics.DrawRectangle($linePen, $rect.X, $rect.Y, $rect.Width, $rect.Height)
        $head = [System.Drawing.RectangleF]::new($rect.X, 195, $rect.Width, 50)
        $graphics.DrawString(($zone.id + ' · ' + $zone.name), $zoneFont, $inkBrush, $head, $format)
    }
    foreach ($work in $layoutData.items) {
        $pointX = 100 + 14 * $work.x
        $pointY = 180 + 7.5 * $work.y
        $circle = [System.Drawing.RectangleF]::new(($pointX - 23), ($pointY - 23), 46, 46)
        $graphics.FillEllipse([System.Drawing.Brushes]::White, $circle)
        $graphics.DrawEllipse($linePen, $circle)
        $shortId = $work.id.Substring($work.id.Length - 2)
        $graphics.DrawString($shortId, $numberFont, $inkBrush, $circle, $format)
        $label = $work.title -replace '\s*\(도상 후보\)', ' (도상)'
        $labelRect = [System.Drawing.RectangleF]::new(($pointX - 81), ($pointY + 27), 162, 54)
        $graphics.DrawString($label, $labelFont, $inkBrush, $labelRect, $format)
    }
    $graphics.DrawString('입구 후보', $zoneFont, $inkBrush, [System.Drawing.RectangleF]::new(650, 865, 300, 50), $format)
    $graphics.DrawString('번호는 작품 인수 ID를 가리킵니다. 색 구획은 감상 주제를 나눈 초안입니다.', $smallFont, $inkBrush, 73, 977)
    $graphics.DrawString('실제 거리·벽·문·통로가 없으므로 이동시간이나 최적 보행 경로를 계산하는 도면이 아닙니다.', $smallFont, $inkBrush, 73, 1023)
    $bitmap.Save([System.IO.Path]::GetFullPath($OutputFile), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    foreach ($brush in $zoneBrushes.Values) { $brush.Dispose() }
    $format.Dispose(); $linePen.Dispose(); $inkBrush.Dispose()
    $titleFont.Dispose(); $zoneFont.Dispose(); $labelFont.Dispose(); $smallFont.Dispose(); $numberFont.Dispose()
    $graphics.Dispose(); $bitmap.Dispose()
}
