const METERS_PER_DEGREE = 111320;
const FLAG_POLE_HEIGHT_M = 5.4;
const FLAG_WIDTH_M = 1.9;
const FLAG_HEIGHT_M = 1.14;
const FLAG_DEPTH_M = 0.045;
const FLAGPOLE_WEST_OFFSET_M = 2;

function groundPolygon(longitude, latitude, eastStart, eastEnd, halfDepth, metersLongitude) {
  const metersLatitude = METERS_PER_DEGREE;
  const point = (east, north) => [
    longitude + east / metersLongitude,
    latitude + north / metersLatitude
  ];
  return [[
    point(eastStart, -halfDepth),
    point(eastEnd, -halfDepth),
    point(eastEnd, halfDepth),
    point(eastStart, halfDepth),
    point(eastStart, -halfDepth)
  ]];
}

function circlePolygon(longitude, latitude, radius, metersLongitude, sides = 10) {
  const ring = [];
  for (let i = 0; i <= sides; i++) {
    const angle = i / sides * Math.PI * 2;
    ring.push([
      longitude + Math.cos(angle) * radius / metersLongitude,
      latitude + Math.sin(angle) * radius / METERS_PER_DEGREE
    ]);
  }
  return [ring];
}

function feature(kind, color, coordinates, height, base = 0) {
  return {
    type: 'Feature',
    properties: { kind, color, height, base },
    geometry: { type: 'Polygon', coordinates }
  };
}

export function createFlagpoleController({ map, coordinates, dbg = () => {} }) {
  let added = false;

  function add() {
    if (added) return;
    if (map.getSource('kurdistan-flagpole-src')) {
      added = true;
      return;
    }

    const [longitude, latitude] = coordinates;
    const metersLongitude = METERS_PER_DEGREE * Math.cos(latitude * Math.PI / 180);
    const poleLongitude = longitude - FLAGPOLE_WEST_OFFSET_M / metersLongitude;
    const flagBottom = FLAG_POLE_HEIGHT_M - FLAG_HEIGHT_M;
    const bandHeight = FLAG_HEIGHT_M / 3;
    const flagStart = 0.07;
    const features = [
      feature(
        'base',
        '#475569',
        circlePolygon(poleLongitude, latitude, 0.22, metersLongitude),
        0.18
      ),
      feature(
        'pole',
        '#cbd5e1',
        circlePolygon(poleLongitude, latitude, 0.075, metersLongitude),
        FLAG_POLE_HEIGHT_M - 0.08,
        0.16
      ),
      feature(
        'finial',
        '#f5d442',
        circlePolygon(poleLongitude, latitude, 0.12, metersLongitude, 8),
        FLAG_POLE_HEIGHT_M
      )
    ];

    ['#078930', '#ffffff', '#ed1c24'].forEach((color, index) => {
      const lower = flagBottom + index * bandHeight;
      features.push(feature(
        `stripe-${index}`,
        color,
        groundPolygon(
          poleLongitude,
          latitude,
          flagStart,
          flagStart + FLAG_WIDTH_M,
          FLAG_DEPTH_M / 2,
          metersLongitude
        ),
        lower + bandHeight,
        lower
      ));
    });

    const sunRadius = 0.20;
    features.push(feature(
      'sun',
      '#f5d442',
      circlePolygon(
        poleLongitude + (flagStart + FLAG_WIDTH_M / 2) / metersLongitude,
        latitude,
        sunRadius,
        metersLongitude,
        21
      ),
      flagBottom + bandHeight * 2,
      flagBottom + bandHeight
    ));

    map.addSource('kurdistan-flagpole-src', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });
    map.addLayer({
      id: 'kurdistan-flagpole-3d',
      type: 'fill-extrusion',
      source: 'kurdistan-flagpole-src',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false
      }
    });
    added = true;
    dbg(`Kurdistan flagpole added at ${longitude.toFixed(6)},${latitude.toFixed(6)}.`);
  }

  return { add };
}
