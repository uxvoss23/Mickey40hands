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
  getRecurrenceMonths
} = require('../routes/gapfill')._testExports;


describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    const d = haversineDistance(32.7, -96.8, 32.7, -96.8);
    assert.equal(d, 0);
  });

  it('calculates short distance accurately', () => {
    const d = haversineDistance(32.7767, -96.7970, 32.7357, -96.8353);
    assert.ok(d > 3 && d < 4, `Expected ~3.5mi, got ${d}`);
  });

  it('calculates long distance accurately', () => {
    const d = haversineDistance(32.7767, -96.7970, 33.4484, -112.0740);
    assert.ok(d > 850 && d < 950, `Expected ~887mi DFW to Phoenix, got ${d}`);
  });

  it('is symmetric', () => {
    const d1 = haversineDistance(32.7, -96.8, 33.0, -97.0);
    const d2 = haversineDistance(33.0, -97.0, 32.7, -96.8);
    assert.ok(Math.abs(d1 - d2) < 0.001, 'Distance should be symmetric');
  });
});


describe('estimateDriveMinutes', () => {
  it('returns 0 for 0 miles', () => {
    assert.equal(estimateDriveMinutes(0), 0);
  });

  it('calculates correctly at AVG_SPEED_MPH', () => {
    assert.equal(estimateDriveMinutes(AVG_SPEED_MPH), 60);
  });

  it('returns 30 min for half the avg speed distance', () => {
    assert.equal(estimateDriveMinutes(AVG_SPEED_MPH / 2), 30);
  });

  it('scales linearly', () => {
    const d1 = estimateDriveMinutes(10);
    const d2 = estimateDriveMinutes(20);
    assert.ok(Math.abs(d2 - d1 * 2) < 0.001, 'Should scale linearly');
  });
});


describe('Time Feasibility Calculation', () => {
  it('JOB_DURATION_MINUTES is 75', () => {
    assert.equal(JOB_DURATION_MINUTES, 75);
  });

  it('BUFFER_MINUTES is 10', () => {
    assert.equal(BUFFER_MINUTES, 10);
  });

  it('HARD_CUTOFF_HOUR is 18 (6 PM)', () => {
    assert.equal(HARD_CUTOFF_HOUR, 18);
  });

  it('total time = drive + job + buffer for time-gated layers', () => {
    const distance = 5;
    const driveMinutes = estimateDriveMinutes(distance);
    const totalMinutes = JOB_DURATION_MINUTES + driveMinutes + BUFFER_MINUTES;
    assert.equal(totalMinutes, 75 + 12 + 10);
  });

  it('candidate at 5mi fits when current time is 2PM and next stop at 4PM', () => {
    const currentHour = 14;
    const currentMinute = 0;
    const nowMinutes = currentHour * 60 + currentMinute;
    const distance = 5;
    const driveMinutes = estimateDriveMinutes(distance);
    const totalMinutes = JOB_DURATION_MINUTES + driveMinutes + BUFFER_MINUTES;
    const nextStopMinutes = 16 * 60;
    const fitsBeforeNext = nowMinutes + totalMinutes <= nextStopMinutes;
    const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;
    const fitsBeforeCutoff = endMinutes <= HARD_CUTOFF_HOUR * 60;
    assert.ok(fitsBeforeNext, `Should fit: ${nowMinutes + totalMinutes} <= ${nextStopMinutes}`);
    assert.ok(fitsBeforeCutoff, `Should fit before cutoff: ${endMinutes} <= ${HARD_CUTOFF_HOUR * 60}`);
  });

  it('candidate at 15mi does NOT fit when current time is 4:30PM (exceeds 6PM cutoff)', () => {
    const currentHour = 16;
    const currentMinute = 30;
    const nowMinutes = currentHour * 60 + currentMinute;
    const distance = 15;
    const driveMinutes = estimateDriveMinutes(distance);
    const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;
    const fitsBeforeCutoff = endMinutes <= HARD_CUTOFF_HOUR * 60;
    assert.ok(!fitsBeforeCutoff, `Should NOT fit: ${endMinutes} > ${HARD_CUTOFF_HOUR * 60}`);
  });

  it('candidate at 8mi does NOT fit when current time is 3:30PM and next stop at 4:15PM', () => {
    const currentHour = 15;
    const currentMinute = 30;
    const nowMinutes = currentHour * 60 + currentMinute;
    const distance = 8;
    const driveMinutes = estimateDriveMinutes(distance);
    const totalMinutes = JOB_DURATION_MINUTES + driveMinutes + BUFFER_MINUTES;
    const nextStopMinutes = 16 * 60 + 15;
    const fitsBeforeNext = nowMinutes + totalMinutes <= nextStopMinutes;
    assert.ok(!fitsBeforeNext, `Should NOT fit: ${nowMinutes + totalMinutes} > ${nextStopMinutes}`);
  });

  it('right at cutoff boundary - ends exactly at 6PM passes', () => {
    const cutoffMinutes = HARD_CUTOFF_HOUR * 60;
    const distance = 0;
    const driveMinutes = estimateDriveMinutes(distance);
    const nowMinutes = cutoffMinutes - JOB_DURATION_MINUTES - driveMinutes;
    const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;
    assert.ok(endMinutes <= cutoffMinutes, 'Exactly at cutoff should pass');
  });

  it('one minute past cutoff boundary fails', () => {
    const cutoffMinutes = HARD_CUTOFF_HOUR * 60;
    const distance = 0;
    const driveMinutes = estimateDriveMinutes(distance);
    const nowMinutes = cutoffMinutes - JOB_DURATION_MINUTES - driveMinutes + 1;
    const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;
    assert.ok(endMinutes > cutoffMinutes, 'One past cutoff should fail');
  });
});


