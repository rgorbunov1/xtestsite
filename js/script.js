// ============================
// БУРГЕР-МЕНЮ
// ============================

const burger = document.getElementById('burger');
const nav = document.getElementById('nav');

if (burger && nav) {
    burger.addEventListener('click', function () {
        nav.classList.toggle('active');
    });
}

// ============================
// КОРЗИНА ВЫКЛЮЧЕНА
// ============================
// Все функции, кнопки и UI, связанные с корзиной, временно спрятаны.
// Остальные части сайта остаются рабочими без корзины.
//
// Исходный код корзины сохранён в истории проекта и в коммитах.
// Ниже оставлен только безопасный комментарий, чтобы JS не ломался.
//
// const CART_STORAGE_KEY = 'startshop.cart.v1';
// const CART_DISABLED = true;
// let CART_ITEMS = [];
// function loadCart() {}
// function saveCart() {}
// function cartAdd() {}
// function cartSetQty() {}
// function cartRemove() {}
// function cartClear() {}
// function cartTotalUnits() {}
// function cartTotalSum() {}
// function formatRub() {}
// function refreshCartUi() {}
// function renderHeaderBadge() {}
// function renderMiniCart() {}
// function openMiniCart() {}
// function closeMiniCart() {}
// function initMiniCartToggle() {}
// function renderCartPage() {}
// function showToast() {}
// loadCart();
// initMiniCartToggle();
// refreshCartUi();
// ============================
// КОНТЕЙНЕР ТОВАРОВ (определяем раньше)
// ============================

const productsContainer = document.getElementById('productsContainer') || null;
const anyProductsGrid = document.querySelector('.products');

function resolveAssetPath(path) {
    if (!path) return path;
    if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('#')) {
        return path;
    }

    return new URL(path, window.location.href).toString();
}

let SITE_SETTINGS = {
    contact: {},
    social: {},
    warehouses: {},
};

function parseSiteSettings(documentToRead) {
    const settingsElement = documentToRead.querySelector('#site-settings');
    return settingsElement ? JSON.parse(settingsElement.textContent) : SITE_SETTINGS;
}

