const fs = require('fs');
const path = require('path');
const pathPosix = path.posix;
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { SaxesParser } = require('saxes');

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
const BROWSER_IMAGE_EXTENSIONS = new Set(['apng', 'avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

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
            'Вставьте картинку обычным объектом или выберите «Поместить в ячейку»; формулы IMAGE() не поддерживаются.'
        );
        return '';
    }

    return cellValue;
}

function getCellImageName(cell) {
    const value = cell.value;
    const formula = value && typeof value === 'object'
        ? value.formula || value.sharedFormula || ''
        : '';
    const match = String(formula).match(/(?:_xlfn\.)?DISPIMG\s*\(\s*["']([^"']+)["']/i);
    return match ? match[1] : '';
}

function getXmlAttribute(attributes, name) {
    const key = Object.keys(attributes).find((attributeName) => {
        return attributeName.split(':').pop() === name;
    });
    return key ? attributes[key] : '';
}

function getLocalName(name) {
    return name.split(':').pop();
}

function parseXml(xml, onOpenTag, onCloseTag, onText) {
    const parser = new SaxesParser({ xmlns: false });
    parser.on('opentag', onOpenTag);
    if (onCloseTag) parser.on('closetag', onCloseTag);
    if (onText) parser.on('text', onText);
    parser.write(xml).close();
}

function resolvePackageTarget(sourcePath, target) {
    const normalizedTarget = target.replace(/\\/g, '/');
    return normalizedTarget.startsWith('/')
        ? normalizedTarget.slice(1)
        : pathPosix.normalize(pathPosix.join(pathPosix.dirname(sourcePath), normalizedTarget));
}

async function readPackageRelationships(archive, sourcePath) {
    const relationshipsPath = pathPosix.join(
        pathPosix.dirname(sourcePath),
        '_rels',
        pathPosix.basename(sourcePath) + '.rels'
    );
    const relationshipsFile = archive.file(relationshipsPath);
    const relationships = new Map();
    if (!relationshipsFile) return relationships;

    const relationshipsXml = await relationshipsFile.async('string');
    parseXml(relationshipsXml, (tag) => {
        if (getLocalName(tag.name) !== 'Relationship') return;
        if (getXmlAttribute(tag.attributes, 'TargetMode') === 'External') return;
        const id = getXmlAttribute(tag.attributes, 'Id');
        const target = getXmlAttribute(tag.attributes, 'Target');
        if (id && target) relationships.set(id, resolvePackageTarget(sourcePath, target));
    });
    return relationships;
}

async function getWorksheetPath(archive, worksheet) {
    const workbookPath = 'xl/workbook.xml';
    const workbookFile = archive.file(workbookPath);
    if (!workbookFile) return `xl/worksheets/sheet${worksheet.id}.xml`;

    const workbookXml = await workbookFile.async('string');
    const relationships = await readPackageRelationships(archive, workbookPath);
    let worksheetRelationship = '';
    parseXml(workbookXml, (tag) => {
        if (getLocalName(tag.name) !== 'sheet') return;
        if (getXmlAttribute(tag.attributes, 'name') === worksheet.name) {
            worksheetRelationship = getXmlAttribute(tag.attributes, 'id');
        }
    });
    return relationships.get(worksheetRelationship) || `xl/worksheets/sheet${worksheet.id}.xml`;
}

async function readRichDataImages(archive, worksheet) {
    const byCell = new Map();
    const metadataPath = Object.keys(archive.files).find((name) => /(?:^|\/)metadata\.xml$/i.test(name));
    const richValuesPath = Object.keys(archive.files).find((name) => /(?:^|\/)rdrichvalue\.xml$/i.test(name));
    const structuresPath = Object.keys(archive.files).find((name) => /(?:^|\/)rdrichvaluestructure\.xml$/i.test(name));
    const relationshipsPath = Object.keys(archive.files).find((name) => /(?:^|\/)richValueRel\.xml$/i.test(name));
    const worksheetPath = await getWorksheetPath(archive, worksheet);
    const worksheetFile = archive.file(worksheetPath);
    if (!metadataPath || !richValuesPath || !structuresPath || !relationshipsPath || !worksheetFile) return byCell;

    const metadataTypes = [];
    const futureMetadata = new Map();
    const valueMetadata = [];
    let metadataSection = '';
    let metadataName = '';
    let currentMetadataRecord = null;
    const metadataXml = await archive.file(metadataPath).async('string');
    parseXml(metadataXml, (tag) => {
        const tagName = getLocalName(tag.name);
        if (tagName === 'metadataType') metadataTypes.push(getXmlAttribute(tag.attributes, 'name'));
        else if (tagName === 'futureMetadata') {
            metadataSection = 'future';
            metadataName = getXmlAttribute(tag.attributes, 'name');
            if (!futureMetadata.has(metadataName)) futureMetadata.set(metadataName, []);
        } else if (tagName === 'valueMetadata') metadataSection = 'value';
        else if (tagName === 'bk') currentMetadataRecord = { entries: [] };
        else if (tagName === 'rvb' && currentMetadataRecord) {
            currentMetadataRecord.richValueIndex = Number(getXmlAttribute(tag.attributes, 'i'));
        } else if (tagName === 'rc' && currentMetadataRecord) {
            currentMetadataRecord.entries.push({
                type: Number(getXmlAttribute(tag.attributes, 't')),
                value: Number(getXmlAttribute(tag.attributes, 'v')),
            });
        }
    }, (tag) => {
        const tagName = getLocalName(typeof tag === 'string' ? tag : tag.name);
        if (tagName === 'bk' && currentMetadataRecord) {
            if (metadataSection === 'future') futureMetadata.get(metadataName).push(currentMetadataRecord);
            else if (metadataSection === 'value') valueMetadata.push(currentMetadataRecord);
            currentMetadataRecord = null;
        } else if (tagName === 'futureMetadata' || tagName === 'valueMetadata') {
            metadataSection = '';
            metadataName = '';
        }
    });

    const richTypeIndex = metadataTypes.indexOf('XLRICHVALUE') + 1;
    const richIndexByMetadata = new Map();
    valueMetadata.forEach((record, index) => {
        const richEntry = record.entries.find((entry) => entry.type === richTypeIndex);
        if (!richEntry) return;
        const futureRecord = (futureMetadata.get('XLRICHVALUE') || [])[richEntry.value];
        if (futureRecord && Number.isInteger(futureRecord.richValueIndex)) {
            richIndexByMetadata.set(index + 1, futureRecord.richValueIndex);
        }
    });

    const richValues = [];
    let currentRichValue = null;
    let readingRichValue = false;
    let richValueText = '';
    const richValuesXml = await archive.file(richValuesPath).async('string');
    parseXml(richValuesXml, (tag) => {
        const tagName = getLocalName(tag.name);
        if (tagName === 'rv') {
            currentRichValue = {
                structureIndex: Number(getXmlAttribute(tag.attributes, 's')),
                values: [],
            };
        } else if (tagName === 'v' && currentRichValue) {
            readingRichValue = true;
            richValueText = '';
        }
    }, (tag) => {
        const tagName = getLocalName(typeof tag === 'string' ? tag : tag.name);
        if (tagName === 'v' && currentRichValue && readingRichValue) {
            currentRichValue.values.push(Number(richValueText));
            readingRichValue = false;
        } else if (tagName === 'rv' && currentRichValue) {
            richValues.push(currentRichValue);
            currentRichValue = null;
        }
    }, (text) => {
        if (readingRichValue) richValueText += text;
    });

    const structures = [];
    let currentStructure = null;
    const structuresXml = await archive.file(structuresPath).async('string');
    parseXml(structuresXml, (tag) => {
        const tagName = getLocalName(tag.name);
        if (tagName === 's') {
            currentStructure = {
                type: getXmlAttribute(tag.attributes, 't'),
                keys: [],
            };
        } else if (tagName === 'k' && currentStructure) {
            currentStructure.keys.push(getXmlAttribute(tag.attributes, 'n'));
        }
    }, (tag) => {
        const tagName = getLocalName(typeof tag === 'string' ? tag : tag.name);
        if (tagName === 's' && currentStructure) {
            structures.push(currentStructure);
            currentStructure = null;
        }
    });

    const richValueRelationshipsFile = archive.file(relationshipsPath);
    const richValueRelationshipIds = [];
    if (richValueRelationshipsFile) {
        const richValueRelationshipsXml = await richValueRelationshipsFile.async('string');
        parseXml(richValueRelationshipsXml, (tag) => {
            if (getLocalName(tag.name) === 'rel') {
                richValueRelationshipIds.push(getXmlAttribute(tag.attributes, 'id'));
            }
        });
    }
    const richImageRelationships = await readPackageRelationships(archive, relationshipsPath);
    const worksheetXml = await worksheetFile.async('string');
    parseXml(worksheetXml, (tag) => {
        if (getLocalName(tag.name) !== 'c') return;
        const cellAddress = getXmlAttribute(tag.attributes, 'r');
        const metadataIndex = Number(getXmlAttribute(tag.attributes, 'vm'));
        if (!cellAddress || !metadataIndex) return;

        const richIndex = richIndexByMetadata.get(metadataIndex);
        const richValue = Number.isInteger(richIndex) ? richValues[richIndex] : null;
        const structure = richValue && structures[richValue.structureIndex];
        if (!structure || structure.type !== '_localImage') return;

        const localImageIdIndex = structure.keys.findIndex((key) => key.endsWith('LocalImageIdentifier'));
        if (localImageIdIndex < 0) return;

        const relationshipId = richValueRelationshipIds[richValue.values[localImageIdIndex]];
        const mediaPath = richImageRelationships.get(relationshipId);
        const mediaFile = mediaPath && archive.file(mediaPath);
        if (mediaFile) {
            byCell.set(cellAddress, {
                mediaFile,
                extension: pathPosix.extname(mediaPath).slice(1).toLowerCase() || 'img',
            });
        }
    });

    for (const [cellAddress, image] of byCell) {
        byCell.set(cellAddress, {
            buffer: await image.mediaFile.async('nodebuffer'),
            extension: image.extension,
        });
    }
    return byCell;
}

async function readCellImages(workbookPath, worksheet) {
    const archive = await JSZip.loadAsync(fs.readFileSync(workbookPath));
    const imagesByCell = await readRichDataImages(archive, worksheet);
    const cellImagesPath = Object.keys(archive.files).find((name) => {
        return /(?:^|\/)cellimages\.xml$/i.test(name);
    });
    const imagesByName = new Map();
    if (!cellImagesPath) return { byCell: imagesByCell, byName: imagesByName };

    const relationships = await readPackageRelationships(archive, cellImagesPath);

    const cellImagesFile = archive.file(cellImagesPath);
    const cellImagesXml = await cellImagesFile.async('string');
    const imageRelationships = new Map();
    let currentName = '';

    parseXml(cellImagesXml, (tag) => {
        const tagName = tag.name.split(':').pop();
        if (tagName === 'cellImage') {
            currentName = getXmlAttribute(tag.attributes, 'name');
        } else if (tagName === 'blip' && currentName) {
            const relationshipId = getXmlAttribute(tag.attributes, 'embed');
            if (relationshipId) imageRelationships.set(currentName, relationshipId);
        }
    }, (tag) => {
        const tagName = typeof tag === 'string' ? tag : tag.name;
        if (tagName.split(':').pop() === 'cellImage') currentName = '';
    });

    const images = new Map();
    for (const [imageName, relationshipId] of imageRelationships) {
        const mediaPath = relationships.get(relationshipId);
        const mediaFile = mediaPath && archive.file(mediaPath);
        if (!mediaFile) continue;

        const extension = pathPosix.extname(mediaPath).slice(1).toLowerCase();
        imagesByName.set(imageName, {
            buffer: await mediaFile.async('nodebuffer'),
            extension: extension || 'img',
        });
    }

    return { byCell: imagesByCell, byName: imagesByName };
}

function safeFilenamePart(value) {
    return normalizeValue(value).replace(/[^a-zA-Z0-9_-]/g, '_') || 'item';
}

async function saveImage(row, rowIndex, column, sourceImage, rootDir) {
    if (!sourceImage || !Buffer.isBuffer(sourceImage.buffer)) {
        throw new Error(`Не удалось прочитать картинку из ${column}, строка ${rowIndex}.`);
    }

    let extension = normalizeValue(sourceImage.extension).toLowerCase().replace(/[^a-z0-9]/g, '') || 'img';
    let imageBuffer = sourceImage.buffer;
    if (!BROWSER_IMAGE_EXTENSIONS.has(extension)) {
        try {
            imageBuffer = await sharp(imageBuffer).png().toBuffer();
            extension = 'png';
        } catch (error) {
            throw new Error(`Не удалось преобразовать изображение .${extension} из поля ${column}, строка ${rowIndex}: ${error.message}`);
        }
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
    fs.writeFileSync(absolutePath, imageBuffer);
    return relativePath;
}

async function readProductExtraWorkbook(workbookPath, rootDir, expectedHeaders) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const worksheet = workbook.getWorksheet('Товары') || workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];

    const headers = worksheet.getRow(1).values.slice(1).map(normalizeValue);
    const embeddedImages = await readCellImages(workbookPath, worksheet);
    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const worksheetRow = worksheet.getRow(rowNumber);
        const row = {};
        const pendingCellImages = [];
        headers.forEach((header, index) => {
            if (!header) return;

            const cell = worksheetRow.getCell(index + 1);
            const inCellImage = IMAGE_COLUMNS.has(header) ? embeddedImages.byCell.get(cell.address) : null;
            if (inCellImage) {
                pendingCellImages.push({ column: header, image: inCellImage });
                row[header] = '';
                return;
            }

            const cellImageName = IMAGE_COLUMNS.has(header) ? getCellImageName(cell) : '';
            if (cellImageName && embeddedImages.byName.has(cellImageName)) {
                pendingCellImages.push({ column: header, image: embeddedImages.byName.get(cellImageName) });
                row[header] = '';
                return;
            }

            row[header] = cellToValue(cell, header, rowNumber);
        });
        for (const { column, image } of pendingCellImages) {
            row[column] = await saveImage(row, rowNumber, column, image, rootDir);
        }
        rows.push(row);
    }

    const media = workbook.model.media || [];
    const images = worksheet.getImages();
    for (const image of images) {
        if (image.type !== 'image' || !image.range || !image.range.tl) continue;

        const rowIndex = Math.floor(image.range.tl.row);
        const columnIndex = Math.floor(image.range.tl.col);
        const row = rows[rowIndex - 1];
        const column = headers[columnIndex];
        if (!row || !IMAGE_COLUMNS.has(column)) continue;

        row[column] = await saveImage(row, rowIndex + 1, column, media[image.imageId], rootDir);
    }

    return rows;
}

module.exports = { readProductExtraWorkbook };
