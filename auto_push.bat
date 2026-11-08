@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "MANIFEST_BASE=%TEMP%\xtestsite-deploy-%RANDOM%-%RANDOM%"

echo Синхронизация запущена: %date% %time%
echo === 1. Генерация шаблона: %date% %time% ===
node scripts/generate-product-extra-template.js
if errorlevel 1 goto :err

echo Шаблон готов: %date% %time%
echo === 2. Сборка каталога: %date% %time% ===
node scripts/build-product-catalog.js
if errorlevel 1 goto :err

echo Каталог собран: %date% %time%
echo === 3. Подготовка списка файлов сайта: %date% %time% ===
node scripts/create-deploy-manifest.js "%MANIFEST_BASE%"
if errorlevel 1 goto :err

echo Список файлов готов: %date% %time%
echo === 4. Выгрузка файлов сайта и изображений: %date% %time% ===
rclone copy . yandex-s3:testx1112.site --files-from-raw "%MANIFEST_BASE%-assets.txt" --header-upload Cache-Control:no-cache --transfers 8 --checkers 16 --retries 3 --low-level-retries 10 -P
if errorlevel 1 goto :err

echo Файлы и изображения выгружены: %date% %time%
echo === 5. Публикация каталога после его изображений: %date% %time% ===
rclone copy . yandex-s3:testx1112.site --files-from-raw "%MANIFEST_BASE%-catalog.txt" --header-upload Cache-Control:no-cache --no-traverse --transfers 4 --checkers 8 --retries 3 --low-level-retries 10 -P
if errorlevel 1 goto :err

del /q "%MANIFEST_BASE%-assets.txt" "%MANIFEST_BASE%-catalog.txt" >nul 2>&1
echo Синхронизация завершена: %date% %time%
echo === Публикация сайта завершена ===
exit /b 0

:err
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" set "EXIT_CODE=1"
del /q "%MANIFEST_BASE%-assets.txt" "%MANIFEST_BASE%-catalog.txt" >nul 2>&1
echo ОШИБКА: публикация сайта не завершена. Код: %EXIT_CODE%
pause
exit /b %EXIT_CODE%
