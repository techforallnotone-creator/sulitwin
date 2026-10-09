import { intersects, tileBounds } from './helpers.js';

const MAX_LATITUDE = 85.05112878;
const TILE_PRELOAD_CONCURRENCY = 2;

function tileX(longitude, zoom) {
  return Math.floor((longitude + 180) / 360 * 2 ** zoom);
}

function tileY(latitude, zoom) {
  const radians = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom);
}

function tilesForRegion(region, zoom) {
  const scale = 2 ** zoom;
  const firstX = Math.max(0, tileX(region[0], zoom));
  const lastX = Math.min(scale - 1, tileX(region[2], zoom));
  const firstY = Math.max(0, tileY(region[3], zoom));
  const lastY = Math.min(scale - 1, tileY(region[1], zoom));
  const tiles = [];
  for (let x = firstX; x <= lastX; x++) {
    for (let y = firstY; y <= lastY; y++) {
      if (intersects(tileBounds(zoom, x, y), region)) tiles.push({ x, y });
    }
  }
  return tiles;
}

async function tileTemplatesForSource(source) {
  if (Array.isArray(source.tiles)) {
    return { tiles: source.tiles, minzoom: source.minzoom ?? 0, maxzoom: source.maxzoom, scheme: source.scheme };
  }
  if (!source.url) return null;

  const response = await fetch(source.url, { cache: 'force-cache', priority: 'low' });
  if (!response.ok) throw new Error(`TileJSON request failed with HTTP ${response.status}`);
  const metadata = await response.json();
  if (!Array.isArray(metadata.tiles) || !metadata.tiles.length) {
    throw new Error('TileJSON response did not include tile templates');
  }
  return {
    tiles: metadata.tiles,
    minzoom: Math.max(source.minzoom ?? 0, metadata.minzoom ?? 0),
    maxzoom: Math.min(source.maxzoom ?? Infinity, metadata.maxzoom ?? Infinity),
    scheme: source.scheme ?? metadata.scheme
  };
}

function tileUrl(template, zoom, x, y, scheme) {
  const tileYCoordinate = scheme === 'tms' ? 2 ** zoom - 1 - y : y;
  return template
    .replaceAll('{z}', String(zoom))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(tileYCoordinate))
    .replaceAll('{ratio}', globalThis.devicePixelRatio >= 1.5 ? '@2x' : '');
}

export async function preloadRegionTiles({ map, region, dbg }) {
  const sourceSpecs = map.getStyle()?.sources || {};
  let tileCount = 0;
  let failureCount = 0;

  for (const [sourceId, source] of Object.entries(sourceSpecs)) {
    if (!['vector', 'raster', 'raster-dem'].includes(source.type)) continue;
    try {
      const tileSet = await tileTemplatesForSource(source);
      if (!tileSet) continue;
      const zoom = Math.floor(Math.min(map.getMaxZoom(), tileSet.maxzoom ?? map.getMaxZoom()));
      if (zoom < tileSet.minzoom) continue;
      const tiles = tilesForRegion(region, zoom);
      const urls = tiles.flatMap(({ x, y }) => tileSet.tiles.map(template =>
        tileUrl(template, zoom, x, y, tileSet.scheme)
      ));
      let nextUrl = 0;
      const workers = Array.from(
        { length: Math.min(TILE_PRELOAD_CONCURRENCY, urls.length) },
        async () => {
          while (nextUrl < urls.length) {
            const url = urls[nextUrl++];
            try {
              const response = await fetch(url, { cache: 'force-cache', priority: 'low' });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              await response.arrayBuffer();
              tileCount++;
            } catch (error) {
              failureCount++;
              dbg(`Tile preload failed for ${sourceId}: ${error.message}`);
            }
          }
        }
      );
      await Promise.all(workers);
    } catch (error) {
      failureCount++;
      dbg(`Tile preload unavailable for ${sourceId}: ${error.message}`);
    }
  }

  dbg(`Regional tile preload complete: ${tileCount} tile(s) cached, ${failureCount} failure(s).`);
  return { tileCount, failureCount };
}
