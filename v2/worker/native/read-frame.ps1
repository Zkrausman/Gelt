# Fixed one-request binary transport; never wait for EOF after a complete frame.
# PowerShell Console.In is a TextReader whose large reads can wait on an open pipe.
# Trace is enabled only by the fixed production entrypoint, never request content.
function Read-GeltFrame([switch]$Trace) {
  if ($Trace) { Set-GeltStage 'FRAME_ENTER' }
  if ($Trace) { Set-GeltStage 'FRAME_STDIN' }
  $stream = [Console]::OpenStandardInput()
  if ($Trace) { Set-GeltStage 'FRAME_STDIN_DONE' }
  if ($Trace) { Set-GeltStage 'FRAME_ALLOC' }
  $header = [byte[]]::new(4)
  if ($Trace) { Set-GeltStage 'FRAME_ALLOC_DONE' }
  $offset = 0
  if ($Trace) { Set-GeltStage 'FRAME_HEADER' }
  while ($offset -lt 4) {
    $n = $stream.Read($header, $offset, 4 - $offset)
    if ($n -le 0) { throw 'frame' }; $offset += $n
  }
  if ($Trace) { Set-GeltStage 'FRAME_HEADER_DONE' }
  # Unsigned network-order byte length, checked before allocation.
  $length = [long]$header[0] * 16777216 + [long]$header[1] * 65536 + [long]$header[2] * 256 + [long]$header[3]
  if ($length -lt 1 -or $length -gt 220000) { throw 'frame' }
  $bytes = [byte[]]::new([int]$length)
  $offset = 0
  if ($Trace) { Set-GeltStage 'FRAME_PAYLOAD' }
  while ($offset -lt $length) {
    $n = $stream.Read($bytes, $offset, [int]$length - $offset)
    if ($n -le 0) { throw 'frame' }; $offset += $n
  }
  if ($Trace) { Set-GeltStage 'FRAME_PAYLOAD_DONE' }
  if ($Trace) { Set-GeltStage 'FRAME_UTF8' }
  return [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
}
