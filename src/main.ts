import './style.css';

// =========================
//  ЛОГОТИПЫ
// =========================
import logoPng from './img/4741cf64db2b1533c8ccafe45b1d6cbf25b87710.png';
import typePng from './img/TYPE.png';

// Подставляем в <img id="logo-main"> и <img id="logo-type">
const logoMain = document.getElementById('logo-main') as HTMLImageElement | null;
const logoType = document.getElementById('logo-type') as HTMLImageElement | null;
if (logoMain) logoMain.src = logoPng;
if (logoType) logoType.src = typePng;

// =========================
//  КОНСТАНТЫ / API
// =========================
const API = 'https://pokeapi.co/api/v2';

// Первая порция побольше, последующие — поменьше
const FIRST_PAGE = 60; // стартовая «шапка»
const PAGE = 30;       // все следующие порции

// =========================
//  ТИПЫ ДАННЫХ
// =========================
export type SimplePokemon = {
  id: number;             // номер вида (species.id)
  name: string;           // имя вида
  image: string | null;   // официальная картинка из default-покемона
  types: string[];        // типы из default-покемона
};

export type PokemonDetails = {
  id: number;
  name: string;
  image: string | null;
  types: string[];
  heightM: number;       // метры
  weightKg: number;      // килограммы
  abilities: string[];
  baseExp: number;
  stats: { name: string; base: number }[];
  flavor?: string;       // описание
};

// =========================
//  DOM
// =========================
const grid = document.getElementById('grid') as HTMLUListElement;
const searchEl = document.getElementById('search') as HTMLInputElement;
const typeFiltersEl = document.getElementById('type-filters') as HTMLDivElement;
const moreBtn = document.getElementById('more') as HTMLButtonElement | null;

// Сентинел для бесконечной прокрутки (не добавляем сразу, чтобы не было «дыры» внизу)
const sentinel = document.createElement('li');
sentinel.style.listStyle = 'none';
sentinel.setAttribute('aria-hidden', 'true');

// =========================
//  ПАЛИТРА ТИПОВ
// =========================
const typeColors: Record<string, string> = {
  normal: '#A8A878',
  fire: '#F08030',
  water: '#6890F0',
  grass: '#78C850',
  electric: '#F8D030',
  ice: '#98D8D8',
  fighting: '#C03028',
  poison: '#A040A0',
  ground: '#E0C068',
  flying: '#A890F0',
  psychic: '#F85888',
  bug: '#A8B820',
  rock: '#B8A038',
  ghost: '#705898',
  dragon: '#7038F8',
  dark: '#705848',
  steel: '#B8B8D0',
  fairy: '#EE99AC',
};
const ALL_TYPES = Object.keys(typeColors);

// =========================
//  СОСТОЯНИЕ
// =========================
let all: SimplePokemon[] = [];      // все загруженные на данный момент
let filtered: SimplePokemon[] = []; // отфильтрованные для рендера
const selectedTypes = new Set<string>();

let nextOffset = 0;                 // текущая позиция для пагинации
let TOTAL = Infinity;               // актуальное количество видов из API (base.count)
let loading = false;                // флаг «идёт загрузка»