function loadSiteSettings() {
    const localSettings = document.querySelector('#site-settings');
    if (localSettings) {
        try {
            return Promise.resolve(JSON.parse(localSettings.textContent));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    return fetch(resolveAssetPath('index.html'), { cache: 'no-store' })
        .then(function (response) {
            if (!response.ok) throw new Error('Не удалось загрузить настройки сайта');
            return response.text();
        })
        .then(function (html) {
            return parseSiteSettings(new DOMParser().parseFromString(html, 'text/html'));
        });
}

function applySiteSettings(root) {
    const container = root || document;
    const contact = SITE_SETTINGS.contact || {};
    const social = SITE_SETTINGS.social || {};
    const phone = contact.phone || '';
    const email = contact.email || '';

    container.querySelectorAll('[data-site-contact="phone"]').forEach(function (link) {
        link.textContent = phone;
        link.href = phone ? 'tel:' + phone.replace(/[^+\d]/g, '') : '#';
        link.hidden = !phone;
    });
    container.querySelectorAll('[data-site-contact="email"]').forEach(function (link) {
        link.textContent = email;
        link.href = email ? 'mailto:' + email : '#';
        link.hidden = !email;
    });
    container.querySelectorAll('[data-site-social]').forEach(function (link) {
        const url = social[link.dataset.siteSocial] || '';
        link.href = url || '#';
        link.hidden = !url;
        if (url) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
    });
}

function loadCatalogData() {
    const mergedUrl = resolveAssetPath('products-merged.json');
    const baseUrl = resolveAssetPath('products.json');

    return fetch(mergedUrl, { cache: 'no-store' })
        .then(function (response) {
            if (!response.ok) {
                return fetch(baseUrl, { cache: 'no-store' })
                    .then(function (baseResponse) {
                        if (!baseResponse.ok) {
                            throw new Error('Не удалось загрузить продукты');
                        }
                        return baseResponse.json();
                    });
            }
            return response.json();
        })
        .catch(function () {
            return fetch(baseUrl, { cache: 'no-store' })
                .then(function (baseResponse) {
                    if (!baseResponse.ok) {
                        throw new Error('Не удалось загрузить продукты');
                    }
                    return baseResponse.json();
                });
        });
}

// ============================
// ГЛОБАЛЬНОЕ ХРАНИЛИЩЕ И НАСТРОЙКИ ПАГИНАЦИИ
// ============================

const PAGE_SIZE = 24;
const CATALOG_SESSION_KEY = 'startshop.catalog-filters.v1';

function readCatalogSessionState() {
    try {
        return JSON.parse(sessionStorage.getItem(CATALOG_SESSION_KEY) || '{}');
    } catch (error) {
        return {};
    }
}

function saveCatalogSessionState() {
    try {
        sessionStorage.setItem(CATALOG_SESSION_KEY, JSON.stringify({
            searchQuery: CURRENT_SEARCH_QUERY,
            filterState: CURRENT_FILTER_STATE,
            priceSort: CURRENT_PRICE_SORT,
            stockWarehouse: CURRENT_STOCK_WAREHOUSE,
        }));
    } catch (error) {
        return;
    }
}

const SAVED_CATALOG_STATE = readCatalogSessionState();

let ALL_PRODUCTS = [];
let CURRENT_SEARCH_QUERY = SAVED_CATALOG_STATE.searchQuery || '';
let CURRENT_FILTER_STATE = Object.assign({
    type: 'all',
    categories: [],
    category: null,
    refine: null,
}, SAVED_CATALOG_STATE.filterState || {});
let CURRENT_PRICE_SORT = SAVED_CATALOG_STATE.priceSort || 'default';
let CURRENT_STOCK_WAREHOUSE = SAVED_CATALOG_STATE.stockWarehouse || '';
let RENDERED_COUNT = 0;
let IS_RENDERING_BATCH = false;
let INFINITE_OBSERVER = null;

// ============================
// ФИЛЬТРАЦИЯ МАССИВА ТОВАРОВ
// ============================

function normalizeString(str) {
    if (!str) return '';
    return String(str).toLowerCase().trim();
}

function productMatchesSearch(product, query) {
    const q = normalizeString(query);
    if (!q) return true;

    const searchFields = [
        product.name,
        product.article,
        product.alt,
        product.category,
    ];

    if (product.categories && Array.isArray(product.categories)) {
        searchFields.push(product.categories.join(' '));
    }

    if (product.variants && Array.isArray(product.variants)) {
        product.variants.forEach(function (v) {
            searchFields.push(v.name);
        });
    }

    const haystack = normalizeString(searchFields.join(' '));
    const queryWords = q.split(/\s+/).filter(function (w) {
        return w.length > 0;
    });

    return queryWords.every(function (word) {
        return haystack.indexOf(word) !== -1;
    });
}

function getVisibleWarehouseEntries(stockList) {
    if (!Array.isArray(stockList) || stockList.length === 0) {
        return [];
    }

    return stockList.filter(function (warehouse) {
        if (!warehouse || !warehouse.name) {
            return false;
        }

        const warehouseSettings = (SITE_SETTINGS.warehouses || {})[warehouse.name] || {};
        return warehouseSettings.visible !== false;
    });
}

function productHasAnyStock(product) {
    if (!product) return false;

    const visibleWarehouses = getVisibleWarehouseEntries(product.stockByWarehouse);
    if (visibleWarehouses.length > 0) {
        const hasWarehouseStock = visibleWarehouses.some(function (warehouse) {
            return Number(warehouse && warehouse.qty) > 0;
        });
        if (hasWarehouseStock) return true;
    }

    if (Number(product.stock) > 0) return true;

    if (Array.isArray(product.variants) && product.variants.length > 0) {
        return product.variants.some(function (variant) {
            return productHasAnyStock(variant);
        });
    }

    return false;
}

function getAvailableVariants(product) {
    if (!product || !Array.isArray(product.variants)) {
        return [];
    }

    return product.variants.filter(function (variant) {
        return productHasAnyStock(variant);
    });
}

function getDiscountInfo(price, discountPercent, discountAmount) {
    const basePrice = Number(price) || 0;
    let percent = Number(discountPercent);
    if (!Number.isFinite(percent) || percent <= 0) {
        const amount = Number(discountAmount);
        if (Number.isFinite(amount) && amount > 0) {
            percent = (amount / basePrice) * 100;
        }
    }

    if (!Number.isFinite(percent) || percent <= 0) {
        return {
            hasDiscount: false,
            discountPercent: 0,
            oldPrice: null,
            finalPrice: basePrice,
        };
    }

    const finalPrice = Math.max(0, basePrice - (basePrice * percent) / 100);
    return {
        hasDiscount: true,
        discountPercent: Math.round(percent),
        oldPrice: basePrice,
        finalPrice: finalPrice,
    };
}

function productMatchesFilter(product) {
    const state = CURRENT_FILTER_STATE;

    if (state.type === 'all') {
        return true;
    }

    if (state.type === 'bike-category' || state.type === 'bike-type' || state.type === 'bike-brand') {
        if (product.category !== 'Велосипеды') return false;
        if (state.bikeType && !getBikeTypes(product).includes(state.bikeType)) return false;
        return state.type !== 'bike-brand' || getBikeBrand(product) === state.bikeBrand;
    }

    if (state.type === 'categories') {
        return state.categories.indexOf(product.category || '') !== -1;
    }

    if (state.type === 'category-refine') {
        const catMatch = (product.category || '') === state.category;
        const refineVal = (product.categories && product.categories[1]) || '';
        const refineMatch = state.refine === null || refineVal === state.refine;
        return catMatch && refineMatch;
    }

    return true;
}

function productHasStockAtWarehouse(product, warehouseName) {
    if (!warehouseName) return true;
    const stockItems = Array.isArray(product.variants) && product.variants.length
        ? product.variants
        : [product];

    return stockItems.some(function (item) {
        return Array.isArray(item.stockByWarehouse) && getVisibleWarehouseEntries(item.stockByWarehouse).some(function (warehouse) {
            return warehouse.name === warehouseName && Number(warehouse.qty) > 0;
        });
    });
}

function getFilteredProducts() {
    const filtered = ALL_PRODUCTS.filter(function (product) {
        return productHasAnyStock(product)
            && productMatchesFilter(product)
            && productHasStockAtWarehouse(product, CURRENT_STOCK_WAREHOUSE)
            && productMatchesSearch(product, CURRENT_SEARCH_QUERY);
    });

    if (CURRENT_PRICE_SORT === 'price-asc') {
        filtered.sort(function (a, b) {
            return getDiscountInfo(a.price, a.discountPercent, a.discountAmount).finalPrice
                - getDiscountInfo(b.price, b.discountPercent, b.discountAmount).finalPrice;
        });
    } else if (CURRENT_PRICE_SORT === 'price-desc') {
        filtered.sort(function (a, b) {
            return getDiscountInfo(b.price, b.discountPercent, b.discountAmount).finalPrice
                - getDiscountInfo(a.price, a.discountPercent, a.discountAmount).finalPrice;
        });
    }

    return filtered;
}

function getBikeTypes(product) {
    if (!product || product.category !== 'Велосипеды') return [];

    const categories = Array.isArray(product.categories) ? product.categories : [];
    const searchable = normalizeString([product.name].concat(categories).join(' '));
    const bikeTypes = [];
    const wheelLabel = categories.slice(2).find(function (value) {
        return /^\s*\d{2}(?:[,.]\d+)?\s*["″]?\s*$/.test(value);
    });
    const wheelDiameter = wheelLabel
        ? Number(wheelLabel.replace(/[^\d,.]/g, '').replace(',', '.'))
        : null;

    if (categories.some(function (value) { return /беговел/i.test(value); }) || /беговел/.test(searchable)) {
        return ['Беговелы'];
    }
    if (categories.some(function (value) { return /трех\s*кол|3-х\s*кол/i.test(value); }) || /тр[её]х\s*кол|3\s*кол/.test(searchable)) {
        return ['Трехколесные'];
    }
    if (/bmx|mtb|бмх|вмх|мтб|трюков/.test(searchable)) {
        return ['Трюковые'];
    }
    if (categories.some(function (value) { return /городск/i.test(value); }) || /городск/.test(searchable)) {
        return ['Городские'];
    }
    if (categories.some(function (value) { return /складные\/дорожные|дорожн|шоссейн/i.test(value); }) || /дорожн|шоссейн/.test(searchable)) {
        return ['Дорожные'];
    }

    if (Number.isFinite(wheelDiameter)) {
        if (wheelDiameter >= 12 && wheelDiameter <= 20) bikeTypes.push('Детские');
        if (wheelDiameter >= 20 && wheelDiameter <= 26) bikeTypes.push('Подростковые');
        if (wheelDiameter >= 26 && wheelDiameter <= 29) bikeTypes.push('Взрослые');
    } else if (categories.some(function (value) { return /^детские$/i.test(value); }) || /детский|детское/.test(searchable)) {
        bikeTypes.push('Детские');
    }

    return Array.from(new Set(bikeTypes));
}

function getBikeBrand(product) {
    const categories = Array.isArray(product.categories) ? product.categories : [];
    const categoryBrand = categories[1] || '';
    if (categoryBrand && !/^(беговелы|трех\s*колесные|3-х\s*колесник)$/i.test(categoryBrand)) {
        return categoryBrand;
    }

    const balanceBikeBrand = String(product.name || '').match(/беговел\s+["«]?([\p{L}\d_-]+)/iu);
    return balanceBikeBrand ? balanceBikeBrand[1] : 'Другие';
}

function initCatalogControls(products) {
    const priceSort = document.getElementById('catalogPriceSort');
    const warehouseFilter = document.getElementById('catalogWarehouseFilter');
    if (!priceSort || !warehouseFilter) return;

    warehouseFilter.innerHTML = '<option value="">Все магазины</option>';

    const warehouses = new Set();
    products.forEach(function (product) {
        const stockItems = Array.isArray(product.variants) && product.variants.length
            ? product.variants
            : [product];
        stockItems.forEach(function (item) {
            getVisibleWarehouseEntries(item.stockByWarehouse).forEach(function (warehouse) {
                if (warehouse.name) warehouses.add(warehouse.name);
            });
        });
    });

    Array.from(warehouses).sort(function (a, b) {
        return a.localeCompare(b, 'ru');
    }).forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        warehouseFilter.appendChild(option);
    });

    priceSort.value = CURRENT_PRICE_SORT;
    if (priceSort.value !== CURRENT_PRICE_SORT) CURRENT_PRICE_SORT = 'default';
    warehouseFilter.value = CURRENT_STOCK_WAREHOUSE;
    if (warehouseFilter.value !== CURRENT_STOCK_WAREHOUSE) CURRENT_STOCK_WAREHOUSE = '';

    priceSort.addEventListener('change', function () {
        CURRENT_PRICE_SORT = priceSort.value;
        renderInitialProducts();
    });
    warehouseFilter.addEventListener('change', function () {
        CURRENT_STOCK_WAREHOUSE = warehouseFilter.value;
        renderInitialProducts();
    });
}

// ============================
// ПОРЦИОННЫЙ РЕНДЕР
// ============================

function clearProducts() {
    if (productsContainer) {
        productsContainer.innerHTML = '';
    }
    RENDERED_COUNT = 0;
}

function renderMoreProducts() {
    if (!productsContainer || IS_RENDERING_BATCH) return;

    const filtered = getFilteredProducts();
    const remaining = filtered.length - RENDERED_COUNT;

    if (remaining <= 0) {
        updateCatalogControls();
        return;
    }

    IS_RENDERING_BATCH = true;
    showCatalogLoading(true);

    const batchSize = Math.min(PAGE_SIZE, remaining);
    const batch = filtered.slice(RENDERED_COUNT, RENDERED_COUNT + batchSize);

    const fragment = document.createDocumentFragment();
    batch.forEach(function (product) {
        const card = buildProductCard(product);
        fragment.appendChild(card);
    });

    productsContainer.appendChild(fragment);
    RENDERED_COUNT += batchSize;

    initAddToCart();
    showCatalogLoading(false);
    updateCatalogCounter();
    updateCatalogControls();

    IS_RENDERING_BATCH = false;
}

function renderInitialProducts() {
    if (!productsContainer) return;

    saveCatalogSessionState();
    clearProducts();
    hideNoResults();
    renderMoreProducts();

    const filtered = getFilteredProducts();
    if (filtered.length === 0 && (CURRENT_SEARCH_QUERY || CURRENT_FILTER_STATE.type !== 'all' || CURRENT_STOCK_WAREHOUSE)) {
        showNoResults();
    }
}

// ============================
// СЧЁТЧИК, КНОПКА, СПИННЕР, «НЕ НАЙДЕНО»
// ============================

function updateCatalogCounter() {
    const counterEl = document.getElementById('catalogCounter');
    if (!counterEl) return;

    const total = getFilteredProducts().length;
    const shown = Math.min(RENDERED_COUNT, total);

    if (total === 0) {
        counterEl.textContent = '';
        return;
    }

    counterEl.innerHTML = 'Показано <strong>' + shown + '</strong> из <strong>' + total + '</strong> товаров';
}

function updateCatalogControls() {
    const total = getFilteredProducts().length;
    const allShown = RENDERED_COUNT >= total;

    const moreWrap = document.getElementById('catalogMoreWrap');
    const moreBtn = document.getElementById('catalogMoreBtn');

    if (moreWrap) {
        if (allShown || total === 0) {
            moreWrap.hidden = true;
        } else {
            moreWrap.hidden = false;
        }
    }

    if (INFINITE_OBSERVER) {
        const sentinel = document.getElementById('scrollSentinel');
        if (sentinel) {
            if (allShown || total === 0) {
                INFINITE_OBSERVER.unobserve(sentinel);
            } else {
                INFINITE_OBSERVER.observe(sentinel);
            }
        }
    }
}

function showCatalogLoading(show) {
    const loadingEl = document.getElementById('catalogLoading');
    if (loadingEl) {
        loadingEl.hidden = !show;
    }
}

function showNoResults() {
    const infoEl = document.getElementById('searchResultInfo');
    if (!infoEl) return;

    if (CURRENT_SEARCH_QUERY) return;

    const noResults = document.createElement('div');
    noResults.className = 'search__no-results';
    noResults.id = 'filterNoResults';
    noResults.innerHTML =
        '<h3>Ничего не найдено 😕</h3><p>Попробуйте выбрать другую категорию или сбросить фильтры</p>';
    infoEl.appendChild(noResults);
}

function hideNoResults() {
    const el = document.getElementById('filterNoResults');
    if (el) el.remove();
}

// ============================
// ИНФОРМАЦИЯ О ПОИСКЕ
// ============================

function updateSearchResultInfo() {
    const infoEl = document.getElementById('searchResultInfo');
    if (!infoEl) return;

    infoEl.innerHTML = '';
    hideNoResults();

    if (CURRENT_SEARCH_QUERY) {
        const total = getFilteredProducts().length;
        const info = document.createElement('div');
        info.className = 'search__result-info';

        if (total === 0) {
            info.innerHTML =
                'По запросу <strong>' +
                escapeHtml(CURRENT_SEARCH_QUERY) +
                '</strong> ничего не найдено';
            infoEl.appendChild(info);

            const noResults = document.createElement('div');
            noResults.className = 'search__no-results';
            noResults.innerHTML =
                '<h3>Ничего не найдено 😕</h3><p>Попробуйте изменить запрос или выбрать категорию в фильтрах</p>';
            infoEl.appendChild(noResults);
        } else {
            info.innerHTML =
                'По запросу <strong>' +
                escapeHtml(CURRENT_SEARCH_QUERY) +
                '</strong> найдено: <strong>' +
                total +
                '</strong> товаров';
            infoEl.appendChild(info);
        }
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================
// BESКОНЕЧНЫЙ СКРОЛЛ + КНОПКА «ЕЩЁ»
// ============================

function initInfiniteScroll() {
    if (!productsContainer) return;
    if (INFINITE_OBSERVER) return;

    const sentinel = document.getElementById('scrollSentinel');
    if (!sentinel) return;

    INFINITE_OBSERVER = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    renderMoreProducts();
                }
            });
        },
        {
            rootMargin: '300px 0px',
            threshold: 0,
        }
    );

    const moreBtn = document.getElementById('catalogMoreBtn');
    if (moreBtn) {
        moreBtn.addEventListener('click', function () {
            renderMoreProducts();
        });
    }
}

