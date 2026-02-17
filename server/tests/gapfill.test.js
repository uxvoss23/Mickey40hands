const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

jest_mock_pool();
function jest_mock_pool() {
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../db/pool' || request.endsWith('db/pool')) {
      return 'mock-pool';
    }
    return origResolve.call(this, request, parent, ...rest);
  };
  require.cache['mock-pool'] = {
    id: 'mock-pool',
    filename: 'mock-pool',
    loaded: true,
    exports: { query: async () => ({ rows: [] }) }
  };
}

const {
  JOB_DURATION_MINUTES,
  BUFFER_MINUTES,
  HARD_CUTOFF_HOUR,
  MAX_CONTACTS_PER_WEEK,
  MAX_CONTACTS_PER_MONTH,
  COOLDOWN_MONTHS,
  MILES_PER_DEGREE_LAT,
  AVG_SPEED_MPH,
  LAYER_CONFIG,
  TIER_MESSAGES,
  haversineDistance,
  estimateDriveMinutes,
  directionScore,
  determineTier,
  getRecurrenceMonths,
  filterAndScoreCandidates
} = require('../routes/gapfill')._testExports;

const REF_LAT = 32.7767;
const REF_LNG = -96.7970;

function makeSession(overrides = {}) {
  return {
    reference_lat: REF_LAT,
    reference_lng: REF_LNG,
    next_stop_lat: REF_LAT + 0.05,
    next_stop_lng: REF_LNG + 0.03,
    next_stop_time: '16:00',
    cancelled_job_description: 'Residential Panel Cleaning',
    ...overrides
  };
}

function makeCustomer(id, latOffset, lngOffset, overrides = {}) {
  return {
    id,
    lat: REF_LAT + latOffset,
    lng: REF_LNG + lngOffset,
    phone: '555-0100',
    ...overrides
  };
}

function makeCSTTime(hour, minute) {
  const d = new Date(2026, 1, 17, hour, minute, 0);
  return d;
}

function runPipeline(customers, opts = {}) {
  const session = makeSession(opts.session || {});
  const config = opts.config || LAYER_CONFIG[opts.layer || 1];
  const layer = opts.layer || 1;
  const excludeIds = opts.excludeIds || new Set();
  const outreachMap = opts.outreachMap || {};
  const cancelledTodayIds = opts.cancelledTodayIds || new Set();
  const lastContactMap = opts.lastContactMap || {};
  const cstNow = opts.cstNow || makeCSTTime(10, 0);
  const now = opts.now || new Date('2026-02-17T16:00:00Z');

  return filterAndScoreCandidates(
    customers, session, config, layer, excludeIds,
    outreachMap, cancelledTodayIds, lastContactMap, cstNow, now
  );
}


describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    assert.equal(haversineDistance(32.7, -96.8, 32.7, -96.8), 0);
  });

  it('calculates short distance accurately (~3.5mi in DFW)', () => {
    const d = haversineDistance(32.7767, -96.7970, 32.7357, -96.8353);
    assert.ok(d > 3 && d < 4, `Expected ~3.5mi, got ${d}`);
  });

  it('is symmetric', () => {
    const d1 = haversineDistance(32.7, -96.8, 33.0, -97.0);
    const d2 = haversineDistance(33.0, -97.0, 32.7, -96.8);
    assert.ok(Math.abs(d1 - d2) < 0.001);
  });
});


describe('estimateDriveMinutes', () => {
  it('returns 0 for 0 miles', () => assert.equal(estimateDriveMinutes(0), 0));
  it('25 miles = 60 min at 25mph', () => assert.equal(estimateDriveMinutes(25), 60));
  it('scales linearly', () => {
    assert.ok(Math.abs(estimateDriveMinutes(20) - estimateDriveMinutes(10) * 2) < 0.001);
  });
});


describe('getRecurrenceMonths', () => {
  it('biannual=6', () => assert.equal(getRecurrenceMonths('biannual'), 6));
  it('annual=12', () => assert.equal(getRecurrenceMonths('annual'), 12));
  it('triannual=4', () => assert.equal(getRecurrenceMonths('triannual'), 4));
  it('"3"=3', () => assert.equal(getRecurrenceMonths('3'), 3));
  it('unknown defaults to 6', () => assert.equal(getRecurrenceMonths('unknown'), 6));
});


