# assemble.ps1 — frames → optimized GIF (+ optional MP4)
# Usage: .\assemble.ps1 <scenarioDirName> [-mp4]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [switch]$Mp4,
  [int]$Fps = 12,
  [int]$Width = 960
)
$ErrorActionPreference = "Stop"
$root = "D:\dsh-plugins\dsh-skin-matrix-rain\shots"
$dir = Join-Path $root $Name
if (-not (Test-Path $dir)) { Write-Error "no shots dir: $dir"; exit 1 }
$ffmpeg = "D:\tools\ffmpeg\bin\ffmpeg.exe"
$gif = Join-Path $root "$Name.gif"
$mp4 = Join-Path $root "$Name.mp4"

# 两段式:palettegen(palette 统计)→ paletteuse,颜色质量最好
& $ffmpeg -y -hide_banner -loglevel error `
  -framerate $Fps -i (Join-Path $dir "f%04d.jpg") `
  -vf "fps=$Fps,scale=${Width}:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" `
  -loop 0 $gif
Write-Host "GIF: $gif ($([Math]::Round((Get-Item $gif).Length/1MB, 2)) MB)"

if ($Mp4) {
  & $ffmpeg -y -hide_banner -loglevel error `
    -framerate $Fps -i (Join-Path $dir "f%04d.jpg") `
    -vf "fps=$Fps,scale=${Width}:-2:flags=lanczos" `
    -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart $mp4
  Write-Host "MP4: $mp4 ($([Math]::Round((Get-Item $mp4).Length/1MB, 2)) MB)"
}