// ============================
// ПОИСК ТОВАРОВ (интеграция)
// ============================

function performSearch(query) {
    CURRENT_SEARCH_QUERY = query;
    updateSearchResultInfo();
    renderInitialProducts();
}

function initSearch() {
    const searchForm = document.getElementById('searchForm');
    const searchInput = document.getElementById('searchInput');

    if (searchInput && productsContainer) {
        const urlParams = new URLSearchParams(window.location.search);
        const searchFromUrl = urlParams.get('search');
        const categoryFromUrl = urlParams.get('category');

        if (searchFromUrl) {
            searchInput.value = searchFromUrl;
            CURRENT_SEARCH_QUERY = searchFromUrl;
        } else if (CURRENT_SEARCH_QUERY) {
            searchInput.value = CURRENT_SEARCH_QUERY;
        }

        if (categoryFromUrl) {
            CURRENT_FILTER_STATE = {
                type: 'categories',
                categories: [categoryFromUrl],
                category: null,
                refine: null,
            };
        }
    }

    document.addEventListener('click', function (event) {
        const link = event.target.closest('[data-category]');
        if (!link) return;

        const category = link.dataset.category;
        if (!category) return;

        const href = link.getAttribute('href');
        if (!href || !href.includes('catalog.html')) return;

        event.preventDefault();

        const url = new URL(href, window.location.origin);
        url.searchParams.set('category', category);
        window.location.href = url.toString();
    });

    if (searchForm) {
        searchForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const input = document.getElementById('searchInput');
            const query = input ? input.value.trim() : '';

            if (!productsContainer) {
                if (query) {
                    const catalogUrl = new URL('catalog.html', window.location.href);
                    catalogUrl.searchParams.set('search', query);
                    window.location.href = catalogUrl.toString();
                }
                return;
            }

            performSearch(query);
        });
    }

    if (searchInput && productsContainer) {
        let debounceTimer;
        searchInput.addEventListener('input', function () {
            const query = this.value.trim();
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                performSearch(query);
            }, 300);
        });
    }
}

initSearch();

// ============================
// ПОЯВЛЕНИЕ СЕКЦИЙ ПРИ СКРОЛЛЕ
// ============================

const revealElements = document.querySelectorAll('.reveal');

if (revealElements.length > 0) {
    const observer = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                } else {
                    entry.target.classList.remove('visible');
                }
            });
        },
        {
            threshold: 0.15,
        }
    );

    revealElements.forEach(function (element) {
        observer.observe(element);
    });
}

// ============================
// ГРУППЫ КАТЕГОРИЙ
// ============================

const CATEGORY_GROUPS = {
    'Велоспорт': [
        'Велосипеды',
        'Аксессуары для велосипедов',
        'Запчасти',
    ],
    'Самокаты': [
        'Самокаты',
        'Запчасти для самокатов',
        'Защита',
        'Шлема',
    ],
    'Скейтборды': [
        'Скейтборды',
        'Запчасти для скейтбордов',
        'Защита',
        'Шлема',
    ],
    'Ролики': [
        'Ролики',
         'Защита',
         'Шлема',
    ],
    'Зимний спорт': [
        'Ботинки лыжные',
        'Лыжный спорт',
        'Ледянки',
        'Коньки',
        'Аксессуары Зима',
        'Варежки/Перчатки',
        'Санки/снегокаты/тюбинги/сноуборды',
    ],
    'Виды спорта': [
        'Футбол',
        'Бутсы футбольные',
        'Баскетбол',
        'Волейбол',
        'Бейсбол',
        'Для плавания',
        'Бокс',
        'Теннис',
        'Бадминтон',
        'Дартс',
        'Для хоккея',
        'Скейтборды',
        'Супорта',
        
    ],
    'Фитнес и тренировки': [
        'Гимнастика',
        'Силовые',
        'Эспандеры/нунчаки',
        'Турники',
        'Спорт дома',

    ],
    'Аксессуары': [
        'Аксессуары',
        'Носки',
        'Очки',
        'Зонты',
        'Чешки',
        'Шейкеры',

    ],
    'Туризм и отдых': [
        'Отдых на природе',
        'Мешки для обуви',
        'Сапборды',
    ],
    'Игры': [
        'Детская витрина',
    ],
};

// ============================
// ЗАГРУЗКА ТОВАРОВ ИЗ JSON
// ============================

const productContainer = document.getElementById('productContainer');
const siteSettingsReady = loadSiteSettings()
    .then(function (settings) {
        SITE_SETTINGS = settings;
        applySiteSettings(document);
        return settings;
    })
    .catch(function (error) {
        console.error('Ошибка загрузки настроек сайта:', error);
        return SITE_SETTINGS;
    });

if (productsContainer) {
    siteSettingsReady
        .then(loadCatalogData)
        .then(function (products) {
            ALL_PRODUCTS = products;

            initCatalogControls(products);
            initFilters(products);
            initInfiniteScroll();
            updateSearchResultInfo();
            renderInitialProducts();

            if (CURRENT_SEARCH_QUERY) {
                updateSearchResultInfo();
            }
        })
        .catch(function (error) {
            console.error('Ошибка загрузки товаров:', error);
        });
}

// ============================
// СОЗДАНИЕ КАРТОЧКИ ТОВАРА (возвращает DOM-элемент)
// ============================

