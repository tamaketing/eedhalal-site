// Budget matcher — the single rule the owner tool and the agent CLI share.
//
// One input: the customer's budget per box. One rule: a dish is offered only
// while `box price + chosen second dish + chosen add-ons <= budget`. Options
// that would push the total over the budget are not rendered at all, so an
// over-budget total can never be shown as a suggestion.
//
// The second dish ("อาหารเมนูที่ 2") is a dish IN the box and a Signature box
// takes exactly one, so it is a radio choice (one per box), never a checkbox.
//
// This module is deliberately dependency-free and free of Node built-ins so the
// same rules can run in the browser admin tool and in a terminal. It never reads
// cost data and never computes profit: selling price only.

export const toCents = (value) => Math.round(Number(value) * 100);
export const money = (cents) => (Number(cents) / 100).toLocaleString('th-TH');

/** Budget in baht (or cents) -> integer cents. Invalid or zero input -> 0. */
export function normalizeBudgetCents(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = toCents(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The second-dish group a dish may carry, or null when the tier has none.
 * @param {{tier?: string}} menu
 * @param {Record<string, {label?: string, max?: number, items?: unknown[]}>} secondDish
 */
export function secondDishFor(menu, secondDish = {}) {
  const group = secondDish[menu.tier || 'classic'];
  return Array.isArray(group?.items) && group.items.length ? group : null;
}

/**
 * Match the catalogue against a budget.
 *
 * @param {object} input
 * @param {Array<object>} input.menus priced, sellable dishes
 * @param {Array<{name: string, price: number}>} [input.toppings] add-ons
 * @param {Record<string, object>} [input.secondDish] group per tier id
 * @param {number} [input.budget] budget per box in baht
 * @returns {{budgetCents: number, matches: Array<object>, tierFloors: Array<object>, total: number}}
 */
export function matchMenusByBudget({
  menus = [],
  toppings = [],
  secondDish = {},
  budget = 0,
} = {}) {
  const budgetCents = normalizeBudgetCents(budget);
  const addons = toppings
    .filter((item) => item && item.name && Number(item.price) > 0)
    .map((item) => ({ ...item, price: Number(item.price) }));

  if (!budgetCents) {
    return { budgetCents: 0, matches: [], tierFloors: tierFloorsOf(menus), total: 0 };
  }

  const matches = [];
  for (const menu of menus) {
    const base = toCents(menu.price);
    // The dish itself must fit before anything else is considered.
    if (!(base <= budgetCents)) continue;

    const group = secondDishFor(menu, secondDish);
    const sideItems = group
      ? group.items
          .filter((item) => item && item.id && Number(item.price) > 0)
          .map((item) => {
            const sideCents = toCents(item.price);
            return {
              id: item.id,
              name: item.name,
              price: Number(item.price),
              totalCents: base + sideCents,
              total: money(base + sideCents),
              fits: base + sideCents <= budgetCents,
            };
          })
      : [];
    const offeredSides = sideItems.filter((item) => item.fits);

    // A tier that offers a second dish takes exactly one, so the cheapest one
    // is part of the minimum a box of that tier actually costs.
    const minTotalCents = sideItems.length
      ? base + Math.min(...sideItems.map((item) => toCents(item.price)))
      : base;

    matches.push({
      id: menu.id,
      name: menu.name,
      tier: menu.tier || 'classic',
      price: Number(menu.price),
      priceCents: base,
      desc: menu.desc || '',
      image: menu.image || '',
      minPerMenu: menu.minPerMenu ?? null,
      // Base dish alone, and the true floor once the required second dish is added.
      baseTotalCents: base,
      baseTotal: money(base),
      minTotalCents,
      minTotal: money(minTotalCents),
      // Side options that keep the box within budget. Empty means the budget
      // cannot afford a box of this tier at all once the dish is mandatory.
      affordable: sideItems.length === 0 || offeredSides.length > 0,
      secondDish: group
        ? {
            label: group.label || 'อาหารเมนูที่ 2',
            max: Number.isFinite(Number(group.max)) ? Number(group.max) : 1,
            required: true,
            offered: offeredSides,
            totalOmitted: sideItems.length - offeredSides.length,
          }
        : null,
      toppings: addons
        .map((item) => {
          const addCents = toCents(item.price);
          return {
            name: item.name,
            price: item.price,
            totalCents: base + addCents,
            total: money(base + addCents),
            fits: base + addCents <= budgetCents,
          };
        })
        .filter((item) => item.fits),
      toppingOmitted: addons.filter((item) => base + toCents(item.price) > budgetCents).length,
    });
  }

  matches.sort((a, b) => a.priceCents - b.priceCents || String(a.id).localeCompare(String(b.id)));

  return {
    budgetCents,
    budget: budgetCents / 100,
    matches,
    tierFloors: tierFloorsOf(matches.length ? matches : menus),
    total: matches.length,
  };
}

/** Cheapest offered dish per tier, computed from the catalogue itself. */
export function tierFloorsOf(menus = []) {
  const floors = new Map();
  for (const menu of menus) {
    if (!menu || !(Number(menu.price) > 0)) continue;
    const tier = menu.tier || 'classic';
    const price = Number(menu.price);
    const current = floors.get(tier);
    if (current === undefined || price < current.price) {
      floors.set(tier, { tier, price, id: menu.id, name: menu.name });
    }
  }
  return [...floors.values()].sort((a, b) => a.price - b.price);
}