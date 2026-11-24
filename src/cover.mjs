export const COVER_SIZE = 512;
export const MAX_COVER_ZOOM = 8;
export const DEFAULT_COVER_CROP = {x: .5, y: .5, zoom: 1};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeCoverCrop(value) {
  const axis = axis => Number.isFinite(value?.[axis]) ? clamp(value[axis], 0, 1) : .5;
  return {
    x: axis('x'),
    y: axis('y'),
    zoom: Number.isFinite(value?.zoom) && value.zoom > 0 ? Math.min(value.zoom, MAX_COVER_ZOOM) : 1,
  };
}

export function coverFitZoom(width, height) {
  return Math.min(width, height) / Math.max(width, height);
}

export function coverCropRect(width, height, crop) {
  const {x, y, zoom} = normalizeCoverCrop(crop);
  const side = Math.min(width, height) / Math.max(zoom, coverFitZoom(width, height));
  return {left: (width - side) * x, top: (height - side) * y, side};
}