function buildProductCard(product) {
    const availableVariants = getAvailableVariants(product);
    const firstVariantImage = availableVariants.find(function (variant) {
        return variant.image && variant.image !== 'img/no-image.jpg';
    });
    const cardImage = product.image && product.image !== 'img/no-image.jpg'
        ? product.image
        : firstVariantImage?.image || product.image || '';
    const article = document.createElement('article');
    article.className = 'product';
    article.dataset.category = product.category || '';
    article.dataset.price = product.price || 0;
    article.dataset.productId = product.id || '';
    article.dataset.productName = product.name || '';
    article.dataset.productImage = cardImage;
    article.dataset.productPrice = product.price || 0;

    if (product.categories && product.categories.length > 1) {
        article.dataset.brand = product.categories[1];
    }
    if (product.categories && product.categories.length > 2) {
        article.dataset.size = product.categories[2];
    }

    const link = document.createElement('a');
    link.href = 'product.html?id=' + product.id;
    link.className = 'product__link';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'product__image';

    const img = document.createElement('img');
    img.src = cardImage;
    img.alt = product.alt || product.name || '';
    img.loading = 'lazy';

    let placeholderShown = false;
    function showPlaceholder() {
        if (placeholderShown) return;
        placeholderShown = true;

        if (img.parentNode) {
            img.remove();
        }

        imageWrap.classList.add('product__image--placeholder');
        const text = document.createElement('span');
        text.className = 'product__placeholder-text';
        const shortName = (product.name || 'Фото товара').slice(0, 40);
        text.textContent = shortName;
        imageWrap.appendChild(text);
    }

    img.addEventListener('error', function () {
        showPlaceholder();
    });

    imageWrap.appendChild(img);

    const title = document.createElement('h3');
    title.className = 'product__title';
    title.textContent = product.name;

    link.appendChild(imageWrap);
    link.appendChild(title);

    const productDiscount = getDiscountInfo(product.price, product.discountPercent, product.discountAmount);
    const priceWrap = document.createElement('div');
    priceWrap.className = 'product__price-wrap';

    const price = document.createElement('p');
    price.className = 'product__price';
    price.textContent = productDiscount.finalPrice.toLocaleString('ru-RU') + ' ₽';

    if (productDiscount.hasDiscount && productDiscount.oldPrice !== null) {
        const oldPrice = document.createElement('span');
        oldPrice.className = 'product__old-price';
        oldPrice.textContent = productDiscount.oldPrice.toLocaleString('ru-RU') + ' ₽';
        priceWrap.appendChild(oldPrice);
    }

    priceWrap.appendChild(price);

    if (productDiscount.hasDiscount) {
        const discountBadge = document.createElement('span');
        discountBadge.className = 'product__discount';
        discountBadge.textContent = '-' + productDiscount.discountPercent + '%';
        priceWrap.appendChild(discountBadge);
    }

    /*
    const button = document.createElement('button');
    button.className = 'btn btn--primary btn--small add-to-cart';
    button.textContent = 'В корзину';
    */

    article.appendChild(link);
    article.appendChild(priceWrap);
    // article.appendChild(button);

    if (!cardImage || cardImage === 'img/no-image.jpg') {
        showPlaceholder();
    }

    return article;
}

// ============================
// ДИНАМИЧЕСКИЕ ФИЛЬТРЫ (3 уровня)
// ============================

