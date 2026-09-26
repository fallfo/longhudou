# 把 tools/tiles/card01..16.jpg 转成 base64 并注入 index.html 的 /*==ART_DATA==*/ 占位符
#
# 用法（在仓库根目录）：
#   $env:LONGHUDOU_ROOT = 'D:\workspace\longhudou'
#   Invoke-Expression (Get-Content -Raw -Encoding UTF8 .\tools\embed-art.ps1)
#
# 说明：源文件是 tools/index.template.html（带 /*==ART_DATA==*/ 占位符），
#       生成物是根目录的 index.html（单文件、离线可玩，体积约 350KB）。
#       改完模板后重跑本脚本即可。
$ErrorActionPreference = 'Stop'
$root = if($env:LONGHUDOU_ROOT){ $env:LONGHUDOU_ROOT }
        elseif($PSScriptRoot){ Split-Path -Parent $PSScriptRoot }
        else { 'D:\workspace\longhudou' }
$templatePath = Join-Path $root 'tools\index.template.html'
$outPath = Join-Path $root 'index.html'
$tileDir = Join-Path $root 'tools\tiles'
$ids = @('D1','D2','D3','D4','D5','D6','D7','D8','T1','T2','T3','T4','T5','T6','T7','T8')

if(-not (Test-Path $templatePath)){ Write-Host "找不到模板 $templatePath"; exit 1 }
if(-not (Test-Path $tileDir)){ Write-Host "找不到 $tileDir，请先跑 tools\slice-sheet.ps1"; exit 1 }

$parts = New-Object System.Collections.ArrayList
for($i = 0; $i -lt 16; $i++){
  $f = Join-Path $tileDir ('card{0:d2}.jpg' -f ($i + 1))
  if(-not (Test-Path $f)){ Write-Host "缺少 $f"; exit 1 }
  $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f))
  [void]$parts.Add(('"{0}":"data:image/jpeg;base64,{1}"' -f $ids[$i], $b64))
}
$json = $parts -join ','

$enc = New-Object System.Text.UTF8Encoding($false)
$html = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
if($html.IndexOf('/*==ART_DATA==*/') -lt 0){
  Write-Host '模板里没有 /*==ART_DATA==*/ 占位符'
  exit 1
}
$html = $html.Replace('/*==ART_DATA==*/', $json)

# 卡图统一宽高比：从第一张量出来，注入模板，页面按这个比例显示卡片
Add-Type -AssemblyName System.Drawing
$probe = [System.Drawing.Bitmap]::FromFile((Join-Path $tileDir 'card01.jpg'))
$ratio = [double]$probe.Width / [double]$probe.Height
$probe.Dispose()
$ratioText = $ratio.ToString('0.0000', [System.Globalization.CultureInfo]::InvariantCulture)
$html = $html.Replace('/*==ART_RATIO==*/0.6416', $ratioText)

[System.IO.File]::WriteAllText($outPath, $html, $enc)
Write-Host ("已注入 16 张卡图（比例 {0}） -> {1} （{2} KB）" -f $ratioText, $outPath, [int]((Get-Item $outPath).Length / 1KB))