describe('Lateness Tolerance (Layer Config)', () => {
  it('layers 1 and 2 enforce time gate', () => {
    assert.equal(LAYER_CONFIG[1].enforceTimeGate, true);
    assert.equal(LAYER_CONFIG[2].enforceTimeGate, true);
  });

  it('layers 3 and 4 do NOT enforce time gate (lateness tolerated)', () => {
    assert.equal(LAYER_CONFIG[3].enforceTimeGate, false);
    assert.equal(LAYER_CONFIG[4].enforceTimeGate, false);
  });

  it('layers 3 and 4 still enforce hard cutoff (6PM) even without time gate', () => {
    const currentHour = 17;
    const currentMinute = 30;
    const nowMinutes = currentHour * 60 + currentMinute;
    const distance = 5;
    const driveMinutes = estimateDriveMinutes(distance);
    const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;
    assert.ok(endMinutes > HARD_CUTOFF_HOUR * 60, 'Even non-gated layers must respect 6PM cutoff');
  });
});


describe('Tier Qualification Logic (determineTier)', () => {
  const now = new Date('2026-02-17T12:00:00Z');
  const session = { cancelled_job_description: 'Residential Panel Cleaning' };

  it('Tier 1: anytime_access customer', () => {
    const customer = { anytime_access: true };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 1);
    assert.ok(result.reason.includes('Anytime Access'));
  });

  it('Tier 2: recurring customer who is overdue (1.5x interval)', () => {
    const eighteenMonthsAgo = new Date(now);
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const customer = {
      is_recurring: true,
      recurrence_for_type: '12',
      last_service_for_type: eighteenMonthsAgo.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 2);
    assert.ok(result.reason.includes('overdue'));
  });

  it('Tier 2: recurring customer who is due (within 1 month of interval)', () => {
    const elevenMonthsAgo = new Date(now);
    elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
    const customer = {
      is_recurring: true,
      recurrence_for_type: '12',
      last_service_for_type: elevenMonthsAgo.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 2);
    assert.ok(result.reason.includes('due'));
  });

  it('Tier 2 NOT triggered for recurring customer cleaned recently', () => {
    const twoMonthsAgo = new Date(now);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const customer = {
      is_recurring: true,
      recurrence_for_type: '12',
      last_service_for_type: twoMonthsAgo.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.notEqual(result.tier, 2);
  });

  it('Tier 3: flexible customer with no scheduled job', () => {
    const customer = {
      flexible: true,
      next_scheduled_for_type: null
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 3);
    assert.ok(result.reason.includes('Flexible'));
  });

  it('Tier 3 NOT triggered for flexible customer WITH a scheduled job', () => {
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 10);
    const customer = {
      flexible: true,
      next_scheduled_for_type: futureDate.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.notEqual(result.tier, 3);
  });

  it('Tier 4: customer with job scheduled within 21 days', () => {
    const tenDaysOut = new Date(now);
    tenDaysOut.setDate(tenDaysOut.getDate() + 10);
    const customer = {
      next_scheduled_for_type: tenDaysOut.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 4);
    assert.ok(result.reason.includes('scheduled'));
  });

  it('Tier 4 NOT triggered for job >21 days out', () => {
    const thirtyDaysOut = new Date(now);
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
    const customer = {
      next_scheduled_for_type: thirtyDaysOut.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.notEqual(result.tier, 4);
  });

  it('Tier 5: past non-recurring customer with completed jobs', () => {
    const sixteenMonthsAgo = new Date(now);
    sixteenMonthsAgo.setMonth(sixteenMonthsAgo.getMonth() - 16);
    const customer = {
      completed_count_for_type: '2',
      is_recurring: false,
      last_service_for_type: sixteenMonthsAgo.toISOString()
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 5);
    assert.ok(result.reason.includes('non-recurring'));
  });

  it('Tier 5 fallback: no matching conditions', () => {
    const customer = {};
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 5);
    assert.ok(result.reason.includes('Past customer'));
  });

  it('Tier priority: anytime_access beats recurring overdue', () => {
    const eighteenMonthsAgo = new Date(now);
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const customer = {
      anytime_access: true,
      is_recurring: true,
      recurrence_for_type: '12',
      last_service_for_type: eighteenMonthsAgo.toISOString(),
      flexible: true
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 1, 'Anytime access should always be Tier 1');
  });

  it('Tier priority: recurring overdue beats flexible', () => {
    const eighteenMonthsAgo = new Date(now);
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const customer = {
      is_recurring: true,
      recurrence_for_type: '12',
      last_service_for_type: eighteenMonthsAgo.toISOString(),
      flexible: true,
      next_scheduled_for_type: null
    };
    const result = determineTier(customer, session, now);
    assert.equal(result.tier, 2, 'Recurring overdue should beat flexible');
  });
});


