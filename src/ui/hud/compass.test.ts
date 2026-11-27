import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bearingOf, cardinalLabel, headingDegrees, relativeBearing, selectFocusedMarker } from './compass';
import type { MapMarker } from './worldlayer';

function wp(x: number, y: number, z: number, labelText: string, alwaysWorld = false, live = true): MapMarker {
  return {
    pos: new THREE.Vector3(x, y, z),
    color: '#39e0ff',
    live,
    target: null,
    labelText,
    alwaysWorld,
    pulse: 0,
  };
}

describe('compass bearing math', () => {
  it('maps world XZ directions to clockwise compass bearings (North = -Z)', () => {
    expect(headingDegrees(bearingOf(0, -1))).toBe(0);
    expect(headingDegrees(bearingOf(1, 0))).toBe(90);
    expect(headingDegrees(bearingOf(0, 1))).toBe(180);
    expect(headingDegrees(bearingOf(-1, 0))).toBe(270);
    expect(headingDegrees(bearingOf(1, -1))).toBe(45);
  });

  it('computes signed shortest relative bearings across the 0/360 seam', () => {
    const north = 0;
    const nw = (-10 * Math.PI) / 180;
    const ne = (10 * Math.PI) / 180;
    expect(relativeBearing(ne, nw)).toBeCloseTo((20 * Math.PI) / 180, 6);
    expect(relativeBearing(nw, ne)).toBeCloseTo((-20 * Math.PI) / 180, 6);
    expect(relativeBearing(north, Math.PI * 1.95)).toBeCloseTo(0.05 * Math.PI, 6);
  });

  it('names cardinals and intercardinals accurately', () => {
    expect(cardinalLabel(0)).toBe('N');
    expect(cardinalLabel(45)).toBe('NE');
    expect(cardinalLabel(90)).toBe('E');
    expect(cardinalLabel(180)).toBe('S');
    expect(cardinalLabel(270)).toBe('W');
    expect(cardinalLabel(315)).toBe('NW');
    expect(cardinalLabel(30)).toBe('');
  });
});

describe('selectFocusedMarker', () => {
  it('picks the closest waypoint to the player heading and ignores alwaysWorld prompts or dead markers', () => {
    const markers = [
      wp(0, 0, -40, '[E] BOARD', true),
      wp(0, 0, -50, 'DEAD OBJ', false, false),
      wp(8, 0, -100, 'CACHE ALPHA'),
      wp(-25, 0, -100, 'FLAK BATTERY'),
    ];
    const hit = selectFocusedMarker(markers, 0, 0, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.marker.labelText).toBe('CACHE ALPHA');
    expect(hit!.distance).toBeCloseTo(Math.hypot(8, 100), 4);
  });

  it('returns null when all waypoints are outside the center focus window', () => {
    const markers = [wp(100, 0, 0, 'EAST OBJ')];
    expect(selectFocusedMarker(markers, 0, 0, 0, 0)).toBeNull();
  });

  it('prefers the closer waypoint when two sit on nearly the same bearing', () => {
    const markers = [
      wp(0, 0, -240, 'FAR OBJ'),
      wp(0, 0, -65, 'NEAR OBJ'),
    ];
    const hit = selectFocusedMarker(markers, 0, 0, 0, 0);
    expect(hit?.marker.labelText).toBe('NEAR OBJ');
  });
});
