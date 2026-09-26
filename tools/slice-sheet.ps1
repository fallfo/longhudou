# 把一整张「龍虎鬥遊戲牌」画片切成 16 张小卡图（tools/tiles/card01.jpg ... card16.jpg）
#
# 用法：把画片另存为 $PSScriptRoot\..\sheet.jpg，然后在 PowerShell 里执行：
#   Invoke-Expression (Get-Content -Raw -Encoding UTF8 .\tools\slice-sheet.ps1)
# （Windows 默认禁止运行 .ps1，所以用 Invoke-Expression 绕过执行策略）
#
# 原理：自动识别「整行/整列几乎全是米黄背景」的空隙，据此定位 4×4 卡片网格，再逐张裁剪、缩放、存 JPEG。
Add-Type -AssemblyName System.Drawing

$root = if($env:LONGHUDOU_ROOT){ $env:LONGHUDOU_ROOT }
        elseif($PSScriptRoot){ Split-Path -Parent $PSScriptRoot }
        else { 'D:\workspace\longhudou' }
$sheet = if($env:LONGHUDOU_SHEET){ $env:LONGHUDOU_SHEET } else { Join-Path $root 'sheet.jpg' }
$outDir = Join-Path $root 'tools\tiles'

if(-not (Test-Path $sheet)){
  Write-Host "找不到画片：$sheet`n请先把画片另存为 sheet.jpg，或用环境变量 LONGHUDOU_SHEET 指定路径。"
  exit 1
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bmp = [System.Drawing.Bitmap]::FromFile($sheet)
$w = $bmp.Width
$h = $bmp.Height
Write-Host ("SOURCE {0}x{1}" -f $w, $h)

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$d = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$stride = $d.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($d)
$TH = 190

# ---- 行：整行浅色比例 ----
$rl = [double[]]::new($h)
$y = 0
while($y -lt $h){
  $rowOff = $y * $stride
  $light = 0
  $n = 0
  $x = 0
  while($x -lt $w){
    $i = $rowOff + $x * 3
    $lum = ($bytes[$i] + $bytes[$i + 1] + $bytes[$i + 2]) / 3.0
    if($lum -gt $TH){ $light = $light + 1 }
    $n = $n + 1
    $x = $x + 2
  }
  $f = $light / [double]$n
  $rl[$y] = $f
  if(($y + 1) -lt $h){ $rl[$y + 1] = $f }
  $y = $y + 2
}

$gaps = New-Object System.Collections.ArrayList
$inGap = $false
$start = 0
for($y = 0; $y -lt $h; $y++){
  $isGap = $rl[$y] -gt 0.80
  if($isGap -and (-not $inGap)){ $inGap = $true; $start = $y }
  elseif((-not $isGap) -and $inGap){ $inGap = $false; [void]$gaps.Add(@($start, ($y - 1))) }
}
if($inGap){ [void]$gaps.Add(@($start, ($h - 1))) }

$rowBands = New-Object System.Collections.ArrayList
$prevEnd = -1
foreach($g in $gaps){
  $s = $prevEnd + 1
  $e = $g[0] - 1
  if(($e - $s) -gt 80){ [void]$rowBands.Add(@($s, $e)) }
  $prevEnd = $g[1]
}
if((($h - 1) - $prevEnd) -gt 80){ [void]$rowBands.Add(@(($prevEnd + 1), ($h - 1))) }
if($rowBands.Count -gt 4){
  $keep = $rowBands.Count - 4
  $rowBands = $rowBands[$keep..($rowBands.Count - 1)]
}
Write-Host ("ROWBANDS " + (($rowBands | ForEach-Object { "$($_[0])-$($_[1])" }) -join ', '))

# ---- 列：只在卡片行区域内统计 ----
$yTop = $rowBands[0][0]
$yBot = $rowBands[$rowBands.Count - 1][1]
$cl = [double[]]::new($w)
$x = 0
while($x -lt $w){
  $light = 0
  $n = 0
  $y2 = $yTop
  while($y2 -le $yBot){
    $i = $y2 * $stride + $x * 3
    $lum = ($bytes[$i] + $bytes[$i + 1] + $bytes[$i + 2]) / 3.0
    if($lum -gt $TH){ $light = $light + 1 }
    $n = $n + 1
    $y2 = $y2 + 2
  }
  $f = $light / [double]$n
  $cl[$x] = $f
  if(($x + 1) -lt $w){ $cl[$x + 1] = $f }
  $x = $x + 2
}
$colGaps = New-Object System.Collections.ArrayList
$inGap = $false
$start = 0
for($x = 0; $x -lt $w; $x++){
  $isGap = $cl[$x] -gt 0.80
  if($isGap -and (-not $inGap)){ $inGap = $true; $start = $x }
  elseif((-not $isGap) -and $inGap){ $inGap = $false; [void]$colGaps.Add(@($start, ($x - 1))) }
}
if($inGap){ [void]$colGaps.Add(@($start, ($w - 1))) }
$colBands = New-Object System.Collections.ArrayList
$prevEnd = -1
foreach($g in $colGaps){
  $s = $prevEnd + 1
  $e = $g[0] - 1
  if(($e - $s) -gt 80){ [void]$colBands.Add(@($s, $e)) }
  $prevEnd = $g[1]
}
if((($w - 1) - $prevEnd) -gt 80){ [void]$colBands.Add(@(($prevEnd + 1), ($w - 1))) }
Write-Host ("COLBANDS " + (($colBands | ForEach-Object { "$($_[0])-$($_[1])" }) -join ', '))

if(($rowBands.Count -ne 4) -or ($colBands.Count -ne 4)){
  Write-Host 'ABORT: 没识别出 4x4 网格（画片排版不同的话，需要手工指定行列范围）'
  $bmp.Dispose()
  exit 1
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]72)
$targetW = 180