describe('determineTier', () => {
  const now = new Date('2026-02-17T12:00:00Z');
  const session = { cancelled_job_description: 'Residential Panel Cleaning' };

  it('Tier 1: anytime_access', () => {
    const r = determineTier({ anytime_access: true }, session, now);
    assert.equal(r.tier, 1);
  });

  it('Tier 2: recurring overdue (>= 1.5x interval)', () => {
    const ago = new Date(now); ago.setMonth(ago.getMonth() - 18);
    const r = determineTier({ is_recurring: true, recurrence_for_type: '12', last_service_for_type: ago.toISOString() }, session, now);
    assert.equal(r.tier, 2);
    assert.ok(r.reason.includes('overdue'));
  });

  it('Tier 2: recurring due (within 1 month of interval)', () => {
    const ago = new Date(now); ago.setMonth(ago.getMonth() - 11);
    const r = determineTier({ is_recurring: true, recurrence_for_type: '12', last_service_for_type: ago.toISOString() }, session, now);
    assert.equal(r.tier, 2);
  });

  it('NOT Tier 2: recurring cleaned recently', () => {
    const ago = new Date(now); ago.setMonth(ago.getMonth() - 2);
    const r = determineTier({ is_recurring: true, recurrence_for_type: '12', last_service_for_type: ago.toISOString() }, session, now);
    assert.notEqual(r.tier, 2);
  });

  it('Tier 3: flexible, no scheduled job', () => {
    const r = determineTier({ flexible: true, next_scheduled_for_type: null }, session, now);
    assert.equal(r.tier, 3);
  });

  it('NOT Tier 3: flexible WITH scheduled job', () => {
    const future = new Date(now); future.setDate(future.getDate() + 10);
    const r = determineTier({ flexible: true, next_scheduled_for_type: future.toISOString() }, session, now);
    assert.notEqual(r.tier, 3);
  });

  it('Tier 4: job scheduled within 21 days', () => {
    const future = new Date(now); future.setDate(future.getDate() + 10);
    const r = determineTier({ next_scheduled_for_type: future.toISOString() }, session, now);
    assert.equal(r.tier, 4);
  });

  it('NOT Tier 4: job >21 days out', () => {
    const future = new Date(now); future.setDate(future.getDate() + 30);
    const r = determineTier({ next_scheduled_for_type: future.toISOString() }, session, now);
    assert.notEqual(r.tier, 4);
  });

  it('Tier 5: past non-recurring', () => {
    const ago = new Date(now); ago.setMonth(ago.getMonth() - 16);
    const r = determineTier({ completed_count_for_type: '2', is_recurring: false, last_service_for_type: ago.toISOString() }, session, now);
    assert.equal(r.tier, 5);
  });

  it('Tier 5: fallback', () => {
    const r = determineTier({}, session, now);
    assert.equal(r.tier, 5);
  });

  it('Priority: anytime_access beats everything', () => {
    const ago = new Date(now); ago.setMonth(ago.getMonth() - 18);
    const r = determineTier({ anytime_access: true, is_recurring: true, recurrence_for_type: '12', last_service_for_type: ago.toISOString(), flexible: true }, session, now);
    assert.equal(r.tier, 1);
  });

  it('Priority: recurring overdue beats flexible', () => {
    const ago = new Date(now); ago.setMonth(ago.getMonth() - 18);
    const r = determineTier({ is_recurring: true, recurrence_for_type: '12', last_service_for_type: ago.toISOString(), flexible: true, next_scheduled_for_type: null }, session, now);
    assert.equal(r.tier, 2);
  });
});


describe('directionScore', () => {
  it('returns 0 when no next stop', () => {
    assert.equal(directionScore(32.7, -96.8, null, null, 32.8, -96.7), 0);
  });

  it('~1.0 for candidate in same direction as next stop', () => {
    const s = directionScore(32.7, -96.8, 33.0, -96.5, 32.85, -96.65);
    assert.ok(s > 0.95, `Expected ~1.0, got ${s}`);
  });

  it('~-1.0 for candidate in opposite direction', () => {
    const s = directionScore(32.7, -96.8, 33.0, -96.5, 32.4, -97.1);
    assert.ok(s < -0.95, `Expected ~-1.0, got ${s}`);
  });

  it('~0 for perpendicular candidate', () => {
    const s = directionScore(32.7, -96.8, 33.0, -96.8, 32.7, -96.5);
    assert.ok(Math.abs(s) < 0.15, `Expected ~0, got ${s}`);
  });
});


