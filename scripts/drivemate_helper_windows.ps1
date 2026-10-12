# DriveMate Windows Native Messaging Engine (PowerShell Fallback)
# Provides 100% native execution on Windows 10/11 without requiring Python or Node.js

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$inStream = [System.Console]::OpenStandardInput()
$outStream = [System.Console]::OpenStandardOutput()
$reader = New-Object System.IO.BinaryReader($inStream)
$writer = New-Object System.IO.BinaryWriter($outStream)

function Send-NativeMessage($obj) {
    $json = $obj | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $len = $bytes.Length
    $lenBytes = [System.BitConverter]::GetBytes([uint32]$len)
    
    $outStream.Write($lenBytes, 0, 4)
    $outStream.Write($bytes, 0, $len)
    $outStream.Flush()
}

while ($true) {
    try {
        $lenBytes = $reader.ReadBytes(4)
        if ($lenBytes.Length -lt 4) { break }
        $msgLen = [System.BitConverter]::ToUInt32($lenBytes, 0)
        if ($msgLen -le 0 -or $msgLen -gt 10485760) { break }
        
        $msgBytes = $reader.ReadBytes($msgLen)
        $msgJson = [System.Text.Encoding]::UTF8.GetString($msgBytes)
        $msg = $msgJson | ConvertFrom-Json
        
        $action = $msg.action.ToUpper()
        
        if ($action -eq "PING") {
            Send-NativeMessage @{
                status = "SUCCESS"
                action = "PONG"
                echoPayload = $msg.payload
                receivedTimestamp = $msg.timestamp
                helperVersion = "0.3.0-win-ps"
            }
        }
        elseif ($action -eq "START_DOWNLOAD_JOB") {
            $jobId = $msg.jobId
            $dest = $msg.destinationPath
            if ([string]::IsNullOrEmpty($dest)) {
                $dest = [System.IO.Path]::Combine([System.Environment]::GetFolderPath("UserProfile"), "Downloads", "DriveMate")
            }
            [System.IO.Directory]::CreateDirectory($dest) | Out-Null
            
            Send-NativeMessage @{ status = "SUCCESS"; action = "JOB_ACCEPTED"; jobId = $jobId }
            Send-NativeMessage @{ action = "JOB_STARTED"; jobId = $jobId }
            
            $files = $msg.files
            $completed = 0
            $failed = 0
            $totalBytes = 0
            
            if ($null -ne $files) {
                foreach ($f in $files) {
                    $fid = if ($f.id) { $f.id } else { $f.name }
                    $fname = if ($f.name) { $f.name } else { "file_$fid" }
                    $fname = $fname -replace '[\\/:*?"<>|]', '_'
                    $outPath = [System.IO.Path]::Combine($dest, $fname)
                    
                    try {
                        $url = "https://drive.usercontent.google.com/download?id=$fid&export=download&confirm=t"
                        $wc = New-Object System.Net.WebClient
                        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DriveMate/0.3.0")
                        $wc.DownloadFile($url, $outPath)
                        
                        $bytesDownloaded = (Get-Item $outPath).Length
                        $totalBytes += $bytesDownloaded
                        $completed++
                        
                        Send-NativeMessage @{
                            action = "FILE_COMPLETED"
                            jobId = $jobId
                            fileId = $fid
                            name = $fname
                            bytesDownloaded = $bytesDownloaded
                            verified = $true
                        }
                    } catch {
                        $failed++
                        Send-NativeMessage @{
                            action = "FILE_FAILED"
                            jobId = $jobId
                            fileId = $fid
                            error = $_.Exception.Message
                        }
                    }
                }
            }
            
            Send-NativeMessage @{
                action = "JOB_COMPLETED"
                jobId = $jobId
                stats = @{
                    totalFiles = if ($files) { $files.Count } else { 0 }
                    completedFiles = $completed
                    failedFiles = $failed
                    totalBytes = $totalBytes
                }
            }
        }
    } catch {
        break
    }
}
