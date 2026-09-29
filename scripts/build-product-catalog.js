const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const rootDir = path.resolve(__dirname, '..');
const productsPath = path.join(rootDir, 'products.json');
const extraCsvPath = path.join(rootDir, 'product-extra-template.csv');
const extraWorkbookPath = path.join(rootDir, 'product-extra-template.xlsx');
const outputPath = path.join(rootDir, 'products-merged.json');

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
    return result.map((value) => value.trim());
}

function parseCsv(text) {
    if (!text || !text.trim()) {
        return [];
    }

    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) {
        return [];
    }

    const semicolonCount = (lines[0].match(/;/g) || []).length;
    const commaCount = (lines[0].match(/,/g) || []).length;
    const delimiter = semicolonCount >= commaCount ? ';' : ',';
    const headers = parseCsvLine(lines[0], delimiter);
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line, delimiter);
        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index] !== undefined ? values[index] : '';
        });

        return row;
    });
}

function normalizeValue(value) {
    if (value === undefined || value === null) {
        return '';
    }

    return String(value).trim();
}

function toNumber(value, fallback) {
    const num = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(num) ? num : fallback;
}

function lookupFirst(row, keys) {
    for (let i = 0; i < keys.length; i += 1) {
        const value = normalizeValue(row[keys[i]]);
        if (value) {
            return value;
        }
    }
    return '';
}

function collectImageFields(row, prefix) {
    const values = [];

    for (let i = 1; i <= 10; i += 1) {
        const value = lookupFirst(row, [`${prefix}_${i}`, `${prefix}${i}`]);
        if (value) {
            values.push(value);
        }
    }

    if (!values.length) {
        const fallback = lookupFirst(row, [prefix]);
        if (fallback) {
            values.push(fallback);
        }
    }

    return values;
}

function parseSpecs(row, prefix = 'spec') {
    const specs = [];

    for (let i = 1; i <= 10; i += 1) {
        const nameKey = `${prefix}_${i}_name`;
        const valueKey = `${prefix}_${i}_value`;
        const legacyNameKey = `${prefix}_${i}__name`;
        const legacyValueKey = `${prefix}_${i}__value`;
        const name = lookupFirst(row, [nameKey, legacyNameKey]);
        const value = lookupFirst(row, [valueKey, legacyValueKey]);

        if (name || value) {
            specs.push({
                name: name || `Характеристика ${i}`,
                value: value || '—',
            });
        }
    }

    return specs;
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

async function extractExtraRows() {
    if (fs.existsSync(extraWorkbookPath)) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(extraWorkbookPath);
        const worksheet = workbook.getWorksheet('Товары') || workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount < 2) return [];

        const headers = worksheet.getRow(1).values.slice(1).map(normalizeValue);
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

    if (!fs.existsSync(extraCsvPath)) return [];
    return parseCsv(fs.readFileSync(extraCsvPath, 'utf8'));
}

function buildExtraIndex(rows) {
    const entries = new Map();

    rows.forEach((row) => {
        const productId = lookupFirst(row, ['id', 'product_id', 'productId', 'parent_id']);
        if (!productId) {
            return;
        }

        if (!entries.has(productId)) {
            entries.set(productId, {
                image: '',
                gallery: [],
                description: '',
                specs: [],
                discountPercent: undefined,
                discountAmount: undefined,
                variants: [],
            });
        }

        const entry = entries.get(productId);
        const mainImage = lookupFirst(row, ['main_image', 'image', 'product_image']);
        if (mainImage) {
            entry.image = mainImage;
        }

        const gallery = collectImageFields(row, 'gallery');
        if (gallery.length) {
            entry.gallery = [...new Set([...entry.gallery, ...gallery])];
        }

        const description = lookupFirst(row, ['description', 'short_description']);
        if (description) {
            entry.description = description;
        }

        const specRows = parseSpecs(row, 'spec');
        if (specRows.length) {
            entry.specs = [...entry.specs, ...specRows];
        }

        const variantId = lookupFirst(row, ['variant_id', 'option_id', 'id_variant']);
        if (variantId) {
            const variantName = lookupFirst(row, ['variant_name', 'option_name', 'name', 'variant']);
            const variantImages = [1, 2, 3]
                .map((number) => lookupFirst(row, [`variant_image_${number}`]))
                .filter(Boolean);
            const variant = {
                id: variantId,
                name: variantName || 'Вариант',
                price: toNumber(lookupFirst(row, ['variant_price', 'price']), undefined),
                stock: toNumber(lookupFirst(row, ['variant_stock', 'stock']), 0),
                image: lookupFirst(row, ['variant_image', 'option_image']) || variantImages[0],
                gallery: collectImageFields(row, 'variant_gallery').length
                    ? collectImageFields(row, 'variant_gallery')
                    : variantImages.slice(1).length
                        ? variantImages.slice(1)
                        : collectImageFields(row, 'gallery'),
                specs: parseSpecs(row, 'variant_spec'),
            };
            const variantDiscountPercent = lookupFirst(row, [
                'variant_discount_percent',
                'variantDiscountPercent',
                'discount_percent',
                'discountPercent',
            ]);
            const variantDiscountAmount = lookupFirst(row, [
                'variant_discount_amount',
                'variantDiscountAmount',
                'discount_amount',
                'discountAmount',
            ]);
            if (variantDiscountPercent) {
                variant.discountPercent = toNumber(variantDiscountPercent, undefined);
            }
            if (variantDiscountAmount) {
                variant.discountAmount = toNumber(variantDiscountAmount, undefined);
            }

            const existingVariant = entry.variants.find((item) => item.id === variant.id);
            if (existingVariant) {
                Object.assign(existingVariant, variant);
            } else {
                entry.variants.push(variant);
            }
        } else {
            const discountPercent = lookupFirst(row, ['discount_percent', 'discountPercent']);
            const discountAmount = lookupFirst(row, ['discount_amount', 'discountAmount']);
            if (discountPercent) {
                entry.discountPercent = toNumber(discountPercent, undefined);
            }
            if (discountAmount) {
                entry.discountAmount = toNumber(discountAmount, undefined);
            }
        }
    });

    return entries;
}

