# Lumen Anime Review Edition — development overlay

This repository contains the anime-review development modules built on top of [Mas-inx/lumen-ai-video-editor](https://github.com/Mas-inx/lumen-ai-video-editor).

**Important:** This is NOT a clone of the upstream Lumen repository, an integrated application, or a validated Windows build. GitHub was inaccessible from the build container, and the GitHub connector does not grant repository creation. These modules are experimental and need integration and testing.

## Publish to your own GitHub repository

1. Create an empty GitHub repository named `lumen-anime-review-edition` under your account. Do not initialise it with a README.
2. Extract this ZIP, open PowerShell in its root and run:

```powershell
git remote add origin https://github.com/tom117unc-netizen/lumen-anime-review-edition.git
git branch -M main
git push -u origin main
```

The archive contains a `.git` directory and an initial commit. If Windows has removed hidden `.git` files during extraction, run `git init`, `git add .`, `git commit -m "Initial anime review development overlay"` before adding the remote.

## Bringing in the original Lumen source

Clone the original separately and create an integration branch. Do **not** simply copy all addon files into the original app without adapting imports and testing:

```powershell
git clone https://github.com/Mas-inx/lumen-ai-video-editor.git lumen-base
cd lumen-base
git remote add anime https://github.com/tom117unc-netizen/lumen-anime-review-edition.git
git switch -c anime-integration
```

The overlay is deliberately separate until the full source is available in a working build environment. The existing Lumen command layer and undo history should be used for all applied edits; see STORE-INTEGRATION.md.

## Included modules

- `project-manifest.ts`: timeline snapshot and validation
- `project-patches.ts`: proposed edit operations
- `anime-review-approval.ts`: before/after preview
- `anime-ai-context.ts`: smaller context windows
- `anime-footage-matcher.ts`: transcript/cue matching
- `anime-pngtuber-sync.ts`: audio-based mouth intervals and sprite replacement
- `anime-review.ts`: editorial planning
- `video-quality.ts`: quality checks

No source-code files from the upstream repository are included in this overlay.
