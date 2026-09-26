# 把一整张「龙虎斗」画片切成 16 张小卡图（tools/tiles/card01.jpg ... card16.jpg）
#
# 关键点：切出来的文件名是「牌号」而不是「格子位置」——因为不同画片的排列顺序不一样。
# 排列映射通过 LONGHUDOU_LAYOUT 传入（按阅读顺序列出每格是哪一号牌）。
#
# 用法（Windows 默认禁止跑 .ps1，所以用 Invoke-Expression 绕过执行策略）：
#   $env:LONGHUDOU_ROOT   = 'D:\workspace\longhudou'
#   $env:LONGHUDOU_SHEET  = 'D:\workspace\longhudou\tools\sheet-new.png'
#   $env:LONGHUDOU_LAYOUT = '14,9,16,4,2,12,6,15,8,11,5,1,3,13,7,10'
#   Invoke-Expression (Get-Content -Raw -Encoding UTF8 .\tools\slice-sheet.ps1)
#
# 可选：LONGHUDOU_OUT（输出目录，默认 tools\tiles）、LONGHUDOU_GAP（背景判定阈值 0~1，默认 0.94）、
#       LONGHUDOU_W（输出宽度，默认 180）、LONGHUDOU_MONTAGE=1（额外输出一张按牌号排列的核对图）
Add-Type -AssemblyName System.Drawing

$root = if($env:LONGHUDOU_ROOT){ $env:LONGHUDOU_ROOT }
        elseif($PSScriptRoot){ Split-Path -Parent $PSScriptRoot }
        else { 'D:\workspace\longhudou' }
$sheet = if($env:LONGHUDOU_SHEET){ $env:LONGHUDOU_SHEET } else { Join-Path $root 'sheet.jpg' }
$outDir = if($env:LONGHUDOU_OUT){ $env:LONGHUDOU_OUT } else { Join-Path $root 'tools\tiles' }
$gapFrac = if($env:LONGHUDOU_GAP){ [double]$env:LONGHUDOU_GAP } else { 0.94 }
$targetW = if($env:LONGHUDOU_W){ [int]$env:LONGHUDOU_W } else { 180 }
$layout = if($env:LONGHUDOU_LAYOUT){ $env:LONGHUDOU_LAYOUT -split ',' | ForEach-Object { [int]$_.Trim() } }
          else { 1..16 }

if($layout.Count -ne 16){ Write-Host "LONGHUDOU_LAYOUT 必须正好 16 个牌号"; exit 1 }
if(-not (Test-Path $sheet)){ Write-Host "找不到画片：$sheet"; exit 1 }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bmp = [System.Drawing.Bitmap]::FromFile($sheet)
$w = $bmp.Width
$h = $bmp.Height
Write-Host ("SOURCE {0}x{1}  输出 {2}  gap={3}  width={4}" -f $w, $h, $outDir, $gapFrac, $targetW)

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$d = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$stride = $d.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($d)
$TH = 232                                  # 背景（白/米黄）亮度下限

# ---- 行：整行浅色比例 ----
$rl = [double[]]::new($h)
$y = 0
while($y -lt $h){
  $off = $y * $stride
  $light = 0; $n = 0; $x = 0
  while($x -lt $w){
    $i = $off + $x * 3
    if((($bytes[$i] + $bytes[$i+1] + $bytes[$i+2]) / 3.0) -gt $TH){ $light++ }
    $n++; $x += 2
  }
  $f = $light / [double]$n
  $rl[$y] = $f
  if(($y + 1) -lt $h){ $rl[$y + 1] = $f }
  $y += 2
}
$gaps = New-Object System.Collections.ArrayList
$inGap = $false; $start = 0
for($y = 0; $y -lt $h; $y++){
  $isGap = $rl[$y] -gt $gapFrac
  if($isGap -and (-not $inGap)){ $inGap = $true; $start = $y }
  elseif((-not $isGap) -and $inGap){ $inGap = $false; [void]$gaps.Add(@($start, ($y - 1))) }
}
if($inGap){ [void]$gaps.Add(@($start, ($h - 1))) }
$rowBands = New-Object System.Collections.ArrayList
$prevEnd = -1
foreach($g in $gaps){
  $s = $prevEnd + 1; $e = $g[0] - 1
  if(($e - $s) -gt 80){ [void]$rowBands.Add(@($s, $e)) }
  $prevEnd = $g[1]
}
if((($h - 1) - $prevEnd) -gt 80){ [void]$rowBands.Add(@(($prevEnd + 1), ($h - 1))) }
if($rowBands.Count -gt 4){ $keep = $rowBands.Count - 4; $rowBands = $rowBands[$keep..($rowBands.Count - 1)] }
Write-Host ("ROWBANDS " + (($rowBands | ForEach-Object { "$($_[0])-$($_[1])" }) -join ', '))