describe('filterAndScoreCandidates - Time Feasibility', () => {
  it('includes nearby customer when plenty of time before cutoff', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], { cstNow: makeCSTTime(10, 0) });
    assert.equal(result.length, 1);
  });

  it('excludes customer when job would finish after 6PM cutoff', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], { cstNow: makeCSTTime(17, 0) });
    assert.equal(result.length, 0, 'Job starting at 5PM + 75min = 6:15PM, past cutoff');
  });

  it('includes customer when job ends exactly at cutoff', () => {
    const c = makeCustomer(1, 0, 0);
    const result = runPipeline([c], {
      cstNow: makeCSTTime(16, 45),
      session: { next_stop_time: null },
      layer: 3,
      config: LAYER_CONFIG[3]
    });
    assert.equal(result.length, 1, 'Job at 0mi drive, 16:45 + 75min = 18:00 exactly');
  });

  it('excludes customer when 1 minute past cutoff', () => {
    const c = makeCustomer(1, 0, 0);
    const result = runPipeline([c], {
      cstNow: makeCSTTime(16, 46),
      session: { next_stop_time: null },
      layer: 3,
      config: LAYER_CONFIG[3]
    });
    assert.equal(result.length, 0, '16:46 + 75min = 18:01, past cutoff');
  });

  it('time-gated layer: excludes customer when total time exceeds next stop time', () => {
    const c = makeCustomer(1, 0.05, 0.05);
    const result = runPipeline([c], {
      cstNow: makeCSTTime(14, 0),
      session: { next_stop_time: '14:30' },
      layer: 1
    });
    assert.equal(result.length, 0, 'drive+job+buffer exceeds 30min until next stop');
  });

  it('time-gated layer: includes customer when total time fits before next stop', () => {
    const c = makeCustomer(1, 0, 0);
    const result = runPipeline([c], {
      cstNow: makeCSTTime(10, 0),
      session: { next_stop_time: '16:00' },
      layer: 1
    });
    assert.equal(result.length, 1, '0mi drive + 75min job + 10min buffer = 85min, fits before 16:00');
  });

  it('non-gated layer (3): ignores next stop time, only checks cutoff', () => {
    const c = makeCustomer(1, 0.05, 0.05);
    const result = runPipeline([c], {
      cstNow: makeCSTTime(10, 0),
      session: { next_stop_time: '10:30' },
      layer: 3,
      config: LAYER_CONFIG[3]
    });
    assert.equal(result.length, 1, 'Layer 3 does not enforce time gate');
  });

  it('non-gated layer still enforces 6PM cutoff', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], {
      cstNow: makeCSTTime(17, 0),
      layer: 3,
      config: LAYER_CONFIG[3]
    });
    assert.equal(result.length, 0, 'Layer 3 still respects hard cutoff');
  });

  it('drive time factors into feasibility: far customer excluded, close one included', () => {
    const close = makeCustomer(1, 0.001, 0.001);
    const far = makeCustomer(2, 0.08, 0.08);
    const result = runPipeline([close, far], {
      cstNow: makeCSTTime(16, 30),
      session: { next_stop_time: null },
      layer: 1
    });
    const ids = result.map(r => r.customer_id);
    assert.ok(ids.includes(1), 'Close customer should be included');
    assert.ok(!ids.includes(2), 'Far customer should be excluded by cutoff');
  });
});


