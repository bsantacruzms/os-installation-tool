/** Called after Clear-Disk, with the already checked target in $disk and errors set to Stop. */
export const prepareClearedGpt = `
$targetPath = $disk.Path
$disk = Get-Disk -Path $targetPath
if ($disk.IsBoot -or $disk.IsSystem -or $disk.IsOffline -or $disk.IsReadOnly -or $disk.NumberOfPartitions -ne 0) {
  throw 'The confirmed drive is protected, offline, or not empty after clearing. Stopping before partition creation.'
}
switch ([string]$disk.PartitionStyle) {
  'RAW' {
    try { Initialize-Disk -Path $targetPath -PartitionStyle GPT }
    catch {
      if ($_.FullyQualifiedErrorId -notlike 'StorageWMI 41001,*') { throw }
      # Windows may have initialized the disk since Get-Disk. Verify below.
    }
  }
  'MBR' { Set-Disk -Path $targetPath -PartitionStyle GPT }
  'GPT' { }
  default { throw "Unexpected partition style after clearing: $($disk.PartitionStyle)." }
}
$disk = Get-Disk -Path $targetPath
if ($disk.PartitionStyle -ne 'GPT' -or $disk.Number -ne $n -or $disk.IsBoot -or $disk.IsSystem) {
  throw 'Windows did not confirm GPT on the selected drive. Stopping before partition creation.'
}`;
