LUMEN EXPORT DIAGNOSTICS

1. Close Lumen completely.
2. Right-click Run-Lumen-Export-Diagnostics.ps1 and choose "Run with PowerShell",
   OR open PowerShell and run:

   powershell -ExecutionPolicy Bypass -File "D:\Lumenfix\Run-Lumen-Export-Diagnostics.ps1"

3. The script launches Lumen itself.
4. Open the Skyrim project and start the same export that goes black.
5. When Lumen goes black, wait 10-15 seconds.
6. Close the black Lumen window or End Task on Lumen.
7. The PowerShell script will finish and create a ZIP under:
   D:\Lumenfix\ExportLogs\

Upload the newest LumenExport_....zip to ChatGPT.

The ZIP contains:
- Chromium/Electron log
- memory usage for every Lumen renderer/GPU/utility process every 2 seconds
- total system RAM use
- NVIDIA GPU memory/encode/decode utilisation (when nvidia-smi is available)
- Windows Application Error / Windows Error Reporting events
- Windows NVIDIA/display-driver events
- any fresh Lumen crash dumps Windows already generated

This logger runs OUTSIDE Lumen, so it continues recording even if Lumen's renderer
turns completely black.