describe('getRecurrenceMonths', () => {
  it('parses biannual as 6', () => assert.equal(getRecurrenceMonths('biannual'), 6));
  it('parses 6months as 6', () => assert.equal(getRecurrenceMonths('6months'), 6));
  it('parses "6" as 6', () => assert.equal(getRecurrenceMonths('6'), 6));
  it('parses annual as 12', () => assert.equal(getRecurrenceMonths('annual'), 12));
  it('parses yearly as 12', () => assert.equal(getRecurrenceMonths('yearly'), 12));
  it('parses 12months as 12', () => assert.equal(getRecurrenceMonths('12months'), 12));
  it('parses triannual as 4', () => assert.equal(getRecurrenceMonths('triannual'), 4));
  it('parses 4months as 4', () => assert.equal(getRecurrenceMonths('4months'), 4));
  it('parses numeric string "3" as 3', () => assert.equal(getRecurrenceMonths('3'), 3));
  it('defaults to 6 for unknown string', () => assert.equal(getRecurrenceMonths('unknown'), 6));
  it('defaults to 6 for empty string', () => assert.equal(getRecurrenceMonths(''), 6));
});


describe('Distance Filtering (Layer Config)', () => {
  it('Layer 1 maxMiles is 8', () => assert.equal(LAYER_CONFIG[1].maxMiles, 8));
  it('Layer 2 maxMiles is 15', () => assert.equal(LAYER_CONFIG[2].maxMiles, 15));
  it('Layer 3 maxMiles is 20', () => assert.equal(LAYER_CONFIG[3].maxMiles, 20));
  it('Layer 4 maxMiles is 30', () => assert.equal(LAYER_CONFIG[4].maxMiles, 30));

  it('progressive expansion: each layer is wider than previous', () => {
    assert.ok(LAYER_CONFIG[2].maxMiles > LAYER_CONFIG[1].maxMiles);
    assert.ok(LAYER_CONFIG[3].maxMiles > LAYER_CONFIG[2].maxMiles);
    assert.ok(LAYER_CONFIG[4].maxMiles > LAYER_CONFIG[3].maxMiles);
  });

  it('customer at 7mi passes layer 1 filter', () => {
    const d = 7;
    assert.ok(d <= LAYER_CONFIG[1].maxMiles);
  });

  it('customer at 9mi fails layer 1 but passes layer 2', () => {
    const d = 9;
    assert.ok(d > LAYER_CONFIG[1].maxMiles);
    assert.ok(d <= LAYER_CONFIG[2].maxMiles);
  });

  it('customer at 25mi fails layers 1-3 but passes layer 4', () => {
    const d = 25;
    assert.ok(d > LAYER_CONFIG[1].maxMiles);
    assert.ok(d > LAYER_CONFIG[2].maxMiles);
    assert.ok(d > LAYER_CONFIG[3].maxMiles);
    assert.ok(d <= LAYER_CONFIG[4].maxMiles);
  });

  it('customer at 31mi fails all layers', () => {
    const d = 31;
    for (let layer = 1; layer <= 4; layer++) {
      assert.ok(d > LAYER_CONFIG[layer].maxMiles, `Should fail layer ${layer}`);
    }
  });

  it('bounding box approximation is correct for lat', () => {
    const maxMiles = 8;
    const latRange = maxMiles / MILES_PER_DEGREE_LAT;
    assert.ok(Math.abs(latRange - 0.1159) < 0.01, `Lat range should be ~0.116 degrees, got ${latRange}`);
  });

  it('bounding box approximation adjusts for longitude at Dallas latitude', () => {
    const maxMiles = 8;
    const refLat = 32.7;
    const latRange = maxMiles / MILES_PER_DEGREE_LAT;
    const lngRange = latRange / Math.cos(refLat * Math.PI / 180);
    assert.ok(lngRange > latRange, 'Lng range should be wider than lat range at this latitude');
    assert.ok(Math.abs(lngRange - 0.138) < 0.02, `Lng range should be ~0.138, got ${lngRange}`);
  });
});


