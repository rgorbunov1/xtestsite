const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const rootDir = path.resolve(__dirname, '..');
const productsPath = path.join(rootDir, 'products.json');
const csvPath = path.join(rootDir, 'product-extra-template.csv');
const workbookPath = process.env.PRODUCT_EXTRA_TEMPLATE_PATH
    ? path.resolve(rootDir, process.env.PRODUCT_EXTRA_TEMPLATE_PATH)
    : path.join(rootDir, 'product-extra-template.xlsx');
const CSV_DELIMITER = ';';

const HEADER = [
    'product_id',
    'product_name',
    'product_article',
    'product_category',
    'product_price',
    'product_stock',
    'main_image',
    'gallery_1',
    'gallery_2',
    'gallery_3',
    'gallery_4',
    'gallery_5',
    'description',
    'spec_1_name',
    'spec_1_value',
    'spec_2_name',
    'spec_2_value',
    'spec_3_name',
    'spec_3_value',
    'discount_percent',
    'discount_amount',
    'variant_id',
    'variant_name',
    'variant_price',
    'variant_stock',
    'variant_image_1',
    'variant_image_2',
    'variant_image_3',
    'variant_spec_1_name',
    'variant_spec_1_value',
    'variant_spec_2_name',
    'variant_spec_2_value',
];

function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function makeKey(productId, variantId) {
    return `${normalizeValue(productId)}|${normalizeValue(variantId)}`;
}

function detectDelimiter(line) {
    if (!line) return CSV_DELIMITER;
    const semicolonCount = (line.match(/;/g) || []).length;
    const commaCount = (line.match(/,/g) || []).length;
    return semicolonCount >= commaCount ? ';' : ',';
}

function parseCsvLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const next = line[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }

    result.push(current);
    return result.map((value) => value.replace(/^\s+|\s+$/g, ''));
}

function parseExistingCsv(text) {
    if (!text || !text.trim()) return [];

    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) return [];

    const delimiter = detectDelimiter(lines[0]);
    const headers = parseCsvLine(lines[0], delimiter);
    const rows = [];

    for (let i = 1; i < lines.length; i += 1) {
        const values = parseCsvLine(lines[i], delimiter);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] !== undefined ? values[index] : '';
        });
        rows.push(row);
    }

    return rows;
}

function escapeCsvValue(value) {
    const text = normalizeValue(value).replace(/\r\n|\r|\n/g, ' ');
    if (!text) return '';
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
}

function normalizeStock(product) {
    if (typeof product.stock === 'number') return product.stock;
    if (Array.isArray(product.stockByWarehouse)) {
        return product.stockByWarehouse.reduce((sum, warehouse) => sum + (Number(warehouse && warehouse.qty) || 0), 0);
    }
    return 0;
}

function extractProductRows(products) {
    const rows = [];

    products.forEach((product) => {
        const baseRow = {
            product_id: product.id || '',
            product_name: product.name || '',
            product_article: product.article || '',
            product_category: product.category || '',
            product_price: product.price ?? '',
            product_stock: normalizeStock(product),
            main_image: product.image || '',
            gallery_1: '',
            gallery_2: '',
            gallery_3: '',
            gallery_4: '',
            gallery_5: '',
            description: product.description || '',
            spec_1_name: '',
            spec_1_value: '',
            spec_2_name: '',
            spec_2_value: '',
            spec_3_name: '',
            spec_3_value: '',
            discount_percent: '',
            discount_amount: '',
            variant_id: '',
            variant_name: '',
            variant_price: '',
            variant_stock: '',
            variant_image_1: '',
            variant_image_2: '',
            variant_image_3: '',
            variant_spec_1_name: '',
            variant_spec_1_value: '',
            variant_spec_2_name: '',
            variant_spec_2_value: '',
        };

        if (Array.isArray(product.variants) && product.variants.length > 0) {
            product.variants.forEach((variant) => {
                const row = { ...baseRow };
                row.variant_id = variant.id || '';
                row.variant_name = variant.name || '';
                row.variant_price = variant.price ?? '';
                row.variant_stock = variant.stock ?? 0;
                row.discount_percent = variant.discount_percent || variant.discountPercent || '';
                row.discount_amount = variant.discount_amount || variant.discountAmount || '';
                rows.push(row);
            });
        } else {
            rows.push(baseRow);
        }
    });

    return rows;
}

