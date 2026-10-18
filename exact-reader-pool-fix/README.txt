LUMEN EXACT READER-POOL FIX

This package was generated from the exact stills.ts uploaded from:
D:\Lumenfix\Lumen-Fixed\src\engine\stills.ts

Expected original SHA-256:
eab80f96f534b1b88333dd843040ab472e49744f9b8fa7a63014cc7f1f9799e5

Why:
The current file creates VideoReader instances using timeline clip key + source URL.
For a long OBS recording split into many cuts, that causes the same large MP4 source
to be reopened/reparsed for each cut. The diagnostic crash stack ended in Mediabunny's
MP4 sample-table/key-packet lookup while V8 hit its heap limit.

What changes:
- VideoReader pool is keyed by SOURCE FILE, not by CUT.
- Successive cuts reuse slot 0.
- A second reader is only opened when the same source is visible twice simultaneously.
- All pooled readers are disposed when FrameFeeder is disposed.
- Adds a standalone regression test with no DOM/video dependency.

Run:
powershell -ExecutionPolicy Bypass -File "D:\Lumenfix\exact-reader-pool-fix\apply-exact-reader-pool-fix.ps1" -Repo "D:\Lumenfix\Lumen-Fixed"

The script checks the SHA first and refuses to touch the file if it no longer matches.
It also creates:
src\engine\stills.ts.before-reader-pool.bak

Then it runs:
1. focused regression test
2. full npm test
3. npm run typecheck
4. npm run dist