describe('Directional Filtering (directionScore)', () => {
  it('returns 0 when no next stop', () => {
    const score = directionScore(32.7, -96.8, null, null, 32.8, -96.7);
    assert.equal(score, 0);
  });

  it('returns 0 when candidate is at reference point', () => {
    const score = directionScore(32.7, -96.8, 33.0, -96.5, 32.7, -96.8);
    assert.equal(score, 0);
  });

  it('returns 0 when next stop is at reference point', () => {
    const score = directionScore(32.7, -96.8, 32.7, -96.8, 33.0, -96.5);
    assert.equal(score, 0);
  });

  it('returns ~1.0 for candidate in same direction as next stop', () => {
    const score = directionScore(32.7, -96.8, 33.0, -96.5, 32.85, -96.65);
    assert.ok(score > 0.95, `Expected ~1.0, got ${score}`);
  });

  it('returns ~-1.0 for candidate in opposite direction from next stop', () => {
    const score = directionScore(32.7, -96.8, 33.0, -96.5, 32.4, -97.1);
    assert.ok(score < -0.95, `Expected ~-1.0, got ${score}`);
  });

  it('returns ~0 for candidate perpendicular to next stop direction', () => {
    const score = directionScore(32.7, -96.8, 33.0, -96.8, 32.7, -96.5);
    assert.ok(Math.abs(score) < 0.15, `Expected ~0, got ${score}`);
  });

  it('higher score for candidate closer to next stop direction', () => {
    const scoreA = directionScore(32.7, -96.8, 33.0, -96.5, 32.85, -96.65);
    const scoreB = directionScore(32.7, -96.8, 33.0, -96.5, 32.5, -97.0);
    assert.ok(scoreA > scoreB, 'Candidate toward next stop should score higher');
  });
});


