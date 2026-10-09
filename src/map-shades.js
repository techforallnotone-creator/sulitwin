const ATLAS = {
  background: '#f1ebe1',
  water: '#8fb4c4',
  waterway: '#7fa9bd',
  park: '#c2d4a8',
  parkOutline: '#a9bf8e',
  wood: '#a3bb8c',
  grass: '#c8d4ab',
  sand: '#e7d9ae',
  ice: '#e8eef2',
  wetland: '#b9c9b0',
  residential: '#e9dfd0',
  pitch: '#cfd8b4',
  cemetery: '#c4cfae',
  hospital: '#e6d9cf',
  school: '#e2d8c8',
  track: '#ddd2c0',
  pedestrian: '#e9e0d0',
  aeroway: '#ddd2c2',
  roads: {
    motorway: '#dd9c60',
    primary: '#e4b183',
    secondary: '#f0e8da',
    minor: '#f5efe4',
    path: '#d9cfc0',
    casing: '#cfc2ae',
    tunnelOpacity: 0.55
  },
  rail: '#9a8f80',
  buildingFlat: '#d3c9b8',
  buildingOutline: '#b8ac97',
  buildingLadder: ['#ddd3c2', '#cdc2ae', '#b4a891', '#948872', '#736853'],
  buildingOpacity: 0.92,
  text: '#5a5142',
  halo: 'rgba(251,247,238,0.92)',
  boundary: '#a89c8a',
  light: { color: '#fff4e2', intensity: 0.35 },
  hillshade: { shadow: '#6b5e4a', highlight: '#fff8ec', accent: '#8a7a5e', exaggeration: 0.32 }
};

const HILLSHADE_SOURCE_ID = 'atlas-hillshade-dem';
const HILLSHADE_LAYER_ID = 'atlas-hillshade';

function roadColorFor(layerId) {
  if (layerId.includes('motorway')) return 'motorway';
  if (layerId.includes('trunk_primary') || layerId.includes('trunk-primary') || layerId.includes('trunk') || layerId.includes('primary')) return 'primary';
  if (layerId.includes('secondary_tertiary') || layerId.includes('secondary-tertiary')) return 'secondary';
  if (layerId.includes('minor') || layerId.includes('service') || layerId.includes('link')) return 'minor';
  if (layerId.includes('path')) return 'path';
  return null;
}

function buildingColorExpression(ladder) {
  return [
    'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
    0, ladder[0], 30, ladder[1], 70, ladder[2], 140, ladder[3], 300, ladder[4]
  ];
}

export function createMapShadesController({ map, dbg }) {
  function ensureHillshade() {
    if (!map.getSource(HILLSHADE_SOURCE_ID)) {
      map.addSource(HILLSHADE_SOURCE_ID, {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Elevation © AWS Terrain Tiles'
      });
    }
    if (!map.getLayer(HILLSHADE_LAYER_ID)) {
      const layers = map.getStyle().layers || [];
      const before = layers.find(layer =>
        layer.id.startsWith('waterway') || layer.id === 'water' || layer.id === 'water-intermittent'
      )?.id;
      map.addLayer({
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: HILLSHADE_SOURCE_ID,
        paint: {
          'hillshade-exaggeration': ATLAS.hillshade.exaggeration,
          'hillshade-shadow-color': ATLAS.hillshade.shadow,
          'hillshade-highlight-color': ATLAS.hillshade.highlight,
          'hillshade-accent-color': ATLAS.hillshade.accent
        }
      }, before);
    }
  }

  function apply() {
    const layers = map.getStyle()?.layers || [];
    if (!layers.length) {
      map.once('load', apply);
      return;
    }
    for (const layer of layers) {
      const id = String(layer.id || '').toLowerCase();
      if (id === 'background') {
        map.setPaintProperty(layer.id, 'background-color', ATLAS.background);
      } else if (id === 'water' || id.startsWith('water-intermittent')) {
        map.setPaintProperty(layer.id, 'fill-color', ATLAS.water);
      } else if (id.startsWith('waterway') && layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', ATLAS.waterway);
      } else if (id === 'park' || id.startsWith('landcover-grass-park')) {
        map.setPaintProperty(layer.id, 'fill-color', ATLAS.park);
        map.setPaintProperty(layer.id, 'fill-outline-color', ATLAS.parkOutline);
        map.setPaintProperty(layer.id, 'fill-opacity', 0.75);
      } else if (id === 'park_outline' && layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', ATLAS.parkOutline);
      } else if (id.includes('landcover') && layer.type === 'fill') {
        const color = id.includes('wood') ? ATLAS.wood
          : id.includes('grass') ? ATLAS.grass
          : id.includes('sand') ? ATLAS.sand
          : id.includes('ice') || id.includes('glacier') ? ATLAS.ice
          : id.includes('wetland') ? ATLAS.wetland
          : null;
        if (color) map.setPaintProperty(layer.id, 'fill-color', color);
      } else if (id.startsWith('landuse-') && layer.type === 'fill') {
        const color = id.includes('residential') || id.includes('suburb') ? ATLAS.residential
          : id.includes('cemetery') ? ATLAS.cemetery
          : id.includes('hospital') ? ATLAS.hospital
          : id.includes('school') ? ATLAS.school
          : id.includes('pitch') ? ATLAS.pitch
          : id.includes('railway') || id.includes('industrial') ? ATLAS.track
          : id.includes('commercial') ? '#e9dfd0'
          : null;
        if (color) {
          map.setPaintProperty(layer.id, 'fill-color', color);
          if (id.includes('residential')) map.setPaintProperty(layer.id, 'fill-opacity', 0.75);
        }
      } else if (id.includes('road_area') && layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', ATLAS.pedestrian);
      } else if (id.startsWith('aeroway') && layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', ATLAS.aeroway);
      } else if ((id === 'building' || id === 'building-top') && layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', ATLAS.buildingFlat);
        map.setPaintProperty(layer.id, 'fill-outline-color', ATLAS.buildingOutline);
      } else if (id.includes('rail') && layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', ATLAS.rail);
      } else if (id.startsWith('aeroway') && layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', ATLAS.aeroway);
      } else if ((id.startsWith('tunnel-') || id.startsWith('highway-') || id.startsWith('bridge-')) && layer.type === 'line') {
        const roadClass = roadColorFor(id);
        if (!roadClass) continue;
        const casing = id.includes('casing');
        map.setPaintProperty(layer.id, 'line-color', casing ? ATLAS.roads.casing : ATLAS.roads[roadClass]);
        if (id.startsWith('tunnel-')) {
          map.setPaintProperty(layer.id, 'line-opacity', ATLAS.roads.tunnelOpacity);
        }
      } else if (id.startsWith('boundary') && layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', ATLAS.boundary);
      }

      if (layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', ATLAS.text);
        map.setPaintProperty(layer.id, 'text-halo-color', ATLAS.halo);
      }
    }

    const liveBuilding = map.getLayer('buildings-live');
    if (liveBuilding) {
      map.setPaintProperty('buildings-live', 'fill-extrusion-color', buildingColorExpression(ATLAS.buildingLadder));
      map.setPaintProperty('buildings-live', 'fill-extrusion-opacity', ATLAS.buildingOpacity);
    }

    map.setLight({ anchor: 'map', color: ATLAS.light.color, intensity: ATLAS.light.intensity });
    ensureHillshade();
    dbg('Natural Atlas tile shades and hillshade applied.');
  }

  return { apply };
}