# ---- 列：只在卡片行区域内统计 ----
$yTop = $rowBands[0][0]; $yBot = $rowBands[$rowBands.Count - 1][1]
$cl = [double[]]::new($w)
$x = 0
while($x -lt $w){
  $light = 0; $n = 0; $y2 = $yTop
  while($y2 -le $yBot){
    $i = $y2 * $stride + $x * 3
    if((($bytes[$i] + $bytes[$i+1] + $bytes[$i+2]) / 3.0) -gt $TH){ $light++ }
    $n++; $y2 += 2
  }
  $f = $light / [double]$n
  $cl[$x] = $f
  if(($x + 1) -lt $w){ $cl[$x + 1] = $f }
  $x += 2
}
$colGaps = New-Object System.Collections.ArrayList
$inGap = $false; $start = 0
for($x = 0; $x -lt $w; $x++){
  $isGap = $cl[$x] -gt $gapFrac
  if($isGap -and (-not $inGap)){ $inGap = $true; $start = $x }
  elseif((-not $isGap) -and $inGap){ $inGap = $false; [void]$colGaps.Add(@($start, ($x - 1))) }
}
if($inGap){ [void]$colGaps.Add(@($start, ($w - 1))) }
$colBands = New-Object System.Collections.ArrayList
$prevEnd = -1
foreach($g in $colGaps){
  $s = $prevEnd + 1; $e = $g[0] - 1
  if(($e - $s) -gt 80){ [void]$colBands.Add(@($s, $e)) }
  $prevEnd = $g[1]
}
if((($w - 1) - $prevEnd) -gt 80){ [void]$colBands.Add(@(($prevEnd + 1), ($w - 1))) }
Write-Host ("COLBANDS " + (($colBands | ForEach-Object { "$($_[0])-$($_[1])" }) -join ', '))

if(($rowBands.Count -ne 4) -or ($colBands.Count -ne 4)){
  Write-Host 'ABORT: 没识别出 4x4 网格（可调 LONGHUDOU_GAP 阈值）'
  $bmp.Dispose(); exit 1
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]78)

# 统一宽高比（只往背景补，不裁画面）
$wSum = 0; for($c = 0; $c -lt 4; $c++){ $wSum += ($colBands[$c][1] - $colBands[$c][0] + 1) }
$hSum = 0; for($r = 0; $r -lt 4; $r++){ $hSum += ($rowBands[$r][1] - $rowBands[$r][0] + 1) }
$targetAspect = ($wSum / 4.0) / ($hSum / 4.0)
Write-Host ("TARGET ASPECT {0:0.0000} (w/h)" -f $targetAspect)

$made = @{}
for($r = 0; $r -lt 4; $r++){
  for($c = 0; $c -lt 4; $c++){
    $num = $layout[$r * 4 + $c]
    $sx = $colBands[$c][0]; $sy = $rowBands[$r][0]
    $cw = $colBands[$c][1] - $sx + 1; $ch = $rowBands[$r][1] - $sy + 1
    $aspect = $cw / [double]$ch
    if($aspect -lt $targetAspect){
      $need = [int][Math]::Ceiling($ch * $targetAspect) - $cw
      $left = [int][Math]::Floor($need / 2); $right = $need - $left
      if((($sx - $left) -ge 0) -and (($sx + $cw + $right) -le $w)){ $sx -= $left; $cw += $need }
    } elseif($aspect -gt $targetAspect){
      $need = [int][Math]::Ceiling($cw / $targetAspect) - $ch
      $top = [int][Math]::Floor($need / 2); $bottom = $need - $top
      if((($sy - $top) -ge 0) -and (($sy + $ch + $bottom) -le $h)){ $sy -= $top; $ch += $need }
    }
    $crop = $bmp.Clone((New-Object System.Drawing.Rectangle($sx, $sy, $cw, $ch)), $bmp.PixelFormat)
    $th = [int][Math]::Round($targetW * $ch / [double]$cw)
    $dst = New-Object System.Drawing.Bitmap($targetW, $th)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($crop, (New-Object System.Drawing.Rectangle(0, 0, $targetW, $th)))
    $g.Dispose(); $crop.Dispose()
    $out = Join-Path $outDir ('card{0:d2}.jpg' -f $num)
    $dst.Save($out, $codec, $ep)
    $dst.Dispose()
    $made[$num] = $out
    Write-Host ("TILE 位置({0},{1}) -> 牌 {2:d2}  {3},{4} {5}x{6}" -f ($r+1), ($c+1), $num, $sx, $sy, $cw, $ch)
  }
}
$bmp.Dispose()

# 按牌号拼一张核对图（带牌号标注）
$missing = (1..16) | Where-Object { -not $made.ContainsKey($_) }
if($missing){ Write-Host ("WARN 缺少牌号: " + ($missing -join ',')) }
if($env:LONGHUDOU_MONTAGE -eq '1'){
  $first = [System.Drawing.Bitmap]::FromFile($made[1])
  $tw = $first.Width; $thh = $first.Height; $first.Dispose()
  $pad = 6
  $montage = New-Object System.Drawing.Bitmap((4 * $tw + 5 * $pad), (4 * $thh + 5 * $pad))
  $mg = [System.Drawing.Graphics]::FromImage($montage)
  $mg.Clear([System.Drawing.Color]::FromArgb(245, 245, 245))
  $font = New-Object System.Drawing.Font('Arial', 16, [System.Drawing.FontStyle]::Bold)
  for($i = 0; $i -lt 16; $i++){
    $num = $i + 1
    $b = [System.Drawing.Bitmap]::FromFile($made[$num])
    $rr = [Math]::Floor($i / 4); $cc = $i % 4
    $px = $pad + $cc * ($tw + $pad); $py = $pad + $rr * ($thh + $pad)
    $mg.DrawImage($b, $px, $py, $tw, $thh)
    $mg.DrawString($num.ToString(), $font, [System.Drawing.Brushes]::Red, ($px + 4), ($py + 2))
    $b.Dispose()
  }
  $mg.Dispose()
  $mp = Join-Path $outDir 'montage.png'
  $montage.Save($mp, [System.Drawing.Imaging.ImageFormat]::Png)
  $montage.Dispose()
  Write-Host ("MONTAGE " + $mp)
}
$total = (Get-ChildItem (Join-Path $outDir 'card*.jpg') | Measure-Object -Property Length -Sum).Sum
Write-Host ("DONE 16 张，合计 {0} KB" -f [int]($total / 1KB))