// =========================
//  УТИЛИТЫ
// =========================
const pad3 = (n: number) => `#${String(n).padStart(3, '0')}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const debounce = <T extends (...a: any[]) => void>(fn: T, ms = 250) => {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    // @ts-ignore — таймер браузера, совместимый тип
    t = setTimeout(() => fn(...args), ms);
  };
};

// Проверка, остаётся ли сентинел в зоне просмотра (важно для автодогрузки)
function sentinelVisible(rootMarginPx = 800): boolean {
  const rect = sentinel.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.top <= vh + rootMarginPx; // должно совпадать с rootMargin у IO
}

// Мягкое ограничение параллелизма, чтобы не душить публичное API
async function mapLimit<T, R>(arr: T[], limit: number, mapper: (x: T) => Promise<R>): Promise<R[]> {
  const ret: R[] = [];
  let i = 0;
  const workers = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
    while (i < arr.length) {
      const idx = i++;
      ret[idx] = await mapper(arr[idx]);
    }
  });
  await Promise.all(workers);
  return ret;
}

// =========================
//  ФИЛЬТРЫ ТИПОВ (UI)
// =========================
function renderTypeFilters() {
  typeFiltersEl.innerHTML = ALL_TYPES.map(type => `
    <button class="type-pill" data-type="${type}" style="--pill:${typeColors[type]}">
      ${type.toUpperCase()}
    </button>
  `).join('');

  typeFiltersEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.type-pill');
    if (!btn) return;
    const type = btn.dataset.type!;
    if (selectedTypes.has(type)) selectedTypes.delete(type);
    else selectedTypes.add(type);
    btn.classList.toggle('is-active');
    applyFilters();
  });
}

// =========================
//  ЗАГРУЗКА ОДНОЙ ПОРЦИИ (ПО ВИДАМ)
// =========================
// Берём список видов из /pokemon-species и для каждого вида получаем default-покемона,
// чтобы отрисовать картинку и типы. Таким образом нумерация идёт 1..N, без форм.
async function loadPage(offset: number, limit: number): Promise<{ items: SimplePokemon[]; total: number; }> {
  const base = await fetch(`${API}/pokemon-species?offset=${offset}&limit=${limit}`).then(r => r.json());

  const items: SimplePokemon[] = (await mapLimit(base.results as any[], 8, async (it: any) => {
    const species = await fetch(it.url).then((r) => r.json());

    // default форма покемона для вида (varieties)
    const defaultVarUrl: string | undefined = species?.varieties?.find((v: any) => v.is_default)?.pokemon?.url;
    let image: string | null = null;
    let types: string[] = [];

    if (defaultVarUrl) {
      const d = await fetch(defaultVarUrl).then(r => r.json());
      image = d.sprites?.other?.['official-artwork']?.front_default ?? d.sprites?.front_default ?? null;
      types = (d.types ?? []).map((t: any) => t.type.name as string);
    }

    return {
      id: species.id,
      name: species.name,
      image,
      types,
    } as SimplePokemon;
  })).filter(Boolean) as SimplePokemon[];

  // сортировка на всякий случай по id (API обычно уже присылает по порядку)
  return { items: items.sort((a, b) => a.id - b.id), total: base.count as number };
}

// =========================
//  ФИЛЬТРАЦИЯ + РЕНДЕР
// =========================
function applyFilters() {
  const q = searchEl.value.trim().toLowerCase();

  filtered = all.filter(p => {
    const byText = !q || p.name.includes(q) || String(p.id) === q;
    const byType = selectedTypes.size === 0 || [...selectedTypes].every(t => p.types.includes(t));
    return byText && byType;
  });

  renderGrid();
}

function renderGrid() {
  if (!filtered.length) {
    grid.innerHTML = all.length
      ? `<li class="empty">No Pokémon found</li>`
      : `<li class="loading">Loading…</li>`;
    return; // при пустом списке сентинел не нужен
  }

  grid.innerHTML = filtered.map(p => `
    <li class="card" data-id="${p.id}">
      <div class="thumb">
        ${p.image
          ? `<img src="${p.image}" alt="${p.name}" loading="lazy" />`
          : `<div class="ph"></div>`}
      </div>
      <div class="meta">
        <span class="id">${pad3(p.id)}</span>
        <h3 class="name">${capitalize(p.name)}</h3>
        <div class="badges">
          ${p.types.map(t => `<span class=\"badge\" style=\"--c:${typeColors[t] ?? '#ddd'}\">${t.toUpperCase()}</span>`).join('')}
        </div>
      </div>
    </li>
  `).join('');

  // возвращаем сентинел в конец списка (для бесконечной прокрутки)
  grid.appendChild(sentinel);
}

// Поиск с дебаунсом
searchEl.addEventListener('input', debounce(applyFilters, 200));

// =========================
//  МОДАЛКА С ДЕТАЛЯМИ
// =========================
const modal = document.getElementById('modal') as HTMLDivElement;
const modalBody = document.getElementById('modal-body') as HTMLDivElement;

function showModal(html: string) {
  modalBody.innerHTML = html;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function hideModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}
modal?.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  if (el.dataset.close !== undefined) hideModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) hideModal();
});

// Клик по карточке — показываем детали
grid.addEventListener('click', async (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('li.card');
  if (!li) return;
  const id = Number(li.dataset.id);
  if (!id) return;

  const d = await fetchPokemonDetails(id);
  showModal(renderDetails(d));
});

const detailsCache = new Map<number, PokemonDetails>();

async function fetchPokemonDetails(id: number): Promise<PokemonDetails> {
  if (detailsCache.has(id)) return detailsCache.get(id)!;

  // id вида совпадает с id default-покемона для этого вида
  const poke = await fetch(`${API}/pokemon/${id}`).then(r => r.json());
  const species = await fetch(`${API}/pokemon-species/${id}`).then(r => r.json());

  const image =
    poke.sprites?.other?.['official-artwork']?.front_default ??
    poke.sprites?.front_default ??
    null;

  const heightM = (poke.height ?? 0) / 10;
  const weightKg = (poke.weight ?? 0) / 10;

  const abilities = (poke.abilities ?? [])
    .map((a: any) => a.ability?.name)
    .filter(Boolean)
    .map(capitalize);

  const stats = (poke.stats ?? []).map((s: any) => ({
    name: s.stat?.name as string,
    base: s.base_stat as number,
  }));

  let flavor: string | undefined;
  if (species?.flavor_text_entries) {
    const en = species.flavor_text_entries.find((x: any) => x.language?.name === 'en');
    flavor = en?.flavor_text
      ?.replace(/\f|\n|\r/g, ' ')
      ?.replace(/\s+/g, ' ')
      ?.trim();
  }

  const details: PokemonDetails = {
    id,
    name: poke.name,
    image,
    types: (poke.types ?? []).map((t: any) => t.type?.name as string),
    heightM,
    weightKg,
    abilities,
    baseExp: poke.base_experience ?? 0,
    stats,
    flavor,
  };

  detailsCache.set(id, details);
  return details;
}

function renderDetails(d: PokemonDetails): string {
  const statsMax = Math.max(100, ...d.stats.map(s => s.base || 0));
  return `
    <div class="detail-head">
      <img src="${d.image ?? ''}" alt="${d.name}">
      <div>
        <div class="detail-title">
          <span class="name">${capitalize(d.name)}</span>
          <span class="id">${pad3(d.id)}</span>
        </div>
        <div class="detail-tags">
          ${d.types.map(t => `<span class=\"detail-tag\" style=\"--c:${typeColors[t] ?? '#eee'}\">${t.toUpperCase()}</span>`).join('')}
        </div>
        ${d.flavor ? `<p style=\"margin:.2rem 0 .3rem; color:#4b5563\">${d.flavor}</p>` : ``}
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-card">
        <h4>Basics</h4>
        <div>Height: <b>${d.heightM.toFixed(1)} m</b></div>
        <div>Weight: <b>${d.weightKg.toFixed(1)} kg</b></div>
        <div>Base EXP: <b>${d.baseExp}</b></div>
        <div>Abilities: <b>${d.abilities.join(', ') || '—'}</b></div>
      </div>

      <div class="detail-card">
        <h4>Stats</h4>
        ${d.stats.map(s => `
          <div style=\"display:flex; align-items:center; gap:8px; margin:6px 0;\">
            <span style=\"width:110px; text-transform:uppercase; font-size:.8rem; color:#6b7280;\">${s.name}</span>
            <div class=\"stat-bar\"><b style=\"--w:${Math.round((s.base / statsMax) * 100)}%\"></b></div>
            <span style=\"width:34px; text-align:right; font-weight:700;\">${s.base}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// =========================
//  ДОЗАГРУЗКА / ИО
// =========================
let io: IntersectionObserver | null = null;

async function loadMore() {
  // не стартуем новую порцию, если уже грузим или всё догрузили
  if (loading || nextOffset >= TOTAL) return;
  loading = true;
  moreBtn?.setAttribute('disabled', 'true');

  // Плашка «Loading…» показывается ТОЛЬКО ПОСЛЕ первой порции,
  // чтобы не дублировать индикатор из renderGrid() при старте
  if (nextOffset > 0) {
    if (!grid.contains(sentinel)) grid.appendChild(sentinel);
    sentinel.innerHTML = '<div class="loading" style="text-align:center;padding:12px;color:#6b7280">Loading…</div>';
  }

  try {
    const limit = nextOffset === 0 ? FIRST_PAGE : PAGE;
    const { items, total } = await loadPage(nextOffset, limit);

    if (!Number.isFinite(TOTAL)) TOTAL = total; // species.count

    all.push(...items);
    nextOffset += items.length;

    applyFilters();

    // конец списка?
    if (nextOffset >= TOTAL || items.length < limit) {
      sentinel.innerHTML = '';
      io?.unobserve?.(sentinel);
      moreBtn?.classList.remove('is-visible');
    }
  } catch (err) {
    console.error(err);
    sentinel.innerHTML = '<div class="error">Failed to load. Try again.</div>';
    // Показать кнопку как резерв
    moreBtn?.classList.add('is-visible');
  } finally {
    loading = false;
    moreBtn?.removeAttribute('disabled');

    // «Автодосушка»: если сетка всё ещё короткая и сентинел виден —
    // сразу тянем следующую порцию, чтобы вытолкнуть сентинел ниже
    if (nextOffset < TOTAL && sentinelVisible()) {
      requestAnimationFrame(() => loadMore());
    }
  }
}

// =========================
//  ИНИЦИАЛИЗАЦИЯ
// =========================
renderTypeFilters();
applyFilters(); // покажем «Loading…» до первой загрузки

// Кнопка как резерв и для ручной дозагрузки
moreBtn?.addEventListener('click', () => loadMore());

// Бесконечная прокрутка, если поддерживается
if ('IntersectionObserver' in window) {
  io = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) loadMore();
  }, { root: null, rootMargin: '800px 0px' });
  io.observe(sentinel);
} else {
  // нет поддержки — показываем кнопку
  moreBtn?.classList.add('is-visible');
}

// первая порция
loadMore();