function mergeWithExistingRows(productsRows, existingRows) {
    const existingMap = new Map();
    existingRows.forEach((row) => {
        const key = makeKey(row.product_id, row.variant_id);
        if (key) {
            existingMap.set(key, row);
        }
    });

    const merged = [];
    const usedKeys = new Set();

    productsRows.forEach((row) => {
        const key = makeKey(row.product_id, row.variant_id);
        usedKeys.add(key);

        const existing = existingMap.get(key) || {};
        const mergedRow = {
            ...row,
            ...existing,
        };

        if (!mergedRow.product_id && row.product_id) {
            mergedRow.product_id = row.product_id;
        }
        if (!mergedRow.product_name && row.product_name) {
            mergedRow.product_name = row.product_name;
        }
        if (normalizeValue(row.description)) {
            mergedRow.description = row.description;
        }

        merged.push(mergedRow);
    });

    existingRows.forEach((row) => {
        const key = makeKey(row.product_id, row.variant_id);
        if (!usedKeys.has(key)) {
            merged.push(row);
        }
    });

    return merged;
}

function writeCsv(rows) {
    const lines = [HEADER.join(CSV_DELIMITER)];

    rows.forEach((row) => {
        const values = HEADER.map((key) => escapeCsvValue(row[key]));
        lines.push(values.join(CSV_DELIMITER));
    });

    const text = '\uFEFF' + lines.join('\r\n') + '\r\n';
    const tempPath = `${csvPath}.tmp`;

    try {
        fs.writeFileSync(tempPath, text, 'utf8');
        fs.renameSync(tempPath, csvPath);
    } catch (error) {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }

        if (error && (error.code === 'EBUSY' || error.code === 'EPERM')) {
            console.warn('CSV-копия не обновлена: закройте product-extra-template.csv, чтобы синхронизировать и её. XLSX-книга создана.');
            return;
        }

        throw error;
    }
}

function cellToValue(cell) {
    const value = cell.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        if (Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
        if (value.result !== undefined) return value.result;
        return cell.text || '';
    }
    return value;
}

async function readExistingWorkbook() {
    if (!fs.existsSync(workbookPath)) return [];

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const worksheet = workbook.getWorksheet('Товары') || workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];

    const headers = HEADER.map((_, index) => normalizeValue(cellToValue(worksheet.getRow(1).getCell(index + 1))));
    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const worksheetRow = worksheet.getRow(rowNumber);
        const row = {};
        headers.forEach((header, index) => {
            if (header) row[header] = cellToValue(worksheetRow.getCell(index + 1));
        });
        rows.push(row);
    }
    return rows;
}

async function writeWorkbook(rows) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Product catalog generator';
    workbook.modified = new Date();
    const worksheet = workbook.addWorksheet('Товары');

    worksheet.columns = HEADER.map((key) => ({
        header: key,
        key,
        width: key.includes('description') ? 42 : key.includes('name') ? 24 : 18,
    }));
    worksheet.addRows(rows.map((row) => HEADER.map((key) => row[key] ?? '')));
    worksheet.views = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
    worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(HEADER.length).letter}${rows.length + 1}` };
    worksheet.getRow(1).height = 30;
    worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF285C4D' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
    });

    const tempPath = `${workbookPath}.tmp`;
    await workbook.xlsx.writeFile(tempPath);
    try {
        fs.renameSync(tempPath, workbookPath);
    } catch (error) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        if (error && (error.code === 'EBUSY' || error.code === 'EPERM')) {
            console.error('Файл product-extra-template.xlsx открыт в Excel. Закройте его и запустите генерацию ещё раз.');
            process.exit(1);
        }
        throw error;
    }
}

async function main() {
    if (!fs.existsSync(productsPath)) {
        console.error('Не найден файл products.json.');
        process.exit(1);
    }

    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const currentProductsRows = extractProductRows(Array.isArray(products) ? products : []);

    const existingRows = fs.existsSync(workbookPath)
        ? await readExistingWorkbook()
        : fs.existsSync(csvPath)
            ? parseExistingCsv(fs.readFileSync(csvPath, 'utf8'))
            : [];

    const mergedRows = mergeWithExistingRows(currentProductsRows, existingRows);
    await writeWorkbook(mergedRows);
    writeCsv(mergedRows);

    console.log(`Синхронизирована книга Excel: ${path.relative(rootDir, workbookPath)} (${mergedRows.length} строк)`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
