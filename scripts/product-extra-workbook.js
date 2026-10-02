const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const IMAGE_COLUMNS = new Set([
    'main_image',
    'gallery_1',
    'gallery_2',
    'gallery_3',
    'gallery_4',
    'gallery_5',
    'variant_image_1',
    'variant_image_2',
    'variant_image_3',
    'variant_image_4',
    'variant_image_5',
    'variant_image_6',
    'variant_image_7',
    'variant_image_8',
    'variant_image_9',
    'variant_image_10',
]);
const EXCEL_ERROR_PATTERN = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|FIELD!|BLOCKED!|UNKNOWN!|CONNECT!|BUSY!|GETTING_DATA)$/i;

function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function cellToValue(cell, column, rowNumber) {
    let cellValue = cell.value;
    if (cellValue === null || cellValue === undefined) return '';
    if (typeof cellValue === 'object') {
        if (cellValue.hyperlink) cellValue = cellValue.hyperlink;
        else if (Array.isArray(cellValue.richText)) cellValue = cellValue.richText.map((item) => item.text).join('');
        else if (cellValue.result !== undefined) cellValue = cellValue.result;
        else cellValue = cell.text || '';
    }

    if (IMAGE_COLUMNS.has(column) && typeof cellValue === 'string' && EXCEL_ERROR_PATTERN.test(cellValue.trim())) {
        console.warn(
            `Предупреждение: в строке ${rowNumber}, поле ${column}, найдено ${cellValue}; значение пропущено. ` +
            'Для загрузки картинки вставьте её как обычный объект поверх ячейки.'
        );
        return '';
    }

    return cellValue;
}

function safeFilenamePart(value) {
    return normalizeValue(value).replace(/[^a-zA-Z0-9_-]/g, '_') || 'item';
}

async function readProductExtraWorkbook(workbookPath, rootDir, expectedHeaders) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const worksheet = workbook.getWorksheet('Товары') || workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];

    const headers = worksheet.getRow(1).values.slice(1).map(normalizeValue);
    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const worksheetRow = worksheet.getRow(rowNumber);
        const row = {};
        headers.forEach((header, index) => {
            if (header) row[header] = cellToValue(worksheetRow.getCell(index + 1), header, rowNumber);
        });
        rows.push(row);
    }

    const media = workbook.model.media || [];
    const images = worksheet.getImages();
    images.forEach((image) => {
        if (image.type !== 'image' || !image.range || !image.range.tl) return;

        const rowIndex = Math.floor(image.range.tl.row);
        const columnIndex = Math.floor(image.range.tl.col);
        const row = rows[rowIndex - 1];
        const column = headers[columnIndex];
        if (!row || !IMAGE_COLUMNS.has(column)) return;

        const sourceImage = media[image.imageId];
        if (!sourceImage || !Buffer.isBuffer(sourceImage.buffer)) {
            throw new Error(`Не удалось прочитать картинку из ${column}, строка ${rowIndex + 1}.`);
        }

        const extension = normalizeValue(sourceImage.extension).toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'gif'].includes(extension)) {
            throw new Error(`Формат картинки .${extension || '?'} в строке ${rowIndex + 1} не поддерживается. Используйте PNG, JPG или GIF.`);
        }

        const variantId = normalizeValue(row.variant_id);
        const filename = [
            safeFilenamePart(row.product_id),
            safeFilenamePart(variantId || 'product'),
            column,
        ].join('-') + `.${extension}`;
        const relativePath = `img/products/${filename}`;
        const absolutePath = path.join(rootDir, 'img', 'products', filename);

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, sourceImage.buffer);
        row[column] = relativePath;
    });

    return rows;
}

module.exports = { readProductExtraWorkbook };