function initFilters(products) {
    const filtersContainer = document.getElementById('filtersContainer');
    const subfiltersContainer = document.getElementById('subfiltersContainer');
    const refineContainer = document.getElementById('refineContainer');
    const bikeBrandContainer = document.getElementById('bikeBrandContainer');
    const filtersTrack = document.getElementById('filtersTrack');
    const backBtn = document.getElementById('backBtn');
    const backToSubsBtn = document.getElementById('backToSubsBtn');
    const backToBikeTypesBtn = document.getElementById('backToBikeTypesBtn');
    if (!filtersContainer || !filtersTrack) return;

    function updateFilterTrackWidth() {
        const firstPanel = filtersContainer.querySelector('.filters-panel');
        if (!firstPanel) return;
        const width = firstPanel.getBoundingClientRect().width || window.innerWidth - 18;
        filtersTrack.style.setProperty('--filter-panel-width', width + 'px');
    }

    const productCategories = new Set();
    products.forEach(function (product) {
        if (product.category) {
            productCategories.add(product.category);
        }
    });

    const activeGroups = {};
    Object.keys(CATEGORY_GROUPS).forEach(function (groupName) {
        const cats = CATEGORY_GROUPS[groupName];
        const presentCats = cats.filter(function (cat) {
            return productCategories.has(cat);
        });
        if (presentCats.length > 0) {
            activeGroups[groupName] = presentCats;
        }
    });

    const groupedCategories = new Set();
    Object.values(CATEGORY_GROUPS).forEach(function (arr) {
        arr.forEach(function (cat) {
            groupedCategories.add(cat);
        });
    });

    const otherCategories = [];
    productCategories.forEach(function (cat) {
        if (!groupedCategories.has(cat)) {
            otherCategories.push(cat);
        }
    });

    // Не создаём группу "Прочее" автоматически.
    // Все категории должны быть явно добавлены в CATEGORY_GROUPS.

    const refineByCategory = {};
    products.forEach(function (product) {
        if (!product.category) return;
        if (!product.categories || product.categories.length < 2) return;

        const cat = product.category;
        const refine = product.categories[1];

        if (!refineByCategory[cat]) {
            refineByCategory[cat] = new Set();
        }
        refineByCategory[cat].add(refine);
    });

    Object.keys(activeGroups).forEach(function (groupName) {
        const btn = document.createElement('button');
        btn.className = 'filters__btn';
        btn.dataset.group = groupName;
        btn.textContent = groupName;
        filtersContainer.appendChild(btn);
    });

    const bikeTypeOrder = ['Детские', 'Подростковые', 'Взрослые', 'Дорожные', 'Трюковые', 'Городские', 'Беговелы', 'Трехколесные'];

    function setBikeFilter(type, brand) {
        CURRENT_FILTER_STATE = {
            type: brand ? 'bike-brand' : (type ? 'bike-type' : 'bike-category'),
            categories: ['Велосипеды'],
            category: 'Велосипеды',
            refine: null,
            bikeType: type || null,
            bikeBrand: brand || null,
        };
        renderInitialProducts();
    }

    function renderBikeTypes(selectedType) {
        if (!refineContainer) return;
        const types = Array.from(new Set(products
            .filter(function (product) { return product.category === 'Велосипеды'; })
            .reduce(function (allTypes, product) { return allTypes.concat(getBikeTypes(product)); }, [])))
            .sort(function (leftType, rightType) {
                return bikeTypeOrder.indexOf(leftType) - bikeTypeOrder.indexOf(rightType);
            });

        refineContainer.innerHTML = '';
        types.forEach(function (type) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'filters__btn' + (selectedType === type ? ' filters__btn--active' : '');
            button.dataset.bikeType = type;
            button.textContent = type;
            refineContainer.appendChild(button);
        });
    }

    function renderBikeBrands(type, selectedBrand) {
        if (!bikeBrandContainer) return;
        const brands = Array.from(new Set(products
            .filter(function (product) {
                return product.category === 'Велосипеды' && getBikeTypes(product).includes(type);
            })
            .map(getBikeBrand))).sort(function (leftBrand, rightBrand) {
                return leftBrand.localeCompare(rightBrand, 'ru');
            });

        bikeBrandContainer.innerHTML = '';
        brands.forEach(function (brand) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'filters__btn' + (selectedBrand === brand ? ' filters__btn--active' : '');
            button.dataset.bikeBrand = brand;
            button.textContent = brand;
            bikeBrandContainer.appendChild(button);
        });
    }

    function updateFilterBackLabels() {
        const activeSubBtn = subfiltersContainer ? subfiltersContainer.querySelector('.filters__btn--active') : null;

        if (backBtn) {
            backBtn.textContent = 'Все категории';
        }

        if (backToSubsBtn) {
            backToSubsBtn.textContent = activeSubBtn && activeSubBtn.dataset.category
                ? activeSubBtn.dataset.category
                : 'Назад';
        }
    }

    updateFilterTrackWidth();
    window.addEventListener('resize', updateFilterTrackWidth);

    filtersContainer.addEventListener('click', function (event) {
        const btn = event.target.closest('.filters__btn');
        if (!btn) return;

        const groupName = btn.dataset.group;
        if (!groupName) return;

        if (subfiltersContainer) {
            subfiltersContainer.innerHTML = '';

            if (groupName === 'Игры' && activeGroups[groupName].length === 1) {
                showCardsByCategories(activeGroups[groupName]);
                filtersTrack.classList.remove('filters-track--refine');
                filtersTrack.classList.remove('filters-track--subs');
                return;
            }

            activeGroups[groupName].forEach(function (cat) {
                const subBtn = document.createElement('button');
                subBtn.className = 'filters__btn';
                subBtn.dataset.category = cat;
                subBtn.textContent = cat;
                subfiltersContainer.appendChild(subBtn);
            });
        }

        showCardsByCategories(activeGroups[groupName]);

        updateFilterBackLabels();
        filtersTrack.classList.remove('filters-track--refine');
        filtersTrack.classList.add('filters-track--subs');
    });

    if (subfiltersContainer) {
        subfiltersContainer.addEventListener('click', function (event) {
            const btn = event.target.closest('.filters__btn');
            if (!btn) return;

            subfiltersContainer.querySelectorAll('.filters__btn').forEach(function (b) {
                b.classList.remove('filters__btn--active');
            });
            btn.classList.add('filters__btn--active');

            const category = btn.dataset.category;
            if (category === 'Велосипеды') {
                setBikeFilter(null, null);
                renderBikeTypes(null);
                filtersTrack.classList.add('filters-track--subs');
                filtersTrack.classList.add('filters-track--refine');
                updateFilterBackLabels();
                return;
            }

            showCardsByCategories([category]);

            const refines = refineByCategory[category]
                ? Array.from(refineByCategory[category]).sort()
                : [];

            if (refines.length < 2 || !refineContainer) {
                filtersTrack.classList.remove('filters-track--refine');
                return;
            }

            refineContainer.innerHTML = '';

            const allBtn = document.createElement('button');
            allBtn.className = 'filters__btn filters__btn--active';
            allBtn.dataset.refine = '';
            allBtn.textContent = 'Все';
            refineContainer.appendChild(allBtn);

            refines.forEach(function (refine) {
                const rBtn = document.createElement('button');
                rBtn.className = 'filters__btn';
                rBtn.dataset.refine = refine;
                rBtn.textContent = refine;
                refineContainer.appendChild(rBtn);
            });

            updateFilterBackLabels();
            filtersTrack.classList.add('filters-track--refine');
        });
    }

    if (refineContainer) {
        refineContainer.addEventListener('click', function (event) {
            const btn = event.target.closest('.filters__btn');
            if (!btn) return;

            if (btn.dataset.bikeType) {
                refineContainer.querySelectorAll('.filters__btn').forEach(function (button) {
                    button.classList.toggle('filters__btn--active', button === btn);
                });
                setBikeFilter(btn.dataset.bikeType, null);
                renderBikeBrands(btn.dataset.bikeType, null);
                filtersTrack.classList.add('filters-track--bike-brands');
                return;
            }

            refineContainer.querySelectorAll('.filters__btn').forEach(function (b) {
                b.classList.remove('filters__btn--active');
            });
            btn.classList.add('filters__btn--active');

            const refine = btn.dataset.refine;

            const activeSubBtn = subfiltersContainer.querySelector('.filters__btn--active');
            if (!activeSubBtn) return;
            const category = activeSubBtn.dataset.category;

            filterByCategoryAndRefine(category, refine || null);
        });
    }

    if (bikeBrandContainer) {
        bikeBrandContainer.addEventListener('click', function (event) {
            const btn = event.target.closest('[data-bike-brand]');
            if (!btn) return;

            bikeBrandContainer.querySelectorAll('.filters__btn').forEach(function (button) {
                button.classList.toggle('filters__btn--active', button === btn);
            });
            setBikeFilter(CURRENT_FILTER_STATE.bikeType, btn.dataset.bikeBrand);
        });
    }

    if (backToBikeTypesBtn) {
        backToBikeTypesBtn.addEventListener('click', function () {
            filtersTrack.classList.remove('filters-track--bike-brands');
            setBikeFilter(CURRENT_FILTER_STATE.bikeType, null);
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', function () {
            const activeSubBtn = subfiltersContainer ? subfiltersContainer.querySelector('.filters__btn--active') : null;

            if (filtersTrack.classList.contains('filters-track--refine')) {
                filtersTrack.classList.remove('filters-track--refine');
                if (activeSubBtn) {
                    showCardsByCategories([activeSubBtn.dataset.category]);
                    return;
                }
            }

            filtersTrack.classList.remove('filters-track--subs');
            filtersTrack.classList.remove('filters-track--refine');

            if (CURRENT_FILTER_STATE.category) {
                showCardsByCategories([CURRENT_FILTER_STATE.category]);
                return;
            }

            if (CURRENT_FILTER_STATE.categories && CURRENT_FILTER_STATE.categories.length) {
                showCardsByCategories(CURRENT_FILTER_STATE.categories);
                return;
            }

            showAllCards();
        });
    }

    if (backToSubsBtn) {
        backToSubsBtn.addEventListener('click', function () {
            filtersTrack.classList.remove('filters-track--bike-brands');
            filtersTrack.classList.remove('filters-track--refine');

            const activeSubBtn = subfiltersContainer ? subfiltersContainer.querySelector('.filters__btn--active') : null;
            if (activeSubBtn) {
                showCardsByCategories([activeSubBtn.dataset.category]);
                return;
            }

            if (CURRENT_FILTER_STATE.category) {
                showCardsByCategories([CURRENT_FILTER_STATE.category]);
                return;
            }

            filtersTrack.classList.remove('filters-track--subs');
            showAllCards();
        });
    }

    const initialBikeState = CURRENT_FILTER_STATE.type.indexOf('bike-') === 0
        ? Object.assign({}, CURRENT_FILTER_STATE)
        : null;
    const initialRefineState = CURRENT_FILTER_STATE.type === 'category-refine'
        ? Object.assign({}, CURRENT_FILTER_STATE)
        : null;
    const initialCategory = initialBikeState
        ? 'Велосипеды'
        : (initialRefineState
            ? initialRefineState.category
            : (CURRENT_FILTER_STATE.type === 'categories' ? CURRENT_FILTER_STATE.categories[0] : ''));
    const initialGroup = !initialBikeState && !initialRefineState && CURRENT_FILTER_STATE.type === 'categories'
        ? Object.keys(activeGroups).find(function (name) {
            return activeGroups[name].length === CURRENT_FILTER_STATE.categories.length
                && activeGroups[name].every(function (category) {
                    return CURRENT_FILTER_STATE.categories.includes(category);
                });
        })
        : null;
    if (initialCategory && subfiltersContainer) {
        const groupName = Object.keys(activeGroups).find(function (name) {
            return activeGroups[name].includes(initialCategory);
        });
        const groupButton = groupName && Array.from(filtersContainer.querySelectorAll('[data-group]')).find(function (button) {
            return button.dataset.group === groupName;
        });

        if (groupButton) {
            groupButton.click();
            if (!initialGroup) {
                const categoryButton = Array.from(subfiltersContainer.querySelectorAll('[data-category]')).find(function (button) {
                    return button.dataset.category === initialCategory;
                });
                if (categoryButton) categoryButton.click();
            }

            if (initialBikeState && initialBikeState.bikeType) {
                renderBikeTypes(initialBikeState.bikeType);
                const typeButton = Array.from(refineContainer.querySelectorAll('[data-bike-type]')).find(function (button) {
                    return button.dataset.bikeType === initialBikeState.bikeType;
                });
                if (typeButton) typeButton.click();
                if (initialBikeState.bikeBrand) {
                    const brandButton = Array.from(bikeBrandContainer.querySelectorAll('[data-bike-brand]')).find(function (button) {
                        return button.dataset.bikeBrand === initialBikeState.bikeBrand;
                    });
                    if (brandButton) brandButton.click();
                }
            }
            if (initialRefineState && initialRefineState.refine) {
                const refineButton = Array.from(refineContainer.querySelectorAll('[data-refine]')).find(function (button) {
                    return button.dataset.refine === initialRefineState.refine;
                });
                if (refineButton) refineButton.click();
            }
        }
    }

    function showAllCards() {
        CURRENT_FILTER_STATE = {
            type: 'all',
            categories: [],
            category: null,
            refine: null,
        };
        updateSearchResultInfo();
        renderInitialProducts();
    }

    function showCardsByCategories(categories) {
        CURRENT_FILTER_STATE = {
            type: 'categories',
            categories: categories,
            category: null,
            refine: null,
        };
        updateSearchResultInfo();
        renderInitialProducts();
    }

    function filterByCategoryAndRefine(category, refine) {
        CURRENT_FILTER_STATE = {
            type: 'category-refine',
            categories: [],
            category: category,
            refine: refine,
        };
        updateSearchResultInfo();
        renderInitialProducts();
    }
}

// ============================
// ОБРАБОТЧИК КНОПОК «В КОРЗИНУ»
// ============================

/*
function initAddToCart() {
    if (CART_DISABLED) return;
    const addButtons = document.querySelectorAll('.add-to-cart');

    addButtons.forEach(function (button) {
        if (button.dataset.cartBound) return;
        button.dataset.cartBound = 'true';
        button.addEventListener('click', function () {
            const card = button.closest('.product');
            if (!card) return;

            const productId = card.dataset.productId;
            const productName = card.dataset.productName;
            const productImage = card.dataset.productImage;
            const price = parseFloat(card.dataset.productPrice) || 0;

            if (!productId) return;

            const added = cartAdd({
                productId: productId,
                productName: productName,
                productImage: productImage,
                variantId: null,
                variantName: null,
                price: price,
            }, 1);

            if (added) {
                showToast('Товар добавлен в корзину: ' + productName);
            }
        });
    });
}
*/

// initAddToCart();

// ============================
// СТРАНИЦА ТОВАРА
// ============================

function initAddToCart() {
    // Корзина выключена: кнопки и обработчики временно скрыты.
}

