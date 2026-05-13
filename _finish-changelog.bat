@echo off
REM Finish CHANGELOG consolidation - cmd.exe compatible
REM Run from C:\Projects\eq-solves-field
REM Each step kills the index.lock first because Cowork sandbox
REM keeps orphaning them via virtiofs.

echo.
echo === 1. clear lock + pull origin demo (you are 8 commits behind) ===
if exist .git\index.lock del /f /q .git\index.lock
git pull origin demo || goto :err

echo.
echo === 2. clear lock + git rm 24 per-version changelog files ===
if exist .git\index.lock del /f /q .git\index.lock
git rm "CHANGELOG-v3.4.*.md" || goto :err

echo.
echo === 3. clear lock + force-add CHANGELOG.md (it's in .git/info/exclude) ===
if exist .git\index.lock del /f /q .git\index.lock
git add -f CHANGELOG.md || goto :err

echo.
echo === 4. show what will commit (should be ONLY changelog files) ===
if exist .git\index.lock del /f /q .git\index.lock
git diff --cached --stat

echo.
echo === 5. commit ===
if exist .git\index.lock del /f /q .git\index.lock
git commit -m "docs(changelog): consolidate 24 per-version files into rolling CHANGELOG.md" || goto :err

echo.
echo === 6. push ===
if exist .git\index.lock del /f /q .git\index.lock
git push origin demo || goto :err

echo.
echo === DONE. delete this script when ready: del _finish-changelog.bat ===
goto :eof

:err
echo.
echo *** STEP FAILED *** see error above. fix and re-run.
exit /b 1