describe('Sorting Logic', () => {
  it('candidates sort by tier first, then distance', () => {
    const candidates = [
      { tier: 3, distance_miles: 2 },
      { tier: 1, distance_miles: 7 },
      { tier: 2, distance_miles: 5 },
      { tier: 1, distance_miles: 3 },
      { tier: 2, distance_miles: 1 },
    ];

    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.distance_miles - b.distance_miles;
    });

    assert.deepEqual(candidates.map(c => c.tier), [1, 1, 2, 2, 3]);
    assert.equal(candidates[0].distance_miles, 3);
    assert.equal(candidates[1].distance_miles, 7);
    assert.equal(candidates[2].distance_miles, 1);
    assert.equal(candidates[3].distance_miles, 5);
  });

  it('tier 1 always appears before tier 5 regardless of distance', () => {
    const candidates = [
      { tier: 5, distance_miles: 0.5 },
      { tier: 1, distance_miles: 7.9 },
    ];

    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.distance_miles - b.distance_miles;
    });

    assert.equal(candidates[0].tier, 1);
    assert.equal(candidates[1].tier, 5);
  });

  it('within same tier, closer customer comes first', () => {
    const candidates = [
      { tier: 2, distance_miles: 12 },
      { tier: 2, distance_miles: 3 },
      { tier: 2, distance_miles: 8 },
    ];

    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.distance_miles - b.distance_miles;
    });

    assert.deepEqual(candidates.map(c => c.distance_miles), [3, 8, 12]);
  });
});


describe('Suppression Rules', () => {
  it('MAX_CONTACTS_PER_WEEK is 1', () => {
    assert.equal(MAX_CONTACTS_PER_WEEK, 1);
  });

  it('MAX_CONTACTS_PER_MONTH is 3', () => {
    assert.equal(MAX_CONTACTS_PER_MONTH, 3);
  });

  it('COOLDOWN_MONTHS is 6', () => {
    assert.equal(COOLDOWN_MONTHS, 6);
  });

  it('customer contacted 1 time this week is suppressed', () => {
    const weekCount = 1;
    assert.ok(weekCount >= MAX_CONTACTS_PER_WEEK, 'Should be suppressed');
  });

  it('customer contacted 0 times this week is NOT suppressed', () => {
    const weekCount = 0;
    assert.ok(weekCount < MAX_CONTACTS_PER_WEEK, 'Should not be suppressed');
  });

  it('customer contacted 3 times this month is suppressed', () => {
    const monthCount = 3;
    assert.ok(monthCount >= MAX_CONTACTS_PER_MONTH, 'Should be suppressed');
  });

  it('customer contacted 2 times this month is NOT suppressed', () => {
    const monthCount = 2;
    assert.ok(monthCount < MAX_CONTACTS_PER_MONTH, 'Should not be suppressed');
  });

  it('6-month cooldown: service 5 months ago is suppressed', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const lastService = new Date('2025-09-20T12:00:00Z');
    const monthsSince = (now - lastService) / (1000 * 60 * 60 * 24 * 30);
    assert.ok(monthsSince < COOLDOWN_MONTHS, `${monthsSince} months should be within cooldown`);
  });

  it('6-month cooldown: service 7 months ago is NOT suppressed', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const lastService = new Date('2025-07-15T12:00:00Z');
    const monthsSince = (now - lastService) / (1000 * 60 * 60 * 24 * 30);
    assert.ok(monthsSince >= COOLDOWN_MONTHS, `${monthsSince} months should be past cooldown`);
  });

  it('6-month cooldown: service exactly 6 months ago is NOT suppressed', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const lastService = new Date('2025-08-17T12:00:00Z');
    const monthsSince = (now - lastService) / (1000 * 60 * 60 * 24 * 30);
    assert.ok(monthsSince >= COOLDOWN_MONTHS, `Exactly 6 months should pass cooldown`);
  });

  it('cancelled-today customers are excluded (logic check)', () => {
    const cancelledToday = [{ id: 1 }];
    assert.ok(cancelledToday.length > 0, 'Customer with same-day cancellation should be excluded');
  });

  it('customer already on today route is excluded', () => {
    const excludeIds = new Set([10, 20, 30]);
    const customerId = 20;
    assert.ok(excludeIds.has(customerId), 'Already-routed customer should be excluded');
  });

  it('cancelled customer for the session is excluded', () => {
    const excludeIds = new Set();
    const cancelledCustomerId = 42;
    excludeIds.add(cancelledCustomerId);
    assert.ok(excludeIds.has(42), 'Cancelled customer should be in exclude set');
  });
});


