param([string]$FFmpeg = 'ffmpeg')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'assets/videos'
$target = Join-Path $source 'web'
New-Item -ItemType Directory -Force $target | Out-Null
$clips = @(
    @{ Name = 'voxposer2024'; Slug = '2024-voxposer-code-policy-value-maps'; Title = 'VoxPoser: Code Policies & Value Maps'; Start = 0; Duration = 65; Poster = 2 },
    @{ Name = 'aubo2025'; Slug = '2025-aubo-i5-visual-manipulation'; Title = 'AUBO i5: Visual Manipulation'; Start = 6; Duration = 10; Poster = 3 },
    @{ Name = 'realman2025'; Slug = '2025-rm65b-sim-to-real'; Title = 'RM65B: Simulation-to-Hardware Integration'; Start = 0; Duration = 6.6; Poster = 2 },
    @{ Name = 'mobile2026-1'; Slug = '2026-mobile-manipulator-grasp-and-lift'; Title = 'Mobile Manipulator: Grasp & Lift'; Start = 44; Duration = 10; Poster = 6 },
    @{ Name = 'mobile2026-2'; Slug = '2026-mobile-manipulator-arm-base-coordination'; Title = 'Mobile Manipulator: Arm-Base Coordination'; Start = 140; Duration = 10; Poster = 8 }
)
foreach ($clip in $clips) {
    $inputFile = Join-Path $source ($clip.Name + '.mp4')
    $outputFile = Join-Path $target ($clip.Slug + '.mp4')
    $filter = "scale=w='min(1280,iw)':h=-2,setsar=1"
    $extra = @('-ss', "$($clip.Start)", '-t', "$($clip.Duration)")
    if ($clip.Name -eq 'voxposer2024') {
        # Retain both the simulation and value-map views, omitting desktop switching.
        $filter = "select='gte(t,20)*lt(t,25)+gte(t,60)*lt(t,65)',setpts=N/30/TB,$filter"
    }
    & $FFmpeg -hide_banner -loglevel error -y @extra -i $inputFile -map 0:v:0 -vf $filter -an -sn -dn -map_metadata -1 -metadata "title=$($clip.Title)" -metadata 'artist=Li Zhaoyang' -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart $outputFile
    if ($LASTEXITCODE -ne 0) { throw "Encoding failed: $($clip.Name)" }
    & $FFmpeg -hide_banner -loglevel error -y -ss $clip.Poster -i $outputFile -frames:v 1 -vf 'scale=960:-2' -q:v 3 (Join-Path $target ($clip.Slug + '.jpg'))
    if ($LASTEXITCODE -ne 0) { throw "Poster failed: $($clip.Name)" }
}
