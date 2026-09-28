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

function loadCatalogData() {
    const mergedUrl = resolveAssetPath('products-merged.json');
    const baseUrl = resolveAssetPath('products.json');

    return fetch(mergedUrl)
        .then(function (response) {
            if (!response.ok) {
                return fetch(baseUrl)
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
            return fetch(baseUrl)
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

let ALL_PRODUCTS = [];
let CURRENT_SEARCH_QUERY = '';
let CURRENT_FILTER_STATE = {
    type: 'all',
    categories: [],
    category: null,
    refine: null,
};
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

function productHasAnyStock(product) {
    if (!product) return false;

    if (Array.isArray(product.stockByWarehouse) && product.stockByWarehouse.length > 0) {
        const hasWarehouseStock = product.stockByWarehouse.some(function (warehouse) {
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

function getFilteredProducts() {
    return ALL_PRODUCTS.filter(function (product) {
        return productHasAnyStock(product)
            && productMatchesFilter(product)
            && productMatchesSearch(product, CURRENT_SEARCH_QUERY);
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

    clearProducts();
    hideNoResults();
    renderMoreProducts();

    const filtered = getFilteredProducts();
    if (filtered.length === 0 && (CURRENT_SEARCH_QUERY || CURRENT_FILTER_STATE.type !== 'all')) {
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

if (productsContainer) {
    loadCatalogData()
        .then(function (products) {
            ALL_PRODUCTS = products;

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
    const article = document.createElement('article');
    article.className = 'product';
    article.dataset.category = product.category || '';
    article.dataset.price = product.price || 0;
    article.dataset.productId = product.id || '';
    article.dataset.productName = product.name || '';
    article.dataset.productImage = product.image || '';
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
    img.src = product.image;
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

    if (product.image === 'img/no-image.jpg') {
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
    const filtersTrack = document.getElementById('filtersTrack');
    const backBtn = document.getElementById('backBtn');
    const backToSubsBtn = document.getElementById('backToSubsBtn');
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
    const prevBtn = document.querySelector('.hero-carousel__arrow--prev');
    const nextBtn = document.querySelector('.hero-carousel__arrow--next');
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
        });
    }

    prevBtn?.addEventListener('click', function () {
        showSlide(currentSlide - 1);
        restartAutoplay();
    });

    nextBtn?.addEventListener('click', function () {
        showSlide(currentSlide + 1);
        restartAutoplay();
    });

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

const productContainer = document.getElementById('productContainer');

if (productContainer) {
    loadProductPage();
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

    const img = document.createElement('img');
    img.src = product.image;
    img.alt = product.alt || product.name || '';
    img.loading = 'lazy';

    let galleryPlaceholderShown = false;
    function showGalleryPlaceholder() {
        if (galleryPlaceholderShown) return;
        galleryPlaceholderShown = true;

        if (img.parentNode) {
            img.remove();
        }

        gallery.classList.add('product-page__gallery--placeholder');
        const text = document.createElement('span');
        text.className = 'product-page__placeholder-text';
        text.textContent = product.name || 'Фото товара';
        gallery.appendChild(text);
    }

    img.addEventListener('error', function () {
        showGalleryPlaceholder();
    });

    gallery.appendChild(img);

    if (product.image === 'img/no-image.jpg') {
        showGalleryPlaceholder();
    }

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
            option.textContent = variant.name + ' — ' + variant.price.toLocaleString('ru-RU') + ' ₽';
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

                updateStockBlock(variant);
            }
        });

        selectedVariant = availableVariants[0];
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

    if (availableVariants.length > 0) {
        addSpecRow(specs, 'Количество вариантов', availableVariants.length);
    }

    info.appendChild(specs);

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
    title.textContent = 'Наличие на складах:';
    stockBlock.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'product-page__stock-list';

    item.stockByWarehouse.forEach(function (w) {
        const li = document.createElement('li');
        li.textContent = w.name + ': ' + w.qty + ' шт.';
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