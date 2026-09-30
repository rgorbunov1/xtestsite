@echo off
cd /d "%~dp0"
node scripts/build-product-catalog.js
git add .
git commit -m "Автоматическая синхронизация от %date% %time%"
git push