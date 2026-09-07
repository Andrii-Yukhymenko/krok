import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPlaces,
  placeKind,
  placeCandidates,
  inside,
} from '../lib/places.ts';
void test('private grounds are excluded and parks outrank ordinary pedestrian spaces', () => {
  assert.equal(placeKind({ leisure: 'park', access: 'private' }), null);
  assert.equal(placeKind({ highway: 'service' }), null);
  assert.ok(
    placeKind({ leisure: 'park' })!.priority >
      placeKind({ highway: 'pedestrian' })!.priority,
  );
});
void test('park destination uses a path vertex inside the park rather than lawn centre', () => {
  const places = extractPlaces(
    [
      {
        type: 'way',
        id: 1,
        tags: { leisure: 'park', name: 'Парк' },
        center: { lat: 50.001, lon: 30.001 },
        geometry: [
          { lat: 50, lon: 30 },
          { lat: 50.002, lon: 30 },
          { lat: 50.002, lon: 30.002 },
          { lat: 50, lon: 30.002 },
          { lat: 50, lon: 30 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'footway' },
        geometry: [
          { lat: 50.001, lon: 30.0005 },
          { lat: 50.0015, lon: 30.0005 },
        ],
      },
    ],
    [50, 30],
  );
  assert.deepEqual(places[0].point, [50.001, 30.0005]);
  assert.ok(
    inside(
      [50.001, 30.001],
      [
        [50, 30],
        [50.002, 30],
        [50.002, 30.002],
        [50, 30.002],
      ],
    ),
  );
});
void test('scenic candidates only contain real reachable places; no invented fallback', () => {
  const places = [
    {
      id: 'way/1',
      name: 'Парк',
      kind: 'Парк',
      point: [50.001, 30] as [number, number],
      priority: 3,
    },
    {
      id: 'way/2',
      name: 'Далекий парк',
      kind: 'Парк',
      point: [51, 31] as [number, number],
      priority: 3,
    },
  ];
  const candidates = placeCandidates([50, 30], 2000, places, 0);
  assert.deepEqual(
    candidates.map((c) => c.map((p) => p.id)),
    [['way/1']],
  );
  assert.deepEqual(placeCandidates([50, 30], 2000, [], 0), []);
});