function mergeProducts(products, extraIndex) {
    return products.map((product) => {
        const extra = extraIndex.get(String(product.id)) || {};
        const merged = { ...product };

        if (extra.image) {
            merged.image = extra.image;
        }

        if (extra.gallery && extra.gallery.length) {
            merged.gallery = extra.gallery;
        }

        if (extra.description) {
            merged.description = extra.description;
        }

        if (extra.discountPercent !== undefined) {
            merged.discountPercent = extra.discountPercent;
        }

        if (extra.discountAmount !== undefined) {
            merged.discountAmount = extra.discountAmount;
        }

        if (extra.specs && extra.specs.length) {
            merged.specs = extra.specs;
        }

        if (extra.variants && extra.variants.length) {
            const baseVariants = Array.isArray(product.variants) ? product.variants.map((variant) => ({ ...variant })) : [];
            const extraVariantsById = new Map(extra.variants
                .filter((variant) => variant && variant.id)
                .map((variant) => [String(variant.id), variant]));
            const baseVariantIds = new Set(baseVariants.map((variant) => String(variant.id)));

            merged.variants = baseVariants.map((variant) => {
                const extraVariant = extraVariantsById.get(String(variant.id));
                if (!extraVariant) return variant;

                return {
                    ...variant,
                    image: extraVariant.image || variant.image || '',
                    gallery: extraVariant.gallery && extraVariant.gallery.length
                        ? extraVariant.gallery
                        : variant.gallery || [],
                    specs: extraVariant.specs && extraVariant.specs.length
                        ? extraVariant.specs
                        : variant.specs,
                    discountPercent: extraVariant.discountPercent ?? variant.discountPercent ?? variant.discount_percent,
                    discountAmount: extraVariant.discountAmount ?? variant.discountAmount ?? variant.discount_amount,
                };
            });

            extra.variants.forEach((variant) => {
                if (!variant || !variant.id || baseVariantIds.has(String(variant.id))) return;
                merged.variants.push({
                    ...variant,
                    price: variant.price ?? product.price ?? 0,
                    image: variant.image || merged.image || product.image || '',
                    gallery: variant.gallery && variant.gallery.length ? variant.gallery : merged.gallery || [],
                    discountPercent: variant.discountPercent ?? variant.discount_percent,
                    discountAmount: variant.discountAmount ?? variant.discount_amount,
                });
            });
        }

        if (!merged.image && merged.variants && merged.variants.length) {
            const firstVariantImage = merged.variants.find((variant) => variant.image)?.image;
            if (firstVariantImage) {
                merged.image = firstVariantImage;
            }
        }

        return merged;
    });
}

async function main() {
    if (!fs.existsSync(productsPath)) {
        console.error('Не найден файл products.json в корне проекта.');
        process.exit(1);
    }

    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const extraRows = await extractExtraRows();
    const extraIndex = buildExtraIndex(extraRows);
    const mergedProducts = mergeProducts(products, extraIndex);

    fs.writeFileSync(outputPath, JSON.stringify(mergedProducts, null, 2) + '\n', 'utf8');
    console.log(`Собрано: ${mergedProducts.length} товаров в ${path.relative(rootDir, outputPath)}.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
