# Lumen 1.4.0 — long-export stability fix

Prepared for the 1-hour cuts-only MP4 export that consistently turns the Electron window black during export.

## Changes

1. **FrameFeeder decoder lifetime**
   - Finished cuts no longer leave their `VideoReader` alive until the entire export ends.
   - Active decoder count is bounded by the video clips actually needed by the current composite frame.

2. **Preview media release before export**
   - Dormant preview `<video preload="auto">` elements are unloaded before the frame-exact export starts.
   - Export uses `FrameFeeder`/WebCodecs, so these players are redundant during the export and are recreated when previewing later.

3. **Offline audio graph disposal**
   - Every two-second export mix block explicitly disconnects its mixer and nested graphs.
   - This avoids asking Chromium GC to eventually clean up thousands of OfflineAudioContext graph nodes in a long export.

4. **Complete disk writes**
   - Export chunks are no longer assumed to be written completely by one `fs.write` callback.
   - Partial writes continue until all bytes are on disk; zero-progress writes fail instead of hanging/corrupting output.

5. **Persistent process-failure logging**
   - Renderer/GPU/utility process exits are written to:
     `%APPDATA%\Lumen\lumen-process-failures.log` (actual Electron userData folder may vary slightly).
   - If a black window ever happens again, this gives an actual Electron process-exit reason.

## Regression tests

- `src/engine/stills.test.ts` covers retiring inactive video readers.
- `electron/export-write.test.ts` covers partial/zero-progress file writes.
- The included GitHub Actions workflow runs the full existing test suite and TypeScript checks before building the Windows installer.

## Build on Windows

You need Node.js 24 and Git.

```powershell
git clone --branch v1.4.0 https://github.com/Mas-inx/lumen-ai-video-editor.git
cd lumen-ai-video-editor
# Copy this package somewhere and run:
powershell -ExecutionPolicy Bypass -File C:\path\to\apply-and-build.ps1 -Repo .
```

The installer is produced under `release\`.

## Important verification note

The ChatGPT execution container used to prepare this patch cannot reach GitHub/npm, so it cannot perform the real `npm ci`, Vitest, TypeScript, or Windows NSIS build here. The workflow/script deliberately makes those checks mandatory before producing the installer.
