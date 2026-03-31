$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$docsImages = Join-Path $root "docs/images"
$tmpDir = Join-Path $root "tmp"
$publicDemo = Join-Path $root "public/demo"

function Assert-LastExitCode {
  param([string]$Step)

  if ($LASTEXITCODE -ne 0) {
    throw "Failed during step: $Step"
  }
}

New-Item -ItemType Directory -Force $tmpDir | Out-Null
New-Item -ItemType Directory -Force $publicDemo | Out-Null

$filterPath = Join-Path $tmpDir "readme-demo-filter.ffscript"

$filter = @"
[0:v]fps=30,scale=1480:800:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2:color=#08111d,drawbox=x=58:y=52:w=1484:h=796:color=white@0.08:t=2,drawbox=x=84:y=82:w=230:h=46:color=black@0.56:t=fill,drawtext=text='Chat workspace':fontcolor=white:fontsize=24:x=104:y=113,trim=duration=4,setpts=PTS-STARTPTS[v0];
[1:v]fps=30,scale=1480:800:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2:color=#08111d,drawbox=x=58:y=52:w=1484:h=796:color=white@0.08:t=2,drawbox=x=84:y=82:w=230:h=46:color=black@0.56:t=fill,drawtext=text='Prompt rules':fontcolor=white:fontsize=24:x=104:y=113,trim=duration=4,setpts=PTS-STARTPTS[v1];
[2:v]fps=30,scale=1480:800:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2:color=#08111d,drawbox=x=58:y=52:w=1484:h=796:color=white@0.08:t=2,drawbox=x=84:y=82:w=230:h=46:color=black@0.56:t=fill,drawtext=text='Todo board':fontcolor=white:fontsize=24:x=104:y=113,trim=duration=4,setpts=PTS-STARTPTS[v2];
[v0][v1]xfade=transition=fade:duration=0.6:offset=3.4[x1];
[x1][v2]xfade=transition=fade:duration=0.6:offset=6.8,format=yuv420p[v]
"@

[System.IO.File]::WriteAllText(
  $filterPath,
  $filter,
  (New-Object System.Text.UTF8Encoding($false))
)

$mp4Path = Join-Path $docsImages "projectpilot-demo.mp4"
$gifPath = Join-Path $docsImages "projectpilot-demo.gif"
$palettePath = Join-Path $tmpDir "projectpilot-demo-palette.png"

ffmpeg -y `
  -loop 1 -t 4 -i (Join-Path $docsImages "projectpilot-chat-workspace.png") `
  -loop 1 -t 4 -i (Join-Path $docsImages "projectpilot-prompts-overview.png") `
  -loop 1 -t 4 -i (Join-Path $docsImages "projectpilot-todo-board.png") `
  -filter_complex_script $filterPath `
  -map "[v]" -r 30 -c:v libx264 -pix_fmt yuv420p -movflags +faststart `
  $mp4Path
Assert-LastExitCode "generate mp4"

ffmpeg -y `
  -i $mp4Path `
  -vf "fps=10,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" `
  -update 1 `
  -frames:v 1 `
  $palettePath
Assert-LastExitCode "generate gif palette"

ffmpeg -y `
  -i $mp4Path `
  -i $palettePath `
  -filter_complex "fps=10,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" `
  $gifPath
Assert-LastExitCode "generate gif"

Copy-Item $mp4Path (Join-Path $publicDemo "projectpilot-demo.mp4") -Force
Copy-Item (Join-Path $docsImages "projectpilot-chat-workspace.png") (Join-Path $publicDemo "projectpilot-chat-workspace.png") -Force
Copy-Item (Join-Path $docsImages "projectpilot-prompts-overview.png") (Join-Path $publicDemo "projectpilot-prompts-overview.png") -Force
Copy-Item (Join-Path $docsImages "projectpilot-todo-board.png") (Join-Path $publicDemo "projectpilot-todo-board.png") -Force