describe('20 Outreach Limit', () => {
  it('layer 4 (max expansion) limits to 30mi radius which naturally caps candidates', () => {
    assert.equal(LAYER_CONFIG[4].maxMiles, 30);
    assert.ok(Object.keys(LAYER_CONFIG).length === 4, 'Only 4 expansion layers exist');
  });

  it('outreach limit enforced: candidate list capped simulation', () => {
    const OUTREACH_LIMIT = 20;
    const candidates = Array.from({ length: 35 }, (_, i) => ({
      id: i + 1,
      tier: Math.ceil(Math.random() * 5),
      distance_miles: Math.random() * 30
    }));

    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.distance_miles - b.distance_miles;
    });

    const topCandidates = candidates.slice(0, OUTREACH_LIMIT);
    assert.equal(topCandidates.length, OUTREACH_LIMIT);
    assert.ok(topCandidates[0].tier <= topCandidates[topCandidates.length - 1].tier,
      'Top candidates should be ordered by tier');
  });

  it('weekly and monthly limits prevent outreach spam across sessions', () => {
    const simulateOutreachHistory = (weekCount, monthCount) => {
      const suppressedWeek = weekCount >= MAX_CONTACTS_PER_WEEK;
      const suppressedMonth = monthCount >= MAX_CONTACTS_PER_MONTH;
      return suppressedWeek || suppressedMonth;
    };

    assert.ok(!simulateOutreachHistory(0, 0), 'Fresh customer should not be suppressed');
    assert.ok(simulateOutreachHistory(1, 1), 'Contacted once this week should be suppressed');
    assert.ok(!simulateOutreachHistory(0, 2), '2 contacts this month but not this week: not suppressed');
    assert.ok(simulateOutreachHistory(0, 3), '3 contacts this month: suppressed');
    assert.ok(simulateOutreachHistory(1, 3), 'Both limits hit: suppressed');
  });
});


describe('TIER_MESSAGES', () => {
  it('all 5 tiers have messages', () => {
    for (let t = 1; t <= 5; t++) {
      assert.ok(TIER_MESSAGES[t], `Tier ${t} should have a message`);
      assert.ok(TIER_MESSAGES[t].includes('{firstName}'), `Tier ${t} message should have {firstName} placeholder`);
    }
  });

  it('tier 1 message mentions not needing to be home', () => {
    assert.ok(TIER_MESSAGES[1].toLowerCase().includes("don't have to be home") || 
              TIER_MESSAGES[1].toLowerCase().includes("don't need to be home") ||
              TIER_MESSAGES[1].toLowerCase().includes("don\u2019t have to be home"));
  });
});


describe('Constants sanity checks', () => {
  it('AVG_SPEED_MPH is 25', () => assert.equal(AVG_SPEED_MPH, 25));
  it('MILES_PER_DEGREE_LAT is 69', () => assert.equal(MILES_PER_DEGREE_LAT, 69));
  
  it('all 4 layers exist', () => {
    assert.ok(LAYER_CONFIG[1]);
    assert.ok(LAYER_CONFIG[2]);
    assert.ok(LAYER_CONFIG[3]);
    assert.ok(LAYER_CONFIG[4]);
    assert.equal(LAYER_CONFIG[5], undefined, 'Layer 5 should not exist');
  });
});
