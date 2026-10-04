// The canvas is viewport-sized but lives in Leaflet's translated overlay pane.
// Its local drawing coordinates must therefore use the viewport's world origin,
// not the pixel origin of the (possibly panned) layer coordinate system.
export function canvasFrame(map) {
  const position = map.containerPointToLayerPoint([0, 0]);
  const pixelOrigin = map.getPixelOrigin();
  return {
    position,
    origin: { x: pixelOrigin.x + position.x, y: pixelOrigin.y + position.y },
  };
}
