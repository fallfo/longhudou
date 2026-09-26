# 把两套牌面画风（tools/tiles 与 tools/tiles-classic）转成 base64 注入 index.html 的 /*==ART_SETS==*/{} 占位符
#
# 用法（在仓库根目录）：
#   $env:LONGHUDOU_ROOT = 'D:\workspace\longhudou'
#   Invoke-Expression (Get-Content -Raw -Encoding UTF8 .\tools\embed-art.ps1)
#
# 注入结构：
#   var CARD_SETS = {
#     anime:   { name:'动漫版',   ratio:<宽高比>, art:{ D1:'data:image/jpeg;base64,…', … } },
#     classic: { name:'洋画片版', ratio:<宽高比>, art:{ … } }
#   };
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = if($env:LONGHUDOU_ROOT){ $env:LONGHUDOU_ROOT }
        elseif($PSScriptRoot){ Split-Path -Parent $PSScriptRoot }
        else { 'D:\workspace\longhudou' }
$templatePath = Join-Path $root 'tools\index.template.html'
$outPath = Join-Path $root 'index.html'
$ids = @('D1','D2','D3','D4','D5','D6','D7','D8','T1','T2','T3','T4','T5','T6','T7','T8')
$sets = @(
  @{ key = 'anime';   dir = 'tools\tiles';         name = '动漫版' },
  @{ key = 'classic'; dir = 'tools\tiles-classic'; name = '洋画片版' }
)

if(-not (Test-Path $templatePath)){ Write-Host "找不到模板 $templatePath"; exit 1 }
$enc = New-Object System.Text.UTF8Encoding($false)
$html = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
if($html.IndexOf('/*==ART_SETS==*/{}') -lt 0){ Write-Host '模板里没有 /*==ART_SETS==*/{} 占位符'; exit 1 }

$chunks = New-Object System.Collections.ArrayList
$totalBytes = 0
foreach($s in $sets){
  $dir = Join-Path $root $s.dir
  if(-not (Test-Path $dir)){ Write-Host ("缺少卡图目录 " + $dir + "（先跑 tools\slice-sheet.ps1）"); exit 1 }
  $probe = [System.Drawing.Bitmap]::FromFile((Join-Path $dir 'card01.jpg'))
  $ratio = [double]$probe.Width / [double]$probe.Height
  $probe.Dispose()
  $ratioText = $ratio.ToString('0.0000', [System.Globalization.CultureInfo]::InvariantCulture)
  $parts = New-Object System.Collections.ArrayList
  $sum = 0
  for($i = 0; $i -lt 16; $i++){
    $f = Join-Path $dir ('card{0:d2}.jpg' -f ($i + 1))
    if(-not (Test-Path $f)){ Write-Host "缺少 $f"; exit 1 }
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $sum += $bytes.Length
    [void]$parts.Add(('"{0}":"data:image/jpeg;base64,{1}"' -f $ids[$i], [Convert]::ToBase64String($bytes)))
  }
  $totalBytes += $sum
  Write-Host ("{0}: {1} KB，比例 {2}" -f $s.name, [int]($sum / 1KB), $ratioText)
  [void]$chunks.Add(('"{0}":{{"name":"{1}","ratio":{2},"art":{{{3}}}}}' -f $s.key, $s.name, $ratioText, ($parts -join ',')))
}

$json = '{' + ($chunks -join ',') + '}'
$html = $html.Replace('/*==ART_SETS==*/{}', $json)
[System.IO.File]::WriteAllText($outPath, $html, $enc)
Write-Host ("已注入 {0} 套牌面（合计 {1} KB） -> {2}（{3} KB）" -f $sets.Count, [int]($totalBytes / 1KB), $outPath, [int]((Get-Item $outPath).Length / 1KB))
