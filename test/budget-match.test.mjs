// The one budget rule, tested without any service running: a dish is offered
// only while box price + chosen second dish + chosen add-ons <= budget, and an
// option that would break the budget must never appear at all.
import test from 'node:test';
import assert from 'node:assert/strict';

import { matchMenusByBudget, normalizeBudgetCents, tierFloorsOf, toCents } from '../services/budget-match.mjs';

const CATALOGUE = {
  menus: [
    { id: 1, name: 'plain', price: 65, tier: 'classic' },
    { id: 2, name: 'expensive', price: 230, tier: 'executive' },
  ],
  toppings: [
    { name: 'egg', price: 10 },
    { name: 'fruit', price: 35 },
    { name: 'pricey side', price: 40 },
  ],
  secondDish: {
    signature: {
      label: 'second dish',
      max: 1,
      items: [
        { id: 'side-cheap', name: 'cheap side', price: 30 },
        { id: 'side-costly', name: 'costly side', price: 50 },
      ],
    },
  },
};

test('a dish priced above the budget is never offered', () => {
  const report = matchMenusByBudget({ ...CATALOGUE, budget: 120 });
  assert.deepEqual(report.matches.map((match) => match.id), [1]);
});

test('an add-on that would break the budget is not offered', () => {
  const report = matchMenusByBudget({ ...CATALOGUE, budget: 100 });
  const [match] = report.matches;
  // 65 + 35 = 100 fits; 65 + 40 = 105 does not.
  assert.deepEqual(match.toppings.map((item) => item.name), ['egg', 'fruit']);
  assert.equal(match.toppingOmitted, 1);
});

test('a second dish over the budget is dropped from the offered list', () => {
  const report = matchMenusByBudget({
    menus: [{ id: 3, name: 'sig', price: 160, tier: 'signature' }],
    toppings: [],
    secondDish: CATALOGUE.secondDish,
    budget: 200,
  });
  const [match] = report.matches;
  assert.equal(match.secondDish.required, true);
  // 160 + 30 = 190 fits, 160 + 50 = 210 does not.
  assert.deepEqual(match.secondDish.offered.map((item) => item.id), ['side-cheap']);
  assert.equal(match.secondDish.totalOmitted, 1);
});

test('the reported minimum includes the mandatory second dish', () => {
  const report = matchMenusByBudget({
    menus: [{ id: 3, name: 'sig', price: 160, tier: 'signature' }],
    toppings: [],
    secondDish: CATALOGUE.secondDish,
    budget: 200,
  });
  assert.equal(report.matches[0].minTotalCents, 19000);
});

test('a budget too low for the mandatory second dish is reported as not affordable', () => {
  const report = matchMenusByBudget({
    menus: [{ id: 3, name: 'sig', price: 160, tier: 'signature' }],
    toppings: [],
    secondDish: CATALOGUE.secondDish,
    budget: 170,
  });
  assert.equal(report.matches[0].affordable, false);
  assert.deepEqual(report.matches[0].secondDish.offered, []);
});

test('no budget returns nothing instead of guessing', () => {
  const report = matchMenusByBudget({ ...CATALOGUE, budget: 0 });
  assert.equal(report.matches.length, 0);
  assert.equal(report.budgetCents, 0);
});

test('an invalid budget is treated as no budget', () => {
  assert.equal(normalizeBudgetCents('abc'), 0);
  assert.equal(normalizeBudgetCents(-5), 0);
  assert.equal(normalizeBudgetCents(120), 12000);
});

test('money maths stays in integer cents', () => {
  assert.equal(toCents(64.5), 6450);
  // A total landing exactly on the budget still fits.
  const report = matchMenusByBudget({ ...CATALOGUE, budget: 100 });
  assert.ok(report.matches[0].toppings.some((item) => item.totalCents === 10000));
});

test('tier floors come from the catalogue, cheapest per tier', () => {
  const floors = tierFloorsOf([
    { id: 9, name: 'sig', price: 160, tier: 'signature' },
    { id: 3, name: 'cls', price: 65, tier: 'classic' },
    { id: 4, name: 'cls2', price: 75, tier: 'classic' },
  ]);
  assert.deepEqual(floors.map((row) => [row.tier, row.price]), [
    ['classic', 65],
    ['signature', 160],
  ]);
});