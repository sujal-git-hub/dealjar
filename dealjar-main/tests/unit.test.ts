// Unit tests for the core rules (no browser, no server).  Run: npm test
import assert from "node:assert/strict";
import { test } from "vitest";
import { ASSET_LIST, ASSETS, PASSPORT_ROWS } from "@shared/assets";
import { FX, MICRO, formatMoney, inCurrency, isThin, priceImpact, usd } from "@shared/money";
import { PoolError, available, isSound, rewardOffer, rewardState, ruleReward, release, reserve, settle } from "@shared/rewards";
import type { Deal, Pool } from "@shared/types";

const pool = (over: Partial<Pool> = {}): Pool => ({ id: "p", sponsorId: "s", funded: usd(100), committed: 0, paid: 0, perPersonCap: usd(10), ...over });
const deal = (over: Partial<Deal> = {}): Deal => ({ id: "d", sponsorId: "s", poolId: "p", title: "t", summary: "s", category: "Food", price: usd(20), rewardRate: 0.1, rewardMax: usd(5), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), community: false, hue: 0, ...over });

test("available money is deposits minus what is reserved or paid, never below zero", () => {
  assert.equal(available(pool()), usd(100));
  assert.equal(available(pool({ committed: usd(30), paid: usd(20) })), usd(50));
  assert.equal(available(pool({ committed: usd(80), paid: usd(80) })), 0);
});

test("the reward rule is the smaller of the share of the price and the per-purchase maximum", () => {
  assert.equal(ruleReward(deal()), usd(2)); // 10% of 20
  assert.equal(ruleReward(deal({ price: usd(100), rewardMax: usd(5) })), usd(5)); // capped
  assert.equal(ruleReward(deal({ rewardRate: 0 })), 0);
});

test("an offer can never be more than the pool has left", () => {
  assert.equal(rewardOffer(deal(), pool()), usd(2));
  assert.equal(rewardOffer(deal(), pool({ funded: usd(100), paid: usd(99) })), usd(1)); // only $1 left
  assert.equal(rewardOffer(deal(), pool({ funded: usd(100), paid: usd(100) })), 0);
});

test("an offer can never be more than one person may still earn", () => {
  assert.equal(rewardOffer(deal(), pool({ perPersonCap: usd(10) }), usd(9)), usd(1));
  assert.equal(rewardOffer(deal(), pool({ perPersonCap: usd(10) }), usd(10)), 0);
  assert.equal(rewardOffer(deal(), pool({ perPersonCap: usd(10) }), usd(50)), 0);
});

test("an ended deal offers nothing and says so", () => {
  const ended = deal({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(rewardState(ended, pool()), "expired");
  assert.equal(rewardOffer(ended, pool()), 0);
});

test("the pool state tells people before it runs dry", () => {
  assert.equal(rewardState(deal(), pool()), "funded");
  assert.equal(rewardState(deal(), pool({ paid: usd(85) })), "low"); // 15% free
  assert.equal(rewardState(deal(), pool({ paid: usd(100) })), "empty");
  assert.equal(rewardState(deal({ price: usd(100), rewardMax: usd(50), rewardRate: 0.5 }), pool({ paid: usd(60) })), "low"); // a full reward no longer fits
});

test("reserving, settling and releasing keep the books balanced", () => {
  let p = pool();
  p = reserve(p, usd(10));
  assert.equal(available(p), usd(90));
  assert.ok(isSound(p));
  const settled = settle(p, usd(10));
  assert.equal(settled.committed, 0);
  assert.equal(settled.paid, usd(10));
  assert.ok(isSound(settled));
  const back = release(p, usd(10));
  assert.equal(available(back), usd(100));
});

test("a pool refuses to promise more than it holds, and refuses nonsense amounts", () => {
  assert.throws(() => reserve(pool(), usd(101)), PoolError);
  assert.throws(() => reserve(pool(), 0), PoolError);
  assert.throws(() => reserve(pool(), -5), PoolError);
  assert.throws(() => reserve(pool(), 1.5), PoolError);
  assert.throws(() => settle(pool(), usd(1)), PoolError);
  assert.throws(() => release(pool(), usd(1)), PoolError);
  assert.equal(isSound(pool({ committed: usd(60), paid: usd(50) })), false);
});

test("whatever the pot and the deal, an offer never exceeds what the pot holds, and reserve/settle/release keep it sound", () => {
  // a fixed-seed generator, so a failure is reproducible
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 3000; i++) {
    let p = pool({ funded: usd(rnd(500)), committed: 0, paid: 0, perPersonCap: usd(1 + rnd(20)) });
    const deal = { id: "d", sponsorId: "s", poolId: p.id, title: "t", summary: "", category: "Food" as const, price: usd(1 + rnd(200)), rewardRate: rnd(26) / 100, rewardMax: usd(rnd(10)), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), community: false, hue: 1 };
    for (let step = 0; step < 12; step++) {
      const offer = rewardOffer(deal, p, usd(rnd(15)));
      assert.ok(offer >= 0 && offer <= available(p), "offer within the pot");
      if (offer > 0 && rnd(3) > 0) {
        p = reserve(p, offer);
        assert.ok(isSound(p));
        if (rnd(2)) p = settle(p, offer);
        else p = release(p, offer);
      }
      assert.ok(isSound(p), "the pot stays sound after every step");
    }
  }
});

test("money in your own currency", () => {
  assert.equal(inCurrency(usd(10), "USD"), 10);
  assert.equal(inCurrency(usd(10), "CRC"), 10 * FX.CRC);
  assert.match(formatMoney(usd(12.5), "USD"), /\$12\.50/);
  assert.match(formatMoney(usd(1), "CRC"), /505/);
  assert.match(formatMoney(usd(1), "GMD"), /70/);
  assert.equal(MICRO, 1_000_000);
});

test("a swap is 'thin' when it would move the price more than about 1%", () => {
  const euro = ASSETS.EURE; // shallow pool in the demo
  assert.ok(priceImpact(euro, 100) < 0.01);
  assert.equal(isThin(euro, 100), false);
  assert.equal(isThin(euro, 1000), true);
  assert.equal(isThin(ASSETS.USDT, 1000), false);
  assert.equal(priceImpact(euro, 0), 0);
});

test("every savings option has a complete passport, and the draft labels say they are drafts", () => {
  for (const a of ASSET_LIST) {
    for (const row of PASSPORT_ROWS) assert.ok(String(a.passport[row.key]).length > 10, `${a.id}.${row.key}`);
    assert.equal(a.passport.reviewed, false, `${a.id} labels have not been reviewed against the issuer's documents`);
    assert.ok(["low", "medium", "high"].includes(a.passport.risk));
  }
});
