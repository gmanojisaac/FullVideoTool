param([Parameter(Mandatory=$true)][string]$PackageDirectory)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packagePath = [System.IO.Path]::GetFullPath($PackageDirectory)
$receipt = Get-Content -LiteralPath (Join-Path $packagePath 'export_receipt.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $packagePath $receipt.filename
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
$sha = [System.Security.Cryptography.SHA256]::Create()
function Get-EntryHash($entry) {
  $stream = $entry.Open()
  try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose() }
}
try {
  $manifestEntry = $archive.GetEntry('six_tile_lesson_export/metadata/export_manifest.json')
  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($archive.Entries.Count -ne $manifest.totalFileCount) { throw 'Incorrect archive file count.' }
  foreach ($item in $manifest.files) {
    $entry = $archive.GetEntry('six_tile_lesson_export/' + $item.path)
    if (-not $entry -or $entry.Length -ne $item.size -or (Get-EntryHash $entry) -ne $item.sha256) { throw "Payload mismatch: $($item.path)" }
  }
  if ((Get-EntryHash $manifestEntry) -ne $receipt.manifestSha256) { throw 'Manifest receipt mismatch.' }
  $zipStream = [System.IO.File]::OpenRead($archivePath)
  try { $zipHash = [System.BitConverter]::ToString($sha.ComputeHash($zipStream)).Replace('-', '').ToLowerInvariant() } finally { $zipStream.Dispose() }
  if ($zipHash -ne $receipt.archiveSha256) { throw 'Archive receipt mismatch.' }
  Write-Output "PASS: independent .NET ZIP reader, $($manifest.files.Count) payload hashes, manifest hash and archive hash. $($archive.Entries.Count) entries."
} finally { $archive.Dispose(); $sha.Dispose() }
