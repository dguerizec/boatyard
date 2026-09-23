import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HUGESCREEN_ZONES, normalizeHugescreenZones, parseHugescreenZones,
  effectiveHugescreenZones } from "../src/renderer/hugescreenZones.js";
import { HugescreenEdge } from "../src/main/hugescreenEdge.js";

const area = { x: -1000, y: 40, width: 1000, height: 800 };
const bounds = { ...area, width: 2000, height: 1600 };

test("wider independent edge zones trigger before reaching a desktop bar", () => {
  const zones = { top: 30, right: 60, bottom: 80, left: 10 };
  const cases = [
    { cursor: { x: -500, y: 65 }, bounds: { ...bounds, y: -360 }, target: { x: -1000, y: 40 } },
    { cursor: { x: -50, y: 440 }, bounds, target: { x: -1500, y: 40 } },
    { cursor: { x: -500, y: 775 }, bounds, target: { x: -1000, y: -360 } },
    { cursor: { x: -995, y: 440 }, bounds: { ...bounds, x: -1500 }, target: { x: -1000, y: 40 } }
  ];
  for (const scenario of cases) {
    const edge = new HugescreenEdge();
    edge.sample({ x: -500, y: 440 }, scenario.bounds, area, 0, undefined, zones);
    assert.equal(edge.sample(scenario.cursor, scenario.bounds, area, 1, undefined, zones), null);
    assert.deepEqual(edge.sample(scenario.cursor, scenario.bounds, area, 181, undefined, zones), scenario.target);
  }
});

test("outside the configured zone stays still and entering a bar cancels the dwell", () => {
  const edge = new HugescreenEdge();
  const zones = { ...DEFAULT_HUGESCREEN_ZONES, bottom: 80 };
  edge.sample({ x: -500, y: 759 }, bounds, area, 0, undefined, zones);
  assert.equal(edge.sample({ x: -500, y: 759 }, bounds, area, 1000, undefined, zones), null);
  edge.sample({ x: -500, y: 760 }, bounds, area, 1001, undefined, zones);
  edge.sample({ x: -500, y: 840 }, bounds, area, 1100, undefined, zones);
  assert.equal(edge.sample({ x: -500, y: 760 }, bounds, area, 1500, undefined, zones), null);
});

test("zone validation rejects malformed IPC values and normalizes persisted data", () => {
  assert.deepEqual(normalizeHugescreenZones(undefined), DEFAULT_HUGESCREEN_ZONES);
  assert.deepEqual(normalizeHugescreenZones({ top: 500, right: -1, bottom: NaN, left: 24.6 }),
    { top: 200, right: 1, bottom: 3, left: 25 });
  for (const value of [null, {}, { ...DEFAULT_HUGESCREEN_ZONES, top: '30' },
    { ...DEFAULT_HUGESCREEN_ZONES, top: 201 }, { ...DEFAULT_HUGESCREEN_ZONES, top: 0 },
    { ...DEFAULT_HUGESCREEN_ZONES, top: 1.5 }]) assert.throws(() => parseHugescreenZones(value), /Each edge zone/);
  assert.deepEqual(parseHugescreenZones(DEFAULT_HUGESCREEN_ZONES), DEFAULT_HUGESCREEN_ZONES);
});

test("large zones keep a neutral interior on small displays", () => {
  assert.deepEqual(effectiveHugescreenZones({ top: 200, right: 200, bottom: 200, left: 200 }, 400, 300),
    { top: 75, right: 100, bottom: 75, left: 100 });
});
