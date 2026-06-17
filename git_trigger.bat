@echo off
set GIT_PATH="C:\Program Files\Git\cmd\git.exe"

echo Adding files...
%GIT_PATH% commit --allow-empty -m "Trigger Vercel deploy"
%GIT_PATH% push
