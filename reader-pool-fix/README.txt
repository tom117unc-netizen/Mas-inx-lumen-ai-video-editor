# Lumen root-cause export OOM fix

The diagnostic run captured V8 OOM while Mediabunny was inside:

`traverseBox -> readContiguousBoxes -> getSampleTableForTrack -> getKeyPacket`

That is the video input/key-packet path. In Lumen's FrameFeeder, a VideoReader was keyed by
timeline cut ID plus source URL. A long recording split into hundreds of cuts therefore caused
the same large MP4 source to be opened and its sample table parsed again for cut after cut.

This patch replaces per-cut readers with a source-file reader pool:
- normal cuts-only edit: one persistent VideoReader per source recording;
- transition/overlay showing the same source twice: two readers;
- later cuts reuse those readers rather than creating new Inputs.

This is deliberately an incremental patch for the previous long-export-stability build.

## Apply on Matthew's current tree

PowerShell:

powershell -ExecutionPolicy Bypass -File "D:\Lumenfix\reader-pool-fix\apply-reader-pool-fix-and-build.ps1" -Repo "D:\Lumenfix\Lumen-Fixed"

The script:
1. checks the patch applies cleanly;
2. applies it;
3. runs the reader-pool regression test;
4. runs the full Lumen test suite;
5. runs TypeScript typecheck;
6. builds a fresh Windows installer under `D:\Lumenfix\Lumen-Fixed\release`.

If `git apply --check` fails, do not force it. Send `D:\Lumenfix\Lumen-Fixed\src\engine\stills.ts`
back to ChatGPT so the patch can be adapted to the exact local tree.
