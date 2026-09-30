@echo off
cd /d "%~dp0"
node scripts/generate-product-extra-template.js
node scripts/build-product-catalog.js
git add .
git commit -m "Auto sync от %date% %time%"
git push