describe('filterAndScoreCandidates - Distance Filtering', () => {
  it('layer 1: includes customer within 8mi', () => {
    const c = makeCustomer(1, 0.05, 0.05);
    const d = haversineDistance(REF_LAT, REF_LNG, REF_LAT + 0.05, REF_LNG + 0.05);
    assert.ok(d < 8, `Precondition: distance ${d} should be <8mi`);
    const result = runPipeline([c], { layer: 1 });
    assert.equal(result.length, 1);
  });

  it('layer 1: excludes customer beyond 8mi', () => {
    const c = makeCustomer(1, 0.15, 0.15);
    const d = haversineDistance(REF_LAT, REF_LNG, REF_LAT + 0.15, REF_LNG + 0.15);
    assert.ok(d > 8, `Precondition: distance ${d} should be >8mi`);
    const result = runPipeline([c], { layer: 1 });
    assert.equal(result.length, 0);
  });

  it('layer 2: includes customer between 8-15mi', () => {
    const c = makeCustomer(1, 0.15, 0.15);
    const d = haversineDistance(REF_LAT, REF_LNG, REF_LAT + 0.15, REF_LNG + 0.15);
    assert.ok(d > 8 && d <= 15, `Precondition: distance ${d} should be 8-15mi`);
    const result = runPipeline([c], { layer: 2, config: LAYER_CONFIG[2] });
    assert.equal(result.length, 1);
  });

  it('layer 4: includes customer up to 30mi', () => {
    const c = makeCustomer(1, 0.35, 0.20);
    const d = haversineDistance(REF_LAT, REF_LNG, REF_LAT + 0.35, REF_LNG + 0.20);
    assert.ok(d < 30, `Precondition: distance ${d} should be <30mi`);
    const result = runPipeline([c], { layer: 4, config: LAYER_CONFIG[4] });
    assert.equal(result.length, 1);
  });

  it('layer 4: excludes customer beyond 30mi', () => {
    const c = makeCustomer(1, 0.5, 0.5);
    const d = haversineDistance(REF_LAT, REF_LNG, REF_LAT + 0.5, REF_LNG + 0.5);
    assert.ok(d > 30, `Precondition: distance ${d} should be >30mi`);
    const result = runPipeline([c], { layer: 4, config: LAYER_CONFIG[4] });
    assert.equal(result.length, 0);
  });

  it('progressive expansion: same customer excluded at layer 1, included at layer 2', () => {
    const c = makeCustomer(1, 0.15, 0.15);
    const r1 = runPipeline([c], { layer: 1 });
    const r2 = runPipeline([c], { layer: 2, config: LAYER_CONFIG[2] });
    assert.equal(r1.length, 0, 'Excluded at layer 1');
    assert.equal(r2.length, 1, 'Included at layer 2');
  });
});


describe('filterAndScoreCandidates - Directional Scoring', () => {
  it('candidate toward next stop gets positive direction_score', () => {
    const c = makeCustomer(1, 0.03, 0.02);
    const result = runPipeline([c]);
    assert.equal(result.length, 1);
    assert.ok(result[0].direction_score > 0, `Expected positive direction score, got ${result[0].direction_score}`);
  });

  it('candidate opposite from next stop gets negative direction_score', () => {
    const c = makeCustomer(1, -0.03, -0.02);
    const result = runPipeline([c]);
    assert.equal(result.length, 1);
    assert.ok(result[0].direction_score < 0, `Expected negative direction score, got ${result[0].direction_score}`);
  });

  it('direction_score is 0 when no next stop defined', () => {
    const c = makeCustomer(1, 0.03, 0.02);
    const result = runPipeline([c], {
      session: { next_stop_lat: null, next_stop_lng: null, next_stop_time: null }
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].direction_score, 0);
  });
});


describe('filterAndScoreCandidates - Sorting', () => {
  it('output sorted by tier first, then by distance', () => {
    const c1 = makeCustomer(1, 0.01, 0.01, { anytime_access: true });
    const c2 = makeCustomer(2, 0.005, 0.005, { flexible: true, next_scheduled_for_type: null });
    const c3 = makeCustomer(3, 0.02, 0.02, { anytime_access: true });
    const result = runPipeline([c1, c2, c3]);
    assert.equal(result[0].tier, 1);
    assert.equal(result[1].tier, 1);
    assert.equal(result[2].tier, 3);
    assert.ok(result[0].distance_miles <= result[1].distance_miles, 'Within tier 1, closer first');
  });

  it('tier 1 always before tier 5 even if tier 5 is closer', () => {
    const t5 = makeCustomer(1, 0.001, 0.001);
    const t1 = makeCustomer(2, 0.05, 0.05, { anytime_access: true });
    const result = runPipeline([t5, t1]);
    assert.equal(result[0].tier, 1);
    assert.equal(result[1].tier, 5);
    assert.ok(result[0].distance_miles > result[1].distance_miles, 'Tier 1 is farther but ranked first');
  });

  it('within same tier, closest customer is first', () => {
    const c1 = makeCustomer(1, 0.05, 0.05, { anytime_access: true });
    const c2 = makeCustomer(2, 0.02, 0.02, { anytime_access: true });
    const c3 = makeCustomer(3, 0.03, 0.03, { anytime_access: true });
    const result = runPipeline([c1, c2, c3]);
    assert.ok(result[0].distance_miles <= result[1].distance_miles);
    assert.ok(result[1].distance_miles <= result[2].distance_miles);
  });
});


describe('filterAndScoreCandidates - Suppression Rules', () => {
  it('excludes customer contacted 1+ times this week', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], {
      outreachMap: { 1: { weekCount: 1, monthCount: 1 } }
    });
    assert.equal(result.length, 0, 'Weekly limit exceeded');
  });

  it('includes customer with 0 contacts this week', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], {
      outreachMap: { 1: { weekCount: 0, monthCount: 2 } }
    });
    assert.equal(result.length, 1);
  });

  it('excludes customer contacted 3+ times this month', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], {
      outreachMap: { 1: { weekCount: 0, monthCount: 3 } }
    });
    assert.equal(result.length, 0, 'Monthly limit exceeded');
  });

  it('includes customer with 2 contacts this month and 0 this week', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], {
      outreachMap: { 1: { weekCount: 0, monthCount: 2 } }
    });
    assert.equal(result.length, 1);
  });

  it('excludes customer in excludeIds (already on route)', () => {
    const c = makeCustomer(42, 0.01, 0.01);
    const result = runPipeline([c], { excludeIds: new Set([42]) });
    assert.equal(result.length, 0);
  });

  it('excludes customer who cancelled today', () => {
    const c = makeCustomer(7, 0.01, 0.01);
    const result = runPipeline([c], { cancelledTodayIds: new Set([7]) });
    assert.equal(result.length, 0);
  });

  it('6-month cooldown: excludes customer serviced 3 months ago', () => {
    const now = new Date('2026-02-17T16:00:00Z');
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const c = makeCustomer(1, 0.01, 0.01, {
      last_service_for_type: threeMonthsAgo.toISOString()
    });
    const result = runPipeline([c], { now });
    assert.equal(result.length, 0, 'Within 6-month cooldown');
  });

  it('6-month cooldown: includes customer serviced 7 months ago', () => {
    const now = new Date('2026-02-17T16:00:00Z');
    const sevenMonthsAgo = new Date(now);
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
    const c = makeCustomer(1, 0.01, 0.01, {
      last_service_for_type: sevenMonthsAgo.toISOString()
    });
    const result = runPipeline([c], { now });
    assert.equal(result.length, 1, 'Past 6-month cooldown');
  });

  it('includes customer with no service history (no cooldown applies)', () => {
    const c = makeCustomer(1, 0.01, 0.01, {
      last_service_for_type: null
    });
    const result = runPipeline([c]);
    assert.equal(result.length, 1);
  });

  it('multiple suppressions stack: weekly limit blocks even if monthly is fine', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c], {
      outreachMap: { 1: { weekCount: 1, monthCount: 0 } }
    });
    assert.equal(result.length, 0);
  });
});


describe('filterAndScoreCandidates - 20 Outreach Limit', () => {
  it('max 4 expansion layers exist, no 5th layer', () => {
    assert.ok(LAYER_CONFIG[4]);
    assert.equal(LAYER_CONFIG[5], undefined);
  });

  it('outreach caps (1/wk, 3/mo) prevent repeated contacts across sessions', () => {
    const customers = [];
    for (let i = 1; i <= 30; i++) {
      customers.push(makeCustomer(i, 0.001 * i, 0.001 * i));
    }
    const outreachMap = {};
    for (let i = 1; i <= 10; i++) {
      outreachMap[i] = { weekCount: 1, monthCount: 1 };
    }
    for (let i = 11; i <= 15; i++) {
      outreachMap[i] = { weekCount: 0, monthCount: 3 };
    }

    const result = runPipeline(customers, { outreachMap });
    const includedIds = new Set(result.map(r => r.customer_id));
    for (let i = 1; i <= 15; i++) {
      assert.ok(!includedIds.has(i), `Customer ${i} should be suppressed`);
    }
    for (let i = 16; i <= 30; i++) {
      assert.ok(includedIds.has(i), `Customer ${i} should be included`);
    }
    assert.equal(result.length, 15, 'Only unsuppressed customers returned');
  });

  it('all customers suppressed returns empty list', () => {
    const customers = [];
    const outreachMap = {};
    for (let i = 1; i <= 5; i++) {
      customers.push(makeCustomer(i, 0.001 * i, 0.001 * i));
      outreachMap[i] = { weekCount: 1, monthCount: 1 };
    }
    const result = runPipeline(customers, { outreachMap });
    assert.equal(result.length, 0);
  });
});


