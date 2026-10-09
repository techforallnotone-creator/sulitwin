import terrainSurveyData from '../data/terrain_salim_dem.js';

export function createTerrainController({ map, state, dbg, logPrompt }) {
    const DEM_SOURCE_ID = 'terrain-survey-src';
    const DEM_LAYER_ID = 'terrain-fill';
    const DEM_EXTRUSION_LAYER_ID = 'terrain-extrusion';
    const CONTOUR_SOURCE_ID = 'terrain-contour-src';
    const CONTOUR_LAYER_ID = 'terrain-contours';

    const { width, height, minLat, maxLat, minLon, maxLon, cellLat, cellLon, elevation, minElevation, maxElevation } = terrainSurveyData;
    const DEM = elevation;
    const contourStep = 5;
    const colorCache = new Map();
    const colorStops = [
        [minElevation, '#d8e7cf'],
        [minElevation + (maxElevation - minElevation) * 0.25, '#b7dca1'],
        [minElevation + (maxElevation - minElevation) * 0.5, '#8ec07a'],
        [minElevation + (maxElevation - minElevation) * 0.65, '#c9a466'],
        [minElevation + (maxElevation - minElevation) * 0.8, '#8a6a4d'],
        [maxElevation, '#53463a']
    ].map(([value, color]) => [value, hexToRgb(color)]);
    let terrainLayersReady = false;
    let terrainDataLoaded = false;

    function valueAt(x, y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return null;
        return DEM[y][x];
    }

    function lonForX(x) {
        return minLon + x * cellLon;
    }

    function latForY(y) {
        return maxLat - y * cellLat;
    }

    function sampleElevation(lon, lat) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)
            || lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null;
        const x = (lon - minLon) / cellLon;
        const y = (maxLat - lat) / cellLat;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const topLeft = valueAt(x0, y0);
        const topRight = valueAt(x1, y0);
        const bottomLeft = valueAt(x0, y1);
        const bottomRight = valueAt(x1, y1);
        if ([topLeft, topRight, bottomLeft, bottomRight].some(value => value == null)) return null;
        const tx = x - x0;
        const ty = y - y0;
        return (topLeft * (1 - tx) + topRight * tx) * (1 - ty)
            + (bottomLeft * (1 - tx) + bottomRight * tx) * ty;
    }

    function findFloodRiskAreas(rainfallMm) {
        if (!Number.isFinite(rainfallMm) || rainfallMm <= 0) {
            throw new Error('Rainfall must be a positive number of millimeters.');
        }
        const threshold = Math.max(0.4, 1.3 - Math.min(rainfallMm, 100) * 0.008);
        const candidates = new Map();
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const current = valueAt(x, y);
                let neighborTotal = 0;
                let neighborCount = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const neighbor = valueAt(x + dx, y + dy);
                        if (neighbor == null) continue;
                        neighborTotal += neighbor;
                        neighborCount++;
                    }
                }
                const depth = neighborCount ? neighborTotal / neighborCount - current : 0;
                if (depth >= threshold) candidates.set(y * width + x, { x, y, depth });
            }
        }

        const cellMeters = Math.max(
            cellLat * 111320,
            cellLon * 111320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
        );
        const visited = new Set();
        const regions = [];
        for (const [startIndex, start] of candidates) {
            if (visited.has(startIndex)) continue;
            const queue = [start];
            visited.add(startIndex);
            let score = 0;
            let sumX = 0;
            let sumY = 0;
            for (let head = 0; head < queue.length; head++) {
                const point = queue[head];
                score += point.depth;
                sumX += point.x;
                sumY += point.y;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const index = (point.y + dy) * width + point.x + dx;
                        const next = candidates.get(index);
                        if (next && !visited.has(index)) {
                            visited.add(index);
                            queue.push(next);
                        }
                    }
                }
            }
            const centerX = sumX / queue.length;
            const centerY = sumY / queue.length;
            regions.push({
                center: [lonForX(centerX), latForY(centerY)],
                radiusMeters: Math.min(120, Math.max(18, cellMeters * Math.sqrt(queue.length) * 0.8 + rainfallMm * 0.12)),
                score
            });
        }
        return regions.sort((a, b) => b.score - a.score).slice(0, 12);
    }

    function interpolatedColor(elevationValue) {
        const cachedColor = colorCache.get(elevationValue);
        if (cachedColor) return cachedColor;
        for (let i = 0; i < colorStops.length - 1; i++) {
            const [lowVal, lowColor] = colorStops[i];
            const [highVal, highColor] = colorStops[i + 1];
            if (elevationValue >= lowVal && elevationValue <= highVal) {
                const t = (elevationValue - lowVal) / (highVal - lowVal || 1);
                const color = rgbToHex(
                    Math.round(lowColor[0] + (highColor[0] - lowColor[0]) * t),
                    Math.round(lowColor[1] + (highColor[1] - lowColor[1]) * t),
                    Math.round(lowColor[2] + (highColor[2] - lowColor[2]) * t)
                );
                colorCache.set(elevationValue, color);
                return color;
            }
        }
        return '#53463a';
    }

    function hexToRgb(hex) {
        const clean = hex.replace('#', '');
        const normalized = clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean;
        const value = Number.parseInt(normalized, 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function buildTerrainData() {
        const features = [];
        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width - 1; x++) {
                const tl = valueAt(x, y);
                const tr = valueAt(x + 1, y);
                const br = valueAt(x + 1, y + 1);
                const bl = valueAt(x, y + 1);
                if (tl == null || tr == null || br == null || bl == null) continue;
                const avg = (tl + tr + br + bl) / 4;
                const heightValue = Math.max(1, avg - minElevation);
                const coords = [
                    [lonForX(x), latForY(y)],
                    [lonForX(x + 1), latForY(y)],
                    [lonForX(x + 1), latForY(y + 1)],
                    [lonForX(x), latForY(y + 1)],
                    [lonForX(x), latForY(y)]
                ];
                features.push({
                    type: 'Feature',
                    properties: {
                        elevation: avg,
                        height: heightValue,
                        color: interpolatedColor(avg),
                        base: 0
                    },
                    geometry: { type: 'Polygon', coordinates: [coords] }
                });
            }
        }
        return { type: 'FeatureCollection', features };
    }

    function buildContourData() {
        const features = [];
        const startLevel = Math.ceil(minElevation / contourStep) * contourStep;
        const endLevel = Math.floor(maxElevation / contourStep) * contourStep;

        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width - 1; x++) {
                const tl = valueAt(x, y);
                const tr = valueAt(x + 1, y);
                const br = valueAt(x + 1, y + 1);
                const bl = valueAt(x, y + 1);
                if (tl == null || tr == null || br == null || bl == null) continue;
                const lowLevel = Math.max(startLevel, Math.ceil(Math.min(tl, tr, br, bl) / contourStep) * contourStep);
                const highLevel = Math.min(endLevel, Math.floor(Math.max(tl, tr, br, bl) / contourStep) * contourStep);

                for (let level = lowLevel; level <= highLevel; level += contourStep) {
                    let first = null;
                    let second = null;
                    let crossingCount = 0;
                    for (let edge = 0; edge < 4; edge++) {
                        let valueA, valueB, lon, lat;
                        if (edge === 0) {
                            valueA = tl; valueB = tr;
                        } else if (edge === 1) {
                            valueA = tr; valueB = br;
                        } else if (edge === 2) {
                            valueA = br; valueB = bl;
                        } else {
                            valueA = bl; valueB = tl;
                        }
                        if ((valueA >= level) === (valueB >= level)) continue;
                        const ratio = Math.abs(valueA - level) / Math.abs(valueA - valueB || 1);
                        if (edge === 0) {
                            lon = lonForX(x + ratio);
                            lat = latForY(y);
                        } else if (edge === 1) {
                            lon = lonForX(x + 1);
                            lat = latForY(y + ratio);
                        } else if (edge === 2) {
                            lon = lonForX(x + 1 - ratio);
                            lat = latForY(y + 1);
                        } else {
                            lon = lonForX(x);
                            lat = latForY(y + 1 - ratio);
                        }
                        if (crossingCount === 0) first = [lon, lat];
                        else if (crossingCount === 1) second = [lon, lat];
                        crossingCount++;
                    }
                    if (crossingCount >= 2) {
                        features.push({
                            type: 'Feature',
                            properties: { elevation: level },
                            geometry: { type: 'LineString', coordinates: [first, second] }
                        });
                    }
                }
            }
        }
        return { type: 'FeatureCollection', features };
    }

    function updateVisibility() {
        const terrainVisible = !!state.terrainVisible;
        if (map.getLayer(DEM_LAYER_ID)) {
            map.setLayoutProperty(DEM_LAYER_ID, 'visibility', terrainVisible ? 'visible' : 'none');
        }
        if (map.getLayer(DEM_EXTRUSION_LAYER_ID)) {
            map.setLayoutProperty(DEM_EXTRUSION_LAYER_ID, 'visibility', terrainVisible ? 'visible' : 'none');
        }
        if (map.getLayer(CONTOUR_LAYER_ID)) {
            map.setLayoutProperty(CONTOUR_LAYER_ID, 'visibility', terrainVisible ? 'visible' : 'none');
        }
        const button = document.getElementById('terrain-toggle-btn');
        if (button) {
            button.textContent = terrainVisible ? '🗻 Terrain ON' : '🗻 Terrain OFF';
            button.classList.toggle('active', terrainVisible);
        }
    }

    function positionTerrainLayers() {
        const before = map.getLayer('buildings-shadow')
            ? 'buildings-shadow'
            : (map.getLayer('buildings-live') ? 'buildings-live' : (map.getLayer('road-label') || undefined));
        if (!before) return;
        for (const layerId of [DEM_LAYER_ID, DEM_EXTRUSION_LAYER_ID, CONTOUR_LAYER_ID]) {
            if (map.getLayer(layerId)) {
                const currentIndex = map.getStyle().layers.findIndex(layer => layer.id === layerId);
                const beforeIndex = map.getStyle().layers.findIndex(layer => layer.id === before);
                if (currentIndex >= 0 && beforeIndex >= 0 && currentIndex !== beforeIndex - 1) {
                    map.moveLayer(layerId, before);
                }
            }
        }
    }

    function ensureTerrainLayers() {
        if (!map.getSource(DEM_SOURCE_ID)) {
            map.addSource(DEM_SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }
        if (!map.getSource(CONTOUR_SOURCE_ID)) {
            map.addSource(CONTOUR_SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        const beforeBuildingLayers = map.getLayer('buildings-shadow')
            ? 'buildings-shadow'
            : (map.getLayer('buildings-live') ? 'buildings-live' : (map.getLayer('road-label') || undefined));

        if (!map.getLayer(DEM_LAYER_ID)) {
            map.addLayer({
                id: DEM_LAYER_ID,
                type: 'fill',
                source: DEM_SOURCE_ID,
                paint: {
                    'fill-color': ['coalesce', ['get', 'color'], '#b7dca1'],
                    'fill-opacity': 0.4
                }
            }, beforeBuildingLayers);
        }

        if (!map.getLayer(DEM_EXTRUSION_LAYER_ID)) {
            map.addLayer({
                id: DEM_EXTRUSION_LAYER_ID,
                type: 'fill-extrusion',
                source: DEM_SOURCE_ID,
                minzoom: 15,
                paint: {
                    'fill-extrusion-color': ['coalesce', ['get', 'color'], '#b7dca1'],
                    'fill-extrusion-height': ['coalesce', ['get', 'height'], 0],
                    'fill-extrusion-base': ['coalesce', ['get', 'base'], 0],
                    'fill-extrusion-opacity': 0.4,
                    'fill-extrusion-vertical-gradient': true
                }
            }, beforeBuildingLayers);
        }

        if (!map.getLayer(CONTOUR_LAYER_ID)) {
            map.addLayer({
                id: CONTOUR_LAYER_ID,
                type: 'line',
                source: CONTOUR_SOURCE_ID,
                paint: {
                    'line-color': '#5d4633',
                    'line-width': 1,
                    'line-opacity': 0.35
                }
            }, beforeBuildingLayers);
        }

        positionTerrainLayers();

        terrainLayersReady = true;
        if (state.terrainVisible) ensureTerrainData();
        updateVisibility();
    }

    function ensureTerrainData() {
        if (terrainDataLoaded || !terrainLayersReady) return;
        const demSource = map.getSource(DEM_SOURCE_ID);
        const contourSource = map.getSource(CONTOUR_SOURCE_ID);
        if (!demSource || !contourSource) return;
        demSource.setData(buildTerrainData());
        contourSource.setData(buildContourData());
        terrainDataLoaded = true;
        dbg(`Terrain DEM: ${width}x${height} (${minElevation}–${maxElevation}m, ${terrainSurveyData.pointsCount} points)`);
    }

    function setEnabled(nextValue) {
        state.terrainVisible = !!nextValue;
        if (state.terrainVisible) ensureTerrainData();
        updateVisibility();
        logPrompt('bot', state.terrainVisible ? 'Terrain ON.' : 'Terrain OFF.');
    }

    return {
        ensureTerrainLayers,
        updateVisibility,
        setEnabled,
        sampleElevation,
        findFloodRiskAreas,
        isEnabled: () => !!state.terrainVisible
    };
}