const popularProductsContainer = document.getElementById('popularProducts');

function shuffleArray(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function renderPopularProducts(products) {
    if (!popularProductsContainer) return;

    const targetGroups = ['Велосипеды', 'Самокаты', 'Сапборды'];
    const popularProducts = [];

    targetGroups.forEach(function (groupName) {
        const groupProducts = shuffleArray(
            products.filter(function (product) {
                if (!productHasAnyStock(product) || !product.category || product.category !== groupName) {
                    return false;
                }

                if (groupName === 'Самокаты') {
                    const subtypes = product.categories || [];
                    return subtypes.includes('Городские')
                        || subtypes.includes('Трюковые')
                        || subtypes.includes('Детские');
                }

                if (groupName === 'Велосипеды') {
                    return true;
                }

                return true;
            })
        ).slice(0, 2);

        popularProducts.push(...groupProducts);
    });

    popularProductsContainer.innerHTML = '';

    popularProducts.forEach(function (product) {
        popularProductsContainer.appendChild(buildProductCard(product));
    });

    // initAddToCart();
}

if (popularProductsContainer) {
    loadCatalogData()
        .then(function (products) {
            renderPopularProducts(products);
        })
        .catch(function (error) {
            console.error('Ошибка загрузки популярных товаров:', error);
        });
}

const heroSlides = Array.from(document.querySelectorAll('.hero-slide'));

if (heroSlides.length > 0) {
    let currentSlide = 0;
    const prevButtons = Array.from(document.querySelectorAll('.hero-carousel__arrow--prev'));
    const nextButtons = Array.from(document.querySelectorAll('.hero-carousel__arrow--next'));
    const autoplayDelay = 6000;
    let autoplayTimer = null;

    function restartAutoplay() {
        if (autoplayTimer) {
            clearInterval(autoplayTimer);
        }

        autoplayTimer = setInterval(function () {
            showSlide(currentSlide + 1);
        }, autoplayDelay);
    }

    function showSlide(index) {
        currentSlide = (index + heroSlides.length) % heroSlides.length;

        heroSlides.forEach(function (slide, slideIndex) {
            const isActive = slideIndex === currentSlide;
            slide.classList.toggle('is-active', isActive);
            slide.setAttribute('aria-hidden', String(!isActive));
            slide.querySelectorAll('.hero-slide__mobile-controls button').forEach(function (button) {
                button.tabIndex = isActive ? 0 : -1;
            });
        });
    }

    function populateHeroSlides(products) {
        heroSlides.forEach(function (slide) {
            const productId = (slide.dataset.productId || '').trim();
            if (!productId) return;

            const product = products.find(function (item) {
                return item.id === productId;
            });
            if (!product) return;

            const imageLink = slide.querySelector('.hero-slide__image-link');
            const image = imageLink?.querySelector('img');
            const categoryButton = slide.querySelector('.hero-slide__actions a');
            const productName = slide.querySelector('[data-product-name]');
            const category = product.category || (product.categories && product.categories[0]) || '';
            const variantImage = getAvailableVariants(product).map(function (variant) {
                return variant.image;
            }).find(function (imagePath) {
                return imagePath && imagePath !== 'img/no-image.jpg';
            });
            const imagePath = product.image && product.image !== 'img/no-image.jpg'
                ? product.image
                : variantImage;

            slide.dataset.category = category;

            if (imageLink) {
                imageLink.href = 'product.html?id=' + encodeURIComponent(product.id);
                imageLink.dataset.productId = product.id;
            }
            if (image && imagePath) {
                image.src = resolveAssetPath(imagePath);
                image.alt = product.alt || product.name || '';
            }
            if (productName) {
                productName.textContent = product.name || '';
            }
            if (categoryButton) {
                if (category) {
                    categoryButton.href = 'catalog.html?category=' + encodeURIComponent(category);
                    categoryButton.dataset.category = category;
                } else {
                    categoryButton.href = 'catalog.html';
                    delete categoryButton.dataset.category;
                }
            }
        });
    }

    loadCatalogData()
        .then(populateHeroSlides)
        .catch(function (error) {
            console.error('Ошибка загрузки товаров для слайдера:', error);
        });

    prevButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            showSlide(currentSlide - 1);
            restartAutoplay();
        });
    });

    nextButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            showSlide(currentSlide + 1);
            restartAutoplay();
        });
    });

    showSlide(currentSlide);

    document.addEventListener('click', function (event) {
        const categoryButton = event.target.closest('[data-category]');
        if (categoryButton && categoryButton.getAttribute('href') && categoryButton.getAttribute('href').includes('catalog.html')) {
            const category = categoryButton.dataset.category;
            if (!category) return;

            event.preventDefault();
            const url = new URL(categoryButton.href, window.location.origin);
            url.searchParams.set('category', category);
            window.location.href = url.toString();
        }

        const productLink = event.target.closest('[data-product-id]');
        if (productLink && productLink.getAttribute('href') && productLink.getAttribute('href').includes('product.html')) {
            const productId = productLink.dataset.productId;
            if (!productId) return;

            event.preventDefault();
            const url = new URL(productLink.href, window.location.origin);
            url.searchParams.set('id', productId);
            window.location.href = url.toString();
        }
    });

    restartAutoplay();
}

if (productContainer) {
    siteSettingsReady.then(loadProductPage);
}

function loadProductPage() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) {
        productContainer.innerHTML = '<p>Товар не указан.</p>';
        return;
    }

    loadCatalogData()
        .then(function (products) {
            const product = products.find(function (p) {
                return p.id === productId && productHasAnyStock(p);
            });

            if (!product) {
                if (productContainer) {
                    productContainer.innerHTML = '';
                }
                return;
            }

            renderProduct(product);
        })
        .catch(function (error) {
            console.error('Ошибка загрузки:', error);
            if (productContainer) {
                productContainer.innerHTML = '';
            }
        });
}

function renderProduct(product) {
    productContainer.innerHTML = '';

    const breadcrumb = document.getElementById('productBreadcrumb');
    if (breadcrumb) {
        breadcrumb.textContent = product.name;
    }
    document.title = product.name + ' — START';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'product-page__back-btn';
    backBtn.setAttribute('aria-label', 'Вернуться в каталог');
    backBtn.innerHTML = '<span class="product-page__back-btn-icon" aria-hidden="true">←</span><span class="product-page__back-btn-label">Назад</span>';
    backBtn.addEventListener('click', function (event) {
        event.preventDefault();
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = resolveAssetPath('catalog.html');
        }
    });
    productContainer.appendChild(backBtn);

    const content = document.createElement('div');
    content.className = 'product-page__content';

    const gallery = document.createElement('div');
    gallery.className = 'product-page__gallery';

    const galleryStage = document.createElement('div');
    galleryStage.className = 'product-page__gallery-stage';
    const galleryOpenButton = document.createElement('button');
    galleryOpenButton.type = 'button';
    galleryOpenButton.className = 'product-page__gallery-open';
    galleryOpenButton.setAttribute('aria-label', 'Открыть фотографии товара');
    const galleryPrevious = document.createElement('button');
    galleryPrevious.type = 'button';
    galleryPrevious.className = 'product-page__gallery-nav product-page__gallery-nav--prev';
    galleryPrevious.setAttribute('aria-label', 'Предыдущее фото');
    galleryPrevious.textContent = '‹';
    const galleryNext = document.createElement('button');
    galleryNext.type = 'button';
    galleryNext.className = 'product-page__gallery-nav product-page__gallery-nav--next';
    galleryNext.setAttribute('aria-label', 'Следующее фото');
    galleryNext.textContent = '›';
    const galleryThumbnails = document.createElement('div');
    galleryThumbnails.className = 'product-page__gallery-thumbnails';
    galleryStage.appendChild(galleryOpenButton);
    galleryStage.appendChild(galleryPrevious);
    galleryStage.appendChild(galleryNext);
    gallery.appendChild(galleryStage);
    gallery.appendChild(galleryThumbnails);

    const lightbox = document.createElement('div');
    lightbox.className = 'product-lightbox';
    lightbox.hidden = true;
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Фотографии товара');
    const lightboxStage = document.createElement('div');
    lightboxStage.className = 'product-lightbox__stage';
    const lightboxImage = document.createElement('img');
    lightboxImage.className = 'product-lightbox__image';
    lightboxImage.alt = product.name || '';
    const lightboxClose = document.createElement('button');
    lightboxClose.type = 'button';
    lightboxClose.className = 'product-lightbox__close';
    lightboxClose.setAttribute('aria-label', 'Закрыть просмотр');
    lightboxClose.textContent = '×';
    const lightboxPrevious = document.createElement('button');
    lightboxPrevious.type = 'button';
    lightboxPrevious.className = 'product-lightbox__nav product-lightbox__nav--prev';
    lightboxPrevious.setAttribute('aria-label', 'Предыдущее фото');
    lightboxPrevious.textContent = '‹';
    const lightboxNext = document.createElement('button');
    lightboxNext.type = 'button';
    lightboxNext.className = 'product-lightbox__nav product-lightbox__nav--next';
    lightboxNext.setAttribute('aria-label', 'Следующее фото');
    lightboxNext.textContent = '›';
    const lightboxToolbar = document.createElement('div');
    lightboxToolbar.className = 'product-lightbox__toolbar';
    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.setAttribute('aria-label', 'Уменьшить фото');
    zoomOut.textContent = '−';
    const zoomLevel = document.createElement('span');
    zoomLevel.className = 'product-lightbox__zoom-level';
    const zoomIn = document.createElement('button');
    zoomIn.type = 'button';
    zoomIn.setAttribute('aria-label', 'Увеличить фото');
    zoomIn.textContent = '+';
    lightboxToolbar.append(zoomOut, zoomLevel, zoomIn);
    lightboxStage.append(lightboxImage, lightboxPrevious, lightboxNext, lightboxClose, lightboxToolbar);
    lightbox.appendChild(lightboxStage);
    document.body.appendChild(lightbox);

    let galleryImages = [];
    let currentGalleryIndex = 0;
    let zoomScale = 1;
    let touchStartX = null;

    function updateLightbox() {
        const imagePath = galleryImages[currentGalleryIndex];
        if (!imagePath) return;
        lightboxImage.src = resolveAssetPath(imagePath);
        lightboxImage.style.transform = 'scale(' + zoomScale + ')';
        zoomLevel.textContent = Math.round(zoomScale * 100) + '%';
        const hasMultipleImages = galleryImages.length > 1;
        lightboxPrevious.hidden = !hasMultipleImages;
        lightboxNext.hidden = !hasMultipleImages;
    }

    function renderGallery() {
        galleryOpenButton.replaceChildren();
        galleryThumbnails.replaceChildren();
        const imagePath = galleryImages[currentGalleryIndex];
        const hasMultipleImages = galleryImages.length > 1;
        gallery.classList.toggle('product-page__gallery--placeholder', !imagePath);
        galleryPrevious.hidden = !hasMultipleImages;
        galleryNext.hidden = !hasMultipleImages;
        galleryOpenButton.disabled = !imagePath;

        if (!imagePath) {
            const placeholder = document.createElement('span');
            placeholder.className = 'product-page__placeholder-text';
            placeholder.textContent = product.name || 'Фото товара';
            galleryOpenButton.appendChild(placeholder);
            return;
        }

        const image = document.createElement('img');
        image.src = resolveAssetPath(imagePath);
        image.alt = product.alt || product.name || '';
        image.loading = 'lazy';
        image.addEventListener('error', function () {
            image.remove();
            if (!galleryOpenButton.querySelector('img')) {
                const placeholder = document.createElement('span');
                placeholder.className = 'product-page__placeholder-text';
                placeholder.textContent = product.name || 'Фото товара';
                galleryOpenButton.appendChild(placeholder);
            }
        });
        galleryOpenButton.appendChild(image);

        if (lightbox && !lightbox.hidden) updateLightbox();

        galleryImages.forEach(function (thumbnailPath, index) {
            const thumbnail = document.createElement('button');
            thumbnail.type = 'button';
            thumbnail.className = 'product-page__gallery-thumbnail';
            thumbnail.classList.toggle('is-active', index === currentGalleryIndex);
            thumbnail.setAttribute('aria-label', 'Показать фото ' + (index + 1));
            thumbnail.setAttribute('aria-pressed', String(index === currentGalleryIndex));
            const thumbnailImage = document.createElement('img');
            thumbnailImage.src = resolveAssetPath(thumbnailPath);
            thumbnailImage.alt = '';
            thumbnailImage.loading = 'lazy';
            thumbnail.appendChild(thumbnailImage);
            thumbnail.addEventListener('click', function () {
                currentGalleryIndex = index;
                zoomScale = 1;
                renderGallery();
            });
            galleryThumbnails.appendChild(thumbnail);
        });
    }

    function setGalleryItem(item) {
        const candidateImages = [item && item.image]
            .concat(item && Array.isArray(item.gallery) ? item.gallery : [])
            .filter(function (imagePath) {
                return imagePath && imagePath !== 'img/no-image.jpg';
            });
        const uniqueImages = Array.from(new Set(candidateImages));
        const productImages = [product.image]
            .concat(Array.isArray(product.gallery) ? product.gallery : [])
            .filter(function (imagePath) {
                return imagePath && imagePath !== 'img/no-image.jpg';
            });
        galleryImages = uniqueImages.length ? uniqueImages : Array.from(new Set(productImages));
        currentGalleryIndex = 0;
        zoomScale = 1;
        renderGallery();
    }

    function moveGallery(step) {
        if (galleryImages.length < 2) return;
        currentGalleryIndex = (currentGalleryIndex + step + galleryImages.length) % galleryImages.length;
        zoomScale = 1;
        renderGallery();
    }

    function openLightbox() {
        if (!galleryImages.length) return;
        lightbox.hidden = false;
        document.body.classList.add('product-lightbox-open');
        updateLightbox();
        lightboxClose.focus();
    }

    function closeLightbox() {
        lightbox.hidden = true;
        document.body.classList.remove('product-lightbox-open');
        galleryOpenButton.focus();
    }

    galleryOpenButton.addEventListener('click', openLightbox);
    galleryPrevious.addEventListener('click', function () { moveGallery(-1); });
    galleryNext.addEventListener('click', function () { moveGallery(1); });
    lightboxPrevious.addEventListener('click', function () { moveGallery(-1); });
    lightboxNext.addEventListener('click', function () { moveGallery(1); });
    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function (event) {
        if (event.target === lightbox) closeLightbox();
    });
    zoomIn.addEventListener('click', function () {
        zoomScale = Math.min(zoomScale + 0.5, 3);
        updateLightbox();
    });
    zoomOut.addEventListener('click', function () {
        zoomScale = Math.max(zoomScale - 0.5, 1);
        updateLightbox();
    });
    lightboxImage.addEventListener('dblclick', function () {
        zoomScale = zoomScale === 1 ? 2 : 1;
        updateLightbox();
    });
    lightboxStage.addEventListener('touchstart', function (event) {
        if (event.touches.length === 1) touchStartX = event.touches[0].clientX;
    }, { passive: true });
    lightboxStage.addEventListener('touchend', function (event) {
        if (touchStartX === null || event.changedTouches.length !== 1) return;
        const swipeDistance = event.changedTouches[0].clientX - touchStartX;
        if (Math.abs(swipeDistance) > 48) moveGallery(swipeDistance > 0 ? -1 : 1);
        touchStartX = null;
    }, { passive: true });
    document.addEventListener('keydown', function (event) {
        if (lightbox.hidden) return;
        if (event.key === 'Escape') closeLightbox();
        else if (event.key === 'ArrowLeft') moveGallery(-1);
        else if (event.key === 'ArrowRight') moveGallery(1);
        else if (event.key === '+' || event.key === '=') {
            zoomScale = Math.min(zoomScale + 0.5, 3);
            updateLightbox();
        } else if (event.key === '-') {
            zoomScale = Math.max(zoomScale - 0.5, 1);
            updateLightbox();
        }
    });

    setGalleryItem(product);

    const info = document.createElement('div');
    info.className = 'product-page__info';

    const title = document.createElement('h1');
    title.className = 'product-page__title';
    title.textContent = product.name;
    info.appendChild(title);

    if (product.article) {
        const article = document.createElement('p');
        article.className = 'product-page__article';
        article.textContent = 'Артикул: ' + product.article;
        info.appendChild(article);
    }

    const productPriceInfo = getDiscountInfo(product.price, product.discountPercent, product.discountAmount);
    const priceWrap = document.createElement('div');
    priceWrap.className = 'product-page__price-wrap';

    const price = document.createElement('p');
    price.className = 'product-page__price';
    price.textContent = productPriceInfo.finalPrice.toLocaleString('ru-RU') + ' ₽';

    if (productPriceInfo.hasDiscount && productPriceInfo.oldPrice !== null) {
        const oldPrice = document.createElement('span');
        oldPrice.className = 'product-page__old-price';
        oldPrice.textContent = productPriceInfo.oldPrice.toLocaleString('ru-RU') + ' ₽';
        priceWrap.appendChild(oldPrice);
    }

    priceWrap.appendChild(price);

    if (productPriceInfo.hasDiscount) {
        const discountBadge = document.createElement('span');
        discountBadge.className = 'product-page__discount';
        discountBadge.textContent = '-' + productPriceInfo.discountPercent + '%';
        priceWrap.appendChild(discountBadge);
    }

    info.appendChild(priceWrap);

    let selectedVariant = null;
    let renderVariantSpecs = function () {};
    const availableVariants = getAvailableVariants(product);

    if (availableVariants.length > 0) {
        const variantBlock = document.createElement('div');
        variantBlock.className = 'product-page__variants';

        const variantLabel = document.createElement('label');
        variantLabel.className = 'product-page__label';
        variantLabel.textContent = 'Выберите вариант:';
        variantLabel.setAttribute('for', 'variantSelect');
        variantBlock.appendChild(variantLabel);

        const select = document.createElement('select');
        select.className = 'product-page__select';
        select.id = 'variantSelect';

        availableVariants.forEach(function (variant) {
            const option = document.createElement('option');
            option.value = variant.id;
            option.textContent = variant.name;
            select.appendChild(option);
        });

        variantBlock.appendChild(select);
        info.appendChild(variantBlock);

        select.addEventListener('change', function () {
            const variantId = this.value;
            const variant = availableVariants.find(function (v) {
                return v.id === variantId;
            });
            if (variant) {
                selectedVariant = variant;
                const variantDiscount = getDiscountInfo(variant.price, variant.discountPercent, variant.discountAmount);
                price.textContent = variantDiscount.finalPrice.toLocaleString('ru-RU') + ' ₽';
                const oldPriceEl = priceWrap.querySelector('.product-page__old-price');
                const discountEl = priceWrap.querySelector('.product-page__discount');
                if (oldPriceEl) oldPriceEl.remove();
                if (discountEl) discountEl.remove();

                if (variantDiscount.hasDiscount && variantDiscount.oldPrice !== null) {
                    const oldPrice = document.createElement('span');
                    oldPrice.className = 'product-page__old-price';
                    oldPrice.textContent = variantDiscount.oldPrice.toLocaleString('ru-RU') + ' ₽';
                    priceWrap.insertBefore(oldPrice, price);
                }

                if (variantDiscount.hasDiscount) {
                    const discountBadge = document.createElement('span');
                    discountBadge.className = 'product-page__discount';
                    discountBadge.textContent = '-' + variantDiscount.discountPercent + '%';
                    priceWrap.appendChild(discountBadge);
                }

                setGalleryItem(variant);
                updateStockBlock(variant);
                renderVariantSpecs(variant);
            }
        });

        selectedVariant = availableVariants[0];
        setGalleryItem(selectedVariant);
    } else if (!productHasAnyStock(product)) {
        if (productContainer) {
            productContainer.innerHTML = '';
        }
        return;
    }

    const stockBlock = document.createElement('div');
    stockBlock.className = 'product-page__stock';
    stockBlock.id = 'productStock';
    info.appendChild(stockBlock);

    const contactButton = document.createElement('a');
    contactButton.className = 'btn btn--primary product-page__contact-btn';
    contactButton.dataset.siteContact = 'chat';
    contactButton.textContent = 'Написать нам';
    contactButton.hidden = !((SITE_SETTINGS.contact || {}).chatUrl);
    if (!contactButton.hidden) {
        contactButton.href = SITE_SETTINGS.contact.chatUrl;
        contactButton.target = '_blank';
        contactButton.rel = 'noopener noreferrer';
    }
    info.appendChild(contactButton);

    content.appendChild(gallery);
    content.appendChild(info);
    productContainer.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'product-page__actions';

    /*
    const buyButton = document.createElement('button');
    buyButton.className = 'btn btn--primary add-to-cart';
    buyButton.textContent = 'В корзину';
    buyButton.addEventListener('click', function () {
        const variantOrProduct = selectedVariant || product;
        const variantId = selectedVariant ? selectedVariant.id : null;
        const variantName = selectedVariant ? selectedVariant.name : null;
        const price = Number(variantOrProduct.price) || 0;

        const added = cartAdd({
            productId: product.id,
            productName: product.name,
            productImage: product.image,
            variantId: variantId,
            variantName: variantName,
            price: price,
        }, 1);

        if (added) {
            const desc = variantName ? (product.name + ' — ' + variantName) : product.name;
            showToast('Товар добавлен в корзину: ' + desc);
        }
    });
    actions.appendChild(buyButton);
    */

    info.appendChild(actions);

    const specs = document.createElement('div');
    specs.className = 'specs';

    const specsTitle = document.createElement('h2');
    specsTitle.className = 'specs__title';
    specsTitle.textContent = 'Характеристики';
    specs.appendChild(specsTitle);

    addSpecRow(specs, 'Артикул', product.article || '—');
    addSpecRow(specs, 'Категория', product.category || 'Прочее');
    addSpecRow(specs, 'Наличие', product.stock > 0 ? 'В наличии' : 'Нет в наличии');

    if (Array.isArray(product.specs)) {
        product.specs.forEach(function (spec) {
            if (spec && (spec.name || spec.value)) {
                addSpecRow(specs, spec.name || 'Характеристика', spec.value || '—');
            }
        });
    }

    const variantSpecsContainer = document.createElement('div');
    renderVariantSpecs = function (variant) {
        variantSpecsContainer.replaceChildren();
        if (!variant || !Array.isArray(variant.specs)) return;
        variant.specs.forEach(function (spec) {
            if (spec && (spec.name || spec.value)) {
                addSpecRow(variantSpecsContainer, spec.name || 'Характеристика варианта', spec.value || '—');
            }
        });
    };
    renderVariantSpecs(selectedVariant);
    specs.appendChild(variantSpecsContainer);

    info.appendChild(specs);

    if (product.description) {
        const description = document.createElement('section');
        description.className = 'product-page__description';

        const descriptionTitle = document.createElement('h2');
        descriptionTitle.className = 'specs__title';
        descriptionTitle.textContent = 'Описание';

        const descriptionText = document.createElement('p');
        descriptionText.className = 'product-page__description-text';
        descriptionText.textContent = product.description;

        description.appendChild(descriptionTitle);
        description.appendChild(descriptionText);
        info.appendChild(description);
    }

    updateStockBlock(selectedVariant || product);

    if (selectedVariant) {
        const variantDiscount = getDiscountInfo(selectedVariant.price, selectedVariant.discountPercent, selectedVariant.discountAmount);
        price.textContent = variantDiscount.finalPrice.toLocaleString('ru-RU') + ' ₽';
        const oldPriceEl = priceWrap.querySelector('.product-page__old-price');
        const discountEl = priceWrap.querySelector('.product-page__discount');
        if (oldPriceEl) oldPriceEl.remove();
        if (discountEl) discountEl.remove();

        if (variantDiscount.hasDiscount && variantDiscount.oldPrice !== null) {
            const oldPrice = document.createElement('span');
            oldPrice.className = 'product-page__old-price';
            oldPrice.textContent = variantDiscount.oldPrice.toLocaleString('ru-RU') + ' ₽';
            priceWrap.insertBefore(oldPrice, price);
        }

        if (variantDiscount.hasDiscount) {
            const discountBadge = document.createElement('span');
            discountBadge.className = 'product-page__discount';
            discountBadge.textContent = '-' + variantDiscount.discountPercent + '%';
            priceWrap.appendChild(discountBadge);
        }
    }

    // initAddToCart();
}

