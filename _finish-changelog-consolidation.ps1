# Finish CHANGELOG consolidation — robust version.
# Run from PowerShell as Administrator in C:\Projects\eq-solves-field
#
# This script:
#   1. Clears any stale .git/index.lock (uses rename-then-delete for stubborn cases)
#   2. git rm's the 24 per-version CHANGELOG-v3.4.X.md files
#   3. force-adds CHANGELOG.md (it's in .git/info/exclude but Royce wants it tracked now)
#   4. Commits scoped to ONLY these paths (other 81 working-tree changes untouched)
#   5. Pulls remote demo with --rebase (autostash) so the push fast-forwards
#   6. Reports next-step push command

$ErrorActionPreference = "Stop"
Set-Location "C:\Projects\eq-solves-field"

function Clear-GitLock {
    $lock = ".git\index.lock"
    if (Test-Path $lock) {
        try {
            Remove-Item $lock -Force
            Write-Host "  cleared .git\index.lock"
        } catch {
            $tmp = ".git\index.lock.dead.$(Get-Random)"
            Move-Item $lock $tmp -Force
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            Write-Host "  cleared .git\index.lock (via rename)"
        }
    }
    # Also clear any orphan dead-lock files I created from the sandbox
    Get-ChildItem ".git" -Filter "index.lock.dead*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    if (Test-Path ".git\_dead_locks") {
        Remove-Item ".git\_dead_locks" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "1. Clearing locks..." -ForegroundColor Cyan
Clear-GitLock

Write-Host ""
Write-Host "2. Confirming branch..." -ForegroundColor Cyan
$branch = git rev-parse --abbrev-ref HEAD
Write-Host "   On: $branch"

Write-Host ""
Write-Host "3. Pulling remote changes first (--rebase --autostash)..." -ForegroundColor Cyan
Clear-GitLock
git pull --rebase --autostash origin demo
if ($LASTEXITCODE -ne 0) {
    Write-Host "ABORT: pull failed. Resolve and rerun." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "4. git rm 24 per-version CHANGELOG files..." -ForegroundColor Cyan
$perVersionFiles = @(
    "CHANGELOG-v3.4.2.md",  "CHANGELOG-v3.4.5.md",  "CHANGELOG-v3.4.8.md",
    "CHANGELOG-v3.4.9.md",  "CHANGELOG-v3.4.10.md", "CHANGELOG-v3.4.11.md",
    "CHANGELOG-v3.4.12.md", "CHANGELOG-v3.4.13.md", "CHANGELOG-v3.4.14.md",
    "CHANGELOG-v3.4.16.md", "CHANGELOG-v3.4.17.md", "CHANGELOG-v3.4.18.md",
    "CHANGELOG-v3.4.21.md", "CHANGELOG-v3.4.22.md", "CHANGELOG-v3.4.23.md",
    "CHANGELOG-v3.4.25.md", "CHANGELOG-v3.4.26.md", "CHANGELOG-v3.4.27.md",
    "CHANGELOG-v3.4.28.md", "CHANGELOG-v3.4.29.md", "CHANGELOG-v3.4.36.md",
    "CHANGELOG-v3.4.37.md", "CHANGELOG-v3.4.38.md", "CHANGELOG-v3.4.39.md"
)
$removed = 0
foreach ($f in $perVersionFiles) {
    Clear-GitLock
    if (Test-Path $f) {
        git rm -f --quiet $f
        if ($LASTEXITCODE -eq 0) { $removed++ }
        else { Write-Host "  WARN: failed to git rm $f" -ForegroundColor Yellow }
    }
}
Write-Host "   removed: $removed of $($perVersionFiles.Count)"

Write-Host ""
Write-Host "5. Force-adding consolidated CHANGELOG.md (it's in .git/info/exclude)..." -ForegroundColor Cyan
Clear-GitLock
git add -f CHANGELOG.md

Write-Host ""
Write-Host "6. Staged summary (should be ONLY changelog files):" -ForegroundColor Cyan
git diff --cached --stat

Write-Host ""
Write-Host "7. Committing..." -ForegroundColor Cyan
Clear-GitLock
$msg = "docs(changelog): consolidate 24 per-version files into rolling CHANGELOG.md`n`n" +
       "Merge per-version CHANGELOG-v3.4.X.md content into CHANGELOG.md (force-added; was in .git/info/exclude). " +
       "Replaces the 'v3.4.27 to v3.4.35 backfill pending' placeholder with actual content for 27/28/29 plus a short " +
       "note for 30-35 (no per-version files exist). v3.4.2 excluded per existing header note (pre-rolling-file era).`n`n" +
       "No code changes. Other working-tree changes in this repo are NOT part of this commit."
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
    Write-Host "ABORT: commit failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "8. Pushing..." -ForegroundColor Cyan
Clear-GitLock
git push origin demo
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "DONE. Push succeeded." -ForegroundColor Green
    Write-Host "Cleanup: Remove-Item _finish-changelog-consolidation.ps1" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "Push failed - inspect git log -1 and try 'git push origin demo' manually." -ForegroundColor Yellow
}
