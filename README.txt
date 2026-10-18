LUMEN — SYNCHRONIZED TIMELINE PLAYBACK + CTRL/WHEEL PAN

WHAT THIS CHANGES

1. Normal-speed Play now waits for the first audible audio at the selected
   playhead position to be prepared before the picture clock advances.

2. For recordings longer than 10 minutes, the first normal 8-second stream
   chunk is decoded before playback starts. Lumen's existing 12-second
   lookahead continues loading later chunks while playing.

3. Seeking while playing cancels the old pending start, holds the new frame,
   prepares its audio, and then resumes picture+sound from one audio anchor.

4. Ctrl + mouse wheel pans the timeline horizontally.
   Ctrl + wheel no longer zooms the timeline.
   Normal zoom controls are unchanged.

INSTALL / BUILD

Extract this folder under D:\Lumenfix so the script is for example:

D:\Lumenfix\sync-playback-fix\apply-sync-playback-and-build.ps1

Close Lumen, then run:

powershell -ExecutionPolicy Bypass -File "D:\Lumenfix\sync-playback-fix\apply-sync-playback-and-build.ps1" -Repo "D:\Lumenfix\Lumen-Fixed"

The script:
- refuses to apply if the relevant current Lumen source no longer matches the
  expected code blocks;
- backs up playback.ts, audio-engine.ts and Timeline.tsx with
  .before-sync-playback.bak suffixes;
- adds focused regression tests;
- runs focused tests, the full suite, TypeScript typecheck, and npm run dist.

Fresh installer:
D:\Lumenfix\Lumen-Fixed\release\