function updateStockBlock(item) {
    const stockBlock = document.getElementById('productStock');
    if (!stockBlock) return;

    stockBlock.innerHTML = '';

    if (!item.stockByWarehouse || item.stockByWarehouse.length === 0) {
        const p = document.createElement('p');
        p.textContent = item.stock > 0 ? 'В наличии: ' + item.stock : 'Нет в наличии';
        stockBlock.appendChild(p);
        return;
    }

    const title = document.createElement('p');
    title.className = 'product-page__stock-title';
    title.textContent = 'Наличие на складах: (нажми, чтобы открыть на карте)';
    stockBlock.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'product-page__stock-list';

    item.stockByWarehouse.forEach(function (w) {
        const warehouseSettings = (SITE_SETTINGS.warehouses || {})[w.name] || {};
        if (warehouseSettings.visible === false) return;

        const li = document.createElement('li');
        const warehouseName = document.createElement(warehouseSettings.mapUrl ? 'a' : 'span');
        warehouseName.className = 'product-page__stock-location';
        warehouseName.textContent = w.name;
        if (warehouseSettings.mapUrl) {
            warehouseName.href = warehouseSettings.mapUrl;
            warehouseName.target = '_blank';
            warehouseName.rel = 'noopener noreferrer';
        }

        const quantity = document.createElement('span');
        quantity.textContent = w.qty + ' шт.';
        li.append(warehouseName, quantity);
        if (w.qty === 0) {
            li.classList.add('product-page__stock-item--empty');
        }
        list.appendChild(li);
    });

    stockBlock.appendChild(list);
}

function addSpecRow(parent, key, value) {
    const row = document.createElement('div');
    row.className = 'specs__row';

    const keyEl = document.createElement('span');
    keyEl.className = 'specs__key';
    keyEl.textContent = key;

    const valueEl = document.createElement('span');
    valueEl.className = 'specs__value';
    valueEl.textContent = value;

    row.appendChild(keyEl);
    row.appendChild(valueEl);
    parent.appendChild(row);
}