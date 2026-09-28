@echo off
cd /d "%~dp0"
git add .
git commit -m "Автоматическая синхронизация от %date% %time%"
git push