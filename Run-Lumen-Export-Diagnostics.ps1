param(
    [string]$LumenExe = "",
    [string]$OutputRoot = "D:\Lumenfix\ExportLogs",
    [int]$SampleSeconds = 2
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Resolve-LumenExe {
    param([string]$Requested)

    if ($Requested -and (Test-Path $Requested)) {
        return (Resolve-Path $Requested).Path
    }

    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Lumen\Lumen.exe",
        "$env:LOCALAPPDATA\Lumen\Lumen.exe",
        "$env:ProgramFiles\Lumen\Lumen.exe",
        "${env:ProgramFiles(x86)}\Lumen\Lumen.exe",
        "D:\Lumenfix\Lumen-Fixed\release\win-unpacked\Lumen.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -gt 0) {
        return (Resolve-Path $candidates[0]).Path
    }

    $releaseRoot = "D:\Lumenfix\Lumen-Fixed\release"
    if (Test-Path $releaseRoot) {
        $hit = Get-ChildItem $releaseRoot -Filter "Lumen.exe" -File -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }

    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select the Lumen.exe you installed/built"
    $dialog.Filter = "Lumen (Lumen.exe)|Lumen.exe|Executable (*.exe)|*.exe"
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        return $dialog.FileName
    }

    throw "Could not find Lumen.exe."
}

function Get-ProcessType {
    param([string]$CommandLine)
    if (-not $CommandLine) { return "main/unknown" }
    if ($CommandLine -match '--type=([^\s"]+)') { return $Matches[1] }
    return "main"
}

function Append-Csv {
    param(
        [Parameter(Mandatory=$true)] $Object,
        [Parameter(Mandatory=$true)] [string]$Path
    )
    $Object | Export-Csv -Path $Path -NoTypeInformation -Append
}

$startTime = Get-Date
$stamp = $startTime.ToString("yyyy-MM-dd_HH-mm-ss")
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$sessionDir = Join-Path $OutputRoot "LumenExport_$stamp"
New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null

$chromeLog = Join-Path $sessionDir "chromium.log"
$processCsv = Join-Path $sessionDir "process-memory.csv"
$systemCsv = Join-Path $sessionDir "system-memory.csv"
$gpuCsv = Join-Path $sessionDir "nvidia-gpu.csv"
$eventsTxt = Join-Path $sessionDir "windows-events.txt"
$sessionTxt = Join-Path $sessionDir "session-info.txt"

$exe = Resolve-LumenExe -Requested $LumenExe

Write-Section "Lumen export diagnostics"
Write-Host "Lumen: $exe"
Write-Host "Logs:  $sessionDir"
Write-Host ""
Write-Host "IMPORTANT:" -ForegroundColor Yellow
Write-Host "1. This script launches Lumen itself."
Write-Host "2. Open the problem project and start the same export."
Write-Host "3. When Lumen goes black, WAIT 10-15 seconds."
Write-Host "4. Close the black Lumen window (or end Lumen in Task Manager)."
Write-Host "5. Leave this PowerShell window open; it will create a ZIP automatically."
Write-Host ""

$existing = Get-Process -Name "Lumen" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Warning "Lumen is already running. Close every Lumen window before continuing."
    Read-Host "Press ENTER after Lumen is completely closed"
    Start-Sleep -Seconds 1
    if (Get-Process -Name "Lumen" -ErrorAction SilentlyContinue) {
        throw "Lumen is still running. Close it and run the diagnostic script again."
    }
}

# Session/system information
"Start: $($startTime.ToString('o'))" | Set-Content $sessionTxt
"LumenExe: $exe" | Add-Content $sessionTxt
"PowerShell: $($PSVersionTable.PSVersion)" | Add-Content $sessionTxt
try {
    $os = Get-CimInstance Win32_OperatingSystem
    "OS: $($os.Caption) $($os.Version) build $($os.BuildNumber)" | Add-Content $sessionTxt
    "RAM_GB: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 2))" | Add-Content $sessionTxt
} catch {}
try {
    $gpus = Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM
    "VideoControllers:" | Add-Content $sessionTxt
    ($gpus | Format-Table -AutoSize | Out-String) | Add-Content $sessionTxt
} catch {}

$nvidia = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
if ($nvidia) {
    try {
        "nvidia-smi:" | Add-Content $sessionTxt
        (& $nvidia.Source -L 2>&1 | Out-String) | Add-Content $sessionTxt
    } catch {}
}

