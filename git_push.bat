@echo off
set GIT_PATH="C:\Program Files\Git\cmd\git.exe"
echo Committing and pushing...
%GIT_PATH% add .
%GIT_PATH% commit -m "Fix TypeScript build errors - StudyPlan type and PDF route"
%GIT_PATH% push