# 统一宽高比：取四列/四行的平均卡片比例作为目标，把每张卡“补”到同一比例
# （只往背景方向扩，画面本身不裁不拉伸，所以卡片保持原来的竖版比例）
$wSum = 0
for($c = 0; $c -lt 4; $c++){ $wSum += ($colBands[$c][1] - $colBands[$c][0] + 1) }
$hSum = 0
for($r = 0; $r -lt 4; $r++){ $hSum += ($rowBands[$r][1] - $rowBands[$r][0] + 1) }
$targetAspect = ($wSum / 4.0) / ($hSum / 4.0)
Write-Host ("TARGET ASPECT {0:0.0000} (w/h)" -f $targetAspect)

for($r = 0; $r -lt 4; $r++){
  for($c = 0; $c -lt 4; $c++){
    $num = $r * 4 + $c + 1
    $sx = $colBands[$c][0]
    $sy = $rowBands[$r][0]
    $cw = $colBands[$c][1] - $sx + 1
    $ch = $rowBands[$r][1] - $sy + 1

    $aspect = $cw / [double]$ch
    if($aspect -lt $targetAspect){
      $need = [int][Math]::Ceiling($ch * $targetAspect) - $cw
      $left = [int][Math]::Floor($need / 2)
      $right = $need - $left
      if((($sx - $left) -ge 0) -and (($sx + $cw + $right) -le $w)){ $sx = $sx - $left; $cw = $cw + $need }
    } elseif($aspect -gt $targetAspect){
      $need = [int][Math]::Ceiling($cw / $targetAspect) - $ch
      $top = [int][Math]::Floor($need / 2)
      $bottom = $need - $top
      if((($sy - $top) -ge 0) -and (($sy + $ch + $bottom) -le $h)){ $sy = $sy - $top; $ch = $ch + $need }
    }

    $crop = $bmp.Clone((New-Object System.Drawing.Rectangle($sx, $sy, $cw, $ch)), $bmp.PixelFormat)
    $th = [int][Math]::Round($targetW * $ch / [double]$cw)
    $dst = New-Object System.Drawing.Bitmap($targetW, $th)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($crop, (New-Object System.Drawing.Rectangle(0, 0, $targetW, $th)))
    $g.Dispose()
    $crop.Dispose()
    $out = Join-Path $outDir ('card{0:d2}.jpg' -f $num)
    $dst.Save($out, $codec, $ep)
    $dst.Dispose()
    Write-Host ("TILE {0:d2} {1},{2} {3}x{4} -> {5}x{6}" -f $num, $sx, $sy, $cw, $ch, $targetW, $th)
  }
}
$bmp.Dispose()
$total = (Get-ChildItem (Join-Path $outDir 'card*.jpg') | Measure-Object -Property Length -Sum).Sum
Write-Host ("DONE 共 16 张，合计 {0} KB，输出在 {1}" -f [int]($total / 1KB), $outDir)