# Chromium/Electron's own persistent logging.
$args = @(
    "--enable-logging",
    "--v=1",
    "--log-level=0",
    "--log-file=`"$chromeLog`""
)

Write-Host "Launching Lumen with Chromium logging..." -ForegroundColor Green
$main = Start-Process -FilePath $exe -ArgumentList $args -PassThru
"MainPID: $($main.Id)" | Add-Content $sessionTxt

$sample = 0
try {
    while ($true) {
        $main.Refresh()
        if ($main.HasExited) { break }

        $now = Get-Date
        $allCim = @(Get-CimInstance Win32_Process -Filter "Name='Lumen.exe'" -ErrorAction SilentlyContinue)
        $totalPrivate = 0.0
        $totalWorking = 0.0

        foreach ($cim in $allCim) {
            try {
                $p = Get-Process -Id $cim.ProcessId -ErrorAction Stop
                $type = Get-ProcessType -CommandLine $cim.CommandLine
                $privateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
                $workingMB = [math]::Round($p.WorkingSet64 / 1MB, 1)
                $totalPrivate += $privateMB
                $totalWorking += $workingMB

                Append-Csv -Path $processCsv -Object ([pscustomobject]@{
                    Time = $now.ToString("o")
                    PID = $p.Id
                    ParentPID = $cim.ParentProcessId
                    Type = $type
                    WorkingSetMB = $workingMB
                    PrivateMB = $privateMB
                    PagedMB = [math]::Round($p.PagedMemorySize64 / 1MB, 1)
                    VirtualMB = [math]::Round($p.VirtualMemorySize64 / 1MB, 1)
                    Handles = $p.HandleCount
                    Threads = $p.Threads.Count
                    CPUSeconds = if ($null -ne $p.CPU) { [math]::Round($p.CPU, 2) } else { $null }
                    CommandLine = $cim.CommandLine
                })
            } catch {}
        }

        try {
            $os = Get-CimInstance Win32_OperatingSystem
            $freeMB = [math]::Round($os.FreePhysicalMemory / 1KB, 1)
            $totalMB = [math]::Round($os.TotalVisibleMemorySize / 1KB, 1)
            Append-Csv -Path $systemCsv -Object ([pscustomobject]@{
                Time = $now.ToString("o")
                TotalRAMMB = $totalMB
                FreeRAMMB = $freeMB
                UsedRAMMB = [math]::Round($totalMB - $freeMB, 1)
                LumenPrivateMB = [math]::Round($totalPrivate, 1)
                LumenWorkingSetMB = [math]::Round($totalWorking, 1)
                LumenProcessCount = $allCim.Count
            })
        } catch {}

        if ($nvidia) {
            try {
                $row = & $nvidia.Source --query-gpu=memory.used,memory.total,utilization.gpu,utilization.encoder,utilization.decoder,temperature.gpu --format=csv,noheader,nounits 2>$null
                if ($row) {
                    $parts = ($row -split ",").ForEach({ $_.Trim() })
                    if ($parts.Count -ge 6) {
                        Append-Csv -Path $gpuCsv -Object ([pscustomobject]@{
                            Time = $now.ToString("o")
                            MemoryUsedMB = $parts[0]
                            MemoryTotalMB = $parts[1]
                            GPUPercent = $parts[2]
                            EncoderPercent = $parts[3]
                            DecoderPercent = $parts[4]
                            TemperatureC = $parts[5]
                        })
                    }
                }
            } catch {}
        }

        if (($sample % 5) -eq 0) {
            Write-Host ("{0:HH:mm:ss} | Lumen processes {1} | private {2:N0} MB | working {3:N0} MB" -f $now, $allCim.Count, $totalPrivate, $totalWorking)
        }
        $sample++
        Start-Sleep -Seconds ([math]::Max(1, $SampleSeconds))
    }
}
finally {
    $endTime = Get-Date
    "End: $($endTime.ToString('o'))" | Add-Content $sessionTxt
    try {
        $main.Refresh()
        "MainExitCode: $($main.ExitCode)" | Add-Content $sessionTxt
    } catch {}

    Write-Section "Collecting Windows crash/driver events"
    try {
        "=== APPLICATION LOG ===" | Set-Content $eventsTxt
        Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $startTime } -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProviderName -match 'Application Error|Windows Error Reporting' -or
                $_.Message -match 'Lumen|electron|chrome|gpu'
            } |
            Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message |
            Format-List | Out-String -Width 300 | Add-Content $eventsTxt
    } catch {}

    try {
        "=== SYSTEM / GPU LOG ===" | Add-Content $eventsTxt
        Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $startTime } -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProviderName -match 'Display|nvlddmkm|WHEA' -or
                $_.Message -match 'display driver|NVIDIA|GPU|TDR'
            } |
            Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message |
            Format-List | Out-String -Width 300 | Add-Content $eventsTxt
    } catch {}

    # Copy any fresh crash dumps Windows happened to produce.
    $crashDumpDir = Join-Path $env:LOCALAPPDATA "CrashDumps"
    if (Test-Path $crashDumpDir) {
        try {
            Get-ChildItem $crashDumpDir -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -ge $startTime -and $_.Name -match 'Lumen|electron|chrome' } |
                ForEach-Object { Copy-Item $_.FullName $sessionDir -Force }
        } catch {}
    }

    $zip = "$sessionDir.zip"
    try {
        if (Test-Path $zip) { Remove-Item $zip -Force }
        Compress-Archive -Path (Join-Path $sessionDir "*") -DestinationPath $zip -Force
        Write-Host ""
        Write-Host "Diagnostic ZIP created:" -ForegroundColor Green
        Write-Host $zip -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Upload that ZIP to ChatGPT and I can trace which process/resource fails."
    } catch {
        Write-Warning "Could not create ZIP automatically: $($_.Exception.Message)"
        Write-Host "The raw logs are still here: $sessionDir"
    }
}