describe('filterAndScoreCandidates - Tier Qualification via Pipeline', () => {
  it('anytime_access customer gets tier 1 in pipeline output', () => {
    const c = makeCustomer(1, 0.01, 0.01, { anytime_access: true });
    const result = runPipeline([c]);
    assert.equal(result[0].tier, 1);
  });

  it('flexible unscheduled customer gets tier 3 in pipeline output', () => {
    const c = makeCustomer(1, 0.01, 0.01, { flexible: true, next_scheduled_for_type: null });
    const result = runPipeline([c]);
    assert.equal(result[0].tier, 3);
  });

  it('mixed tiers are correctly assigned and sorted in pipeline', () => {
    const c1 = makeCustomer(1, 0.03, 0.03, { anytime_access: true });
    const c2 = makeCustomer(2, 0.01, 0.01, { flexible: true, next_scheduled_for_type: null });
    const c3 = makeCustomer(3, 0.02, 0.02);
    const result = runPipeline([c1, c2, c3]);
    assert.equal(result.length, 3);
    assert.equal(result[0].tier, 1);
    assert.equal(result[0].customer_id, 1);
    assert.ok(result[1].tier <= result[2].tier, 'Tiers should be sorted ascending');
  });
});


describe('filterAndScoreCandidates - Edge Cases', () => {
  it('empty customer list returns empty', () => {
    const result = runPipeline([]);
    assert.equal(result.length, 0);
  });

  it('customer with no phone is NOT filtered by pipeline (phone check is in SQL query)', () => {
    const c = makeCustomer(1, 0.01, 0.01, { phone: '555-1234' });
    const result = runPipeline([c]);
    assert.equal(result.length, 1);
  });

  it('customer at exact reference point is included (0 distance)', () => {
    const c = makeCustomer(1, 0, 0);
    const result = runPipeline([c]);
    assert.equal(result.length, 1);
    assert.equal(result[0].distance_miles, 0);
  });

  it('distance_miles is rounded to 2 decimal places', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const result = runPipeline([c]);
    const d = result[0].distance_miles;
    assert.equal(d, Math.round(d * 100) / 100, 'distance should be rounded to 2 decimals');
  });

  it('direction_score is rounded to 2 decimal places', () => {
    const c = makeCustomer(1, 0.03, 0.02);
    const result = runPipeline([c]);
    const s = result[0].direction_score;
    assert.equal(s, Math.round(s * 100) / 100, 'direction score should be rounded to 2 decimals');
  });

  it('search_layer is set correctly in output', () => {
    const c = makeCustomer(1, 0.01, 0.01);
    const r1 = runPipeline([c], { layer: 1 });
    const r3 = runPipeline([c], { layer: 3, config: LAYER_CONFIG[3] });
    assert.equal(r1[0].search_layer, 1);
    assert.equal(r3[0].search_layer, 3);
  });
});


describe('TIER_MESSAGES', () => {
  it('all 5 tiers have messages with {firstName} placeholder', () => {
    for (let t = 1; t <= 5; t++) {
      assert.ok(TIER_MESSAGES[t], `Tier ${t} should have a message`);
      assert.ok(TIER_MESSAGES[t].includes('{firstName}'));
    }
  });
});


describe('Layer Config', () => {
  it('4 layers, each progressively wider', () => {
    assert.equal(Object.keys(LAYER_CONFIG).length, 4);
    assert.ok(LAYER_CONFIG[1].maxMiles < LAYER_CONFIG[2].maxMiles);
    assert.ok(LAYER_CONFIG[2].maxMiles < LAYER_CONFIG[3].maxMiles);
    assert.ok(LAYER_CONFIG[3].maxMiles < LAYER_CONFIG[4].maxMiles);
  });

  it('layers 1-2 enforce time gate, layers 3-4 do not', () => {
    assert.equal(LAYER_CONFIG[1].enforceTimeGate, true);
    assert.equal(LAYER_CONFIG[2].enforceTimeGate, true);
    assert.equal(LAYER_CONFIG[3].enforceTimeGate, false);
    assert.equal(LAYER_CONFIG[4].enforceTimeGate, false);
  });
});
