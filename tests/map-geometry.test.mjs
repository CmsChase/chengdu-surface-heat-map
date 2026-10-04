import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasFrame } from '../src/map-geometry.js';

// Leaflet retains its pixel origin during a pan and moves the containing pane.
// Exercise both pan directions, zoom-origin changes and resized viewports.
test('viewport canvas stays registered to geographic points after pan, zoom and resize', () => {
  for (const zoom of [8, 10, 12.25]) {
    const world = 256 * 2 ** zoom;
    for (const size of [[920, 650], [1440, 830], [390, 420]]) {
      const pixelOrigin = { x: Math.round(world * .79 - size[0] / 2), y: Math.round(world * .41 - size[1] / 2) };
      for (const pane of [{ x: 0, y: 0 }, { x: 180, y: -260 }, { x: -270, y: 315 }]) {
        const map = {
          getPixelOrigin: () => pixelOrigin,
          containerPointToLayerPoint: ([x, y]) => ({ x: x - pane.x, y: y - pane.y }),
        };
        const { position, origin } = canvasFrame(map);
        assert.equal(position.x + pane.x, 0);
        assert.equal(position.y + pane.y, 0);
        for (const expected of [{ x: 4, y: 4 }, { x: size[0] / 2, y: size[1] / 2 }, { x: size[0] - 4, y: size[1] - 4 }]) {
          const projected = { x: expected.x + pixelOrigin.x - pane.x, y: expected.y + pixelOrigin.y - pane.y };
          const canvasPoint = { x: projected.x - origin.x, y: projected.y - origin.y };
          assert(Math.abs(canvasPoint.x - expected.x) < 1e-8);
          assert(Math.abs(canvasPoint.y - expected.y) < 1e-8);
          // The same geographic point lands at the canvas point after its CSS
          // position and the enclosing map-pane translation have been applied.
          assert(Math.abs(canvasPoint.x + position.x + pane.x - expected.x) < 1e-8);
          assert(Math.abs(canvasPoint.y + position.y + pane.y - expected.y) < 1e-8);
        }
      }
    }
  }
});
