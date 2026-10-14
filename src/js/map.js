import { graphData } from './data.js';
import { getRuanganByGedung, getGedungByKode } from './dataruang.js';
import { NODE_ID_TO_KODE_GEDUNG } from './roomMapping.js';

// =====================================================================
// KONSTANTA
// =====================================================================
export const SVG_WIDTH = 12675;
export const SVG_HEIGHT = 7263;

export const MAP_BOUNDS = [
  [0, 0],
  [SVG_HEIGHT, SVG_WIDTH],
];

// =====================================================================
// KONVERSI QGIS → SVG
// =====================================================================
export function svgToLatLng(x, y) {
  const pngX = x - 0;
  const pngY = y - (-7263);
  return [pngY, pngX];
}

export function latLngToSvg(lat, lng) {
  const pngY = lat;
  const pngX = lng;
  const qgisX = pngX;
  const qgisY = pngY - 7263;
  return { x: qgisX, y: qgisY };
}

// =====================================================================
// MAPPING DROPDOWN
// =====================================================================
export const NODE_KEY_TO_DROPDOWN = {
  'building_syawal': 'gedung-syawal',
  'building_fisika': 'gedung-fisika',
  'building_biologi': 'gedung-biologi',
  'building_kimia': 'gedung-kimia',
  'building_matematika': 'gedung-matematika',
  'building_bilingual': 'gedung-bilingual',
  'building_bersama': 'gedung-bersama',
  'lab_fisika': 'lab-fisika',
  'lab_math': 'lab-matematika',
  'lab_kimia': 'lab-kimia',
  'lab_bio_new': 'lab-biologi',
  'lab_bio-old': 'lab-biologi-timur',
};

// =====================================================================
// STATE
// =====================================================================
let mapInstance = null;
let pngOverlay = null;
let neutralMarkersLayer = null;
let routeGlowLayer = null;
let routeCoreLayer = null;
let routeMarkersLayer = null;
let userPinLayer = null;
let highlightLayer = null;

let activeAsalNodeId = null;
let activeTujuanNodeId = null;
let activeCallbackSetAsal = null;
let activeCallbackSetTujuan = null;
let userPinIdCounter = 0;

// =====================================================================
// HIGHLIGHT
// =====================================================================
export function updateSelectionHighlight(asalId, tujuanId) {
  activeAsalNodeId = asalId || null;
  activeTujuanNodeId = tujuanId || null;

  if (!mapInstance || !highlightLayer) return;

  highlightLayer.clearLayers();
  const allNodes = graphData.nodes;

  function makeHighlightMarker(nodeId, color, iconChar, label) {
    if (!nodeId) return;
    const node = allNodes[nodeId];
    if (!node || node.x === undefined || node.y === undefined) return;

    const latLng = svgToLatLng(node.x, node.y);
    const icon = L.divIcon({
      className: 'fmipa-selected-pin',
      html: `
        <div style="
          display: flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 50%;
          background: ${color}; border: 3px solid #ffffff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          color: #ffffff; font-size: 16px; font-weight: bold;
        ">${iconChar}</div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    L.marker(latLng, { icon, interactive: false, zIndexOffset: 1000 })
      .addTo(highlightLayer);
  }

  if (activeAsalNodeId) {
    const n = allNodes[activeAsalNodeId];
    makeHighlightMarker(activeAsalNodeId, '#dc2626', '🔴', n?.label || activeAsalNodeId);
  }
  if (activeTujuanNodeId) {
    const n = allNodes[activeTujuanNodeId];
    makeHighlightMarker(activeTujuanNodeId, '#2563eb', '🔵', n?.label || activeTujuanNodeId);
  }
}

export function clearSelectionHighlight() {
  activeAsalNodeId = null;
  activeTujuanNodeId = null;
  if (highlightLayer) highlightLayer.clearLayers();
}

// =====================================================================
// INIT MAP
// =====================================================================
export function initMap(containerId = 'map-container', callbacks = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`[map.js] Container '#${containerId}' tidak ditemukan.`);
    return null;
  }

  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  if (callbacks.onSetAsal) activeCallbackSetAsal = callbacks.onSetAsal;
  if (callbacks.onSetTujuan) activeCallbackSetTujuan = callbacks.onSetTujuan;

  container.style.backgroundColor = '#fbf8ef';
  container.style.overflow = 'hidden';

  mapInstance = L.map(containerId, {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: 2.5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    attributionControl: false,
    zoomControl: false,
    maxBounds: MAP_BOUNDS,
    maxBoundsViscosity: 1.0,
    bounceAtZoomLimits: true,
  });

  const svgCandidates = [
    './map.png',
    '../../map.png',
    'map.png',
    '/map.png',
    'assets/map.png',
    '/public/assets/map.png',
    '../assets/map.png',
  ];

  function tryLoadSvg(index) {
    if (index >= svgCandidates.length) {
      console.warn('[map.js] ⚠️ Map tidak ditemukan.');
      return;
    }
    const url = svgCandidates[index];
    const img = new Image();
    img.onload = () => {
      L.imageOverlay(url, MAP_BOUNDS).addTo(mapInstance);
      console.log(`[map.js] ✅ Map loaded: ${url}`);
    };
    img.onerror = () => tryLoadSvg(index + 1);
    img.src = url;
  }
  tryLoadSvg(0);

  // Layer groups
  neutralMarkersLayer = L.layerGroup().addTo(mapInstance);
  routeGlowLayer = L.layerGroup().addTo(mapInstance);
  routeCoreLayer = L.layerGroup().addTo(mapInstance);
  routeMarkersLayer = L.layerGroup().addTo(mapInstance);
  userPinLayer = L.layerGroup().addTo(mapInstance);
  highlightLayer = L.layerGroup().addTo(mapInstance);

  mapInstance.fitBounds(MAP_BOUNDS);

  function updateZoomConstraints() {
    if (!mapInstance) return;
    try {
      const fitZoom = mapInstance.getBoundsZoom(MAP_BOUNDS, false);
      mapInstance.setMinZoom(fitZoom);
    } catch (err) {}
  }
  updateZoomConstraints();

  mapInstance.on('click', (e) => {
    if (e.originalEvent && e.originalEvent._fmipaHandled) {
      e.originalEvent._fmipaHandled = false;
      return;
    }
    createUserPin(e.latlng.lat, e.latlng.lng);
  });

  renderNeutralMarkers();

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  if (btnZoomIn) btnZoomIn.onclick = () => mapInstance && mapInstance.zoomIn();
  if (btnZoomOut) btnZoomOut.onclick = () => mapInstance && mapInstance.zoomOut();

  window.addEventListener('resize', () => {
    if (mapInstance) {
      mapInstance.invalidateSize();
      updateZoomConstraints();
    }
  });

  setTimeout(() => {
    if (mapInstance) {
      mapInstance.invalidateSize();
      mapInstance.fitBounds(MAP_BOUNDS);
      updateZoomConstraints();
    }
  }, 250);

  return mapInstance;
}

// =====================================================================
// USER PIN
// =====================================================================
export function createUserPin(lat, lng) {
  if (!mapInstance) return null;
  if (!userPinLayer) {
    userPinLayer = L.layerGroup().addTo(mapInstance);
  }

  userPinIdCounter++;
  const pinId = `pin_${Date.now()}_${userPinIdCounter}`;
  const pos = latLngToSvg(lat, lng);

  const pinIcon = L.divIcon({
    className: 'fmipa-user-pin',
    html: `
      <div style="
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 50%;
        background: #C54F2D; border: 2px solid #FFFDF7;
        box-shadow: 0 4px 10px rgba(197, 79, 45, 0.5);
        color: #FFFDF7; font-size: 14px; cursor: pointer;
      ">📍</div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(userPinLayer);

  marker.bindPopup(`
    <div style="font-family: inherit; font-size: 12px; min-width: 200px;">
      <strong style="color: #292524; font-size: 13px; display: block; margin-bottom: 4px;">
        📍 Titik Penanda #${userPinIdCounter}
      </strong>
      <div style="font-family: monospace; font-size: 11px; color: #475569; background: #f1f5f9; padding: 4px 6px; border-radius: 4px; margin-bottom: 6px;">
        X: ${pos.x.toFixed(2)}<br>
        Y: ${pos.y.toFixed(2)}
      </div>
      <button id="btn-delete-${pinId}" style="
        width: 100%; background: #ef4444; color: white;
        border: none; padding: 6px 10px; border-radius: 6px;
        font-size: 11px; font-weight: bold; cursor: pointer;
      ">🗑️ Hapus</button>
    </div>
  `);

  marker.on('popupopen', () => {
    const btnDel = document.getElementById(`btn-delete-${pinId}`);
    if (btnDel) btnDel.onclick = () => userPinLayer.removeLayer(marker);
  });

  marker.on('contextmenu', (ev) => {
    L.DomEvent.stopPropagation(ev);
    userPinLayer.removeLayer(marker);
  });

  marker.openPopup();
  return marker;
}

// =====================================================================
// NEUTRAL MARKERS
// =====================================================================
export function renderNeutralMarkers(callbacks = {}) {
  if (!mapInstance || !neutralMarkersLayer) return;
  neutralMarkersLayer.clearLayers();

  const onSetAsal = callbacks.onSetAsal || activeCallbackSetAsal;
  const onSetTujuan = callbacks.onSetTujuan || activeCallbackSetTujuan;

  const nodes = graphData.nodes;
  Object.keys(nodes).forEach((key) => {
    const node = nodes[key];
    if (!node.isBuilding) return;

    const latLng = svgToLatLng(node.x, node.y);
    const dropdownValue = NODE_KEY_TO_DROPDOWN[key] || '';

    const neutralIcon = L.divIcon({
      className: 'fmipa-neutral-pin',
      html: `
        <div style="
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 50%;
          background: #475569; border: 2px solid #ffffff;
          box-shadow: 0 3px 8px rgba(0,0,0,0.35);
          color: #ffffff; font-size: 14px; cursor: pointer;
        " title="${node.label || key}">🏛️</div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker(latLng, { icon: neutralIcon }).addTo(neutralMarkersLayer);

    const popupHtml = `
      <div style="font-family: inherit; font-size: 12px; min-width: 190px;">
        <strong style="color: #1e293b; font-size: 13px; display: block; margin-bottom: 2px;">
          ${node.label || key}
        </strong>
        <span style="font-size: 10px; background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 4px;">
          ${node.category || 'Gedung FMIPA'}
        </span>
        <div style="display: flex; gap: 6px; margin-top: 8px;">
          <button id="popup-set-asal-${key}" style="flex:1; background: #dc2626; color:#fff; border:none; padding:6px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">📍 Set Awal</button>
          <button id="popup-set-tujuan-${key}" style="flex:1; background: #2563eb; color:#fff; border:none; padding:6px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">🎯 Set Tujuan</button>
        </div>
      </div>
    `;

    marker.bindPopup(popupHtml);

    marker.on('popupopen', () => {
      const btnAsal = document.getElementById(`popup-set-asal-${key}`);
      const btnTujuan = document.getElementById(`popup-set-tujuan-${key}`);
      if (btnAsal) btnAsal.onclick = (ev) => {
        if (ev) ev.stopPropagation();
        if (onSetAsal) onSetAsal(key, node, dropdownValue);
        marker.closePopup();
      };
      if (btnTujuan) btnTujuan.onclick = (ev) => {
        if (ev) ev.stopPropagation();
        if (onSetTujuan) onSetTujuan(key, node, dropdownValue);
        marker.closePopup();
      };
    });

    marker.on('click', (e) => {
      if (e.originalEvent) e.originalEvent._fmipaHandled = true;
      updateBuildingInfoPanel(node, key, onSetAsal, onSetTujuan);
    });
  });
}

// =====================================================================
// INFO PANEL — dengan integrasi dataruang.js
// =====================================================================
export function updateBuildingInfoPanel(buildingNode, nodeKey, onSetAsal = null, onSetTujuan = null) {
  const namaEl = document.getElementById('nama-gedung');
  const daftarEl = document.getElementById('daftar-ruangan');
  const panelActions = document.getElementById('panel-gedung-actions');

  if (namaEl && buildingNode) {
    namaEl.textContent = buildingNode.label || buildingNode.name || 'Gedung';
  }

  const dropdownValue = nodeKey ? NODE_KEY_TO_DROPDOWN[nodeKey] : '';
  const cbAsal = onSetAsal || activeCallbackSetAsal;
  const cbTujuan = onSetTujuan || activeCallbackSetTujuan;

  if (panelActions) {
    panelActions.classList.remove('hidden');
    const btnAsal = document.getElementById('btn-set-asal');
    const btnTujuan = document.getElementById('btn-set-tujuan');
    if (btnAsal) btnAsal.onclick = () => cbAsal && buildingNode && cbAsal(nodeKey, buildingNode, dropdownValue);
    if (btnTujuan) btnTujuan.onclick = () => cbTujuan && buildingNode && cbTujuan(nodeKey, buildingNode, dropdownValue);
  }

  // Render daftar ruangan
  renderRoomList(nodeKey);
}

function renderRoomList(nodeKey) {
  const daftarEl = document.getElementById('daftar-ruangan');
  if (!daftarEl) return;

  const kodeGedung = NODE_ID_TO_KODE_GEDUNG[nodeKey];

  if (!kodeGedung) {
    daftarEl.innerHTML = `
      <div class="rounded-xl border border-dashed border-[#D2BE91] bg-[#FFFDF7] px-4 py-3 text-xs text-stone-500">
        Data ruangan belum tersedia untuk gedung ini.
      </div>
    `;
    return;
  }

  const gedung = getGedungByKode(kodeGedung);
  const ruangan = getRuanganByGedung(kodeGedung);

  if (!gedung || ruangan.length === 0) {
    daftarEl.innerHTML = `
      <div class="rounded-xl border border-dashed border-[#D2BE91] bg-[#FFFDF7] px-4 py-3 text-xs text-stone-500">
        Belum ada data ruangan untuk ${gedung?.namaGedung || 'gedung ini'}.
      </div>
    `;
    return;
  }

  // Bangun HTML untuk tabs per lantai + search + list
  const tabsHtml = `
    <div class="room-tabs">
      <button class="tab-btn active" data-lantai="all">Semua (${ruangan.length})</button>
      ${gedung.daftarLantai.map(lt => {
        const count = ruangan.filter(r => r.lantai === lt).length;
        return `<button class="tab-btn" data-lantai="${lt}">Lt.${lt} (${count})</button>`;
      }).join('')}
    </div>
  `;

  const searchHtml = `
    <div class="room-search">
      <input type="text" id="search-ruangan" placeholder="🔍 Cari ruangan atau kode (mis. 001.1.01)...">
    </div>
  `;

  const listHtml = `
    <div id="room-list" class="room-list">
      ${ruangan.map(r => `
        <div class="room-item" 
     data-lantai="${r.lantai}" 
     data-nama="${(r.namaRuangan || '').toLowerCase()}" 
     data-kode="${(r.kodeRuangan || '').toLowerCase()}">
          <div class="room-code">${r.kodeRuangan}</div>
          <div class="room-name">${r.namaRuangan || '-'}</div>
          <div class="room-floor">Lantai ${r.lantai}</div>
        </div>
      `).join('')}
    </div>
  `;

  daftarEl.innerHTML = tabsHtml + searchHtml + listHtml;

  // Event: klik tab
  daftarEl.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      const lantai = btn.dataset.lantai;
      daftarEl.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterRooms(lantai, '');
    };
  });

  // Event: search
  const searchInput = document.getElementById('search-ruangan');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const activeTab = daftarEl.querySelector('.tab-btn.active');
      filterRooms(activeTab?.dataset.lantai || 'all', e.target.value.toLowerCase());
    };
  }
}

function filterRooms(lantai, keyword) {
  const items = document.querySelectorAll('.room-item');
  items.forEach(item => {
    const matchLantai = lantai === 'all' || item.dataset.lantai === lantai;
    const matchKeyword = !keyword 
      || item.dataset.nama.includes(keyword) 
      || item.dataset.kode.includes(keyword);   // ← TAMBAH INI
    item.style.display = (matchLantai && matchKeyword) ? '' : 'none';
  });
}

export function resetBuildingInfoPanel() {
  const namaEl = document.getElementById('nama-gedung');
  const daftarEl = document.getElementById('daftar-ruangan');
  const panelActions = document.getElementById('panel-gedung-actions');

  if (namaEl) namaEl.textContent = 'Informasi gedung';
  if (panelActions) panelActions.classList.add('hidden');
  if (daftarEl) {
    daftarEl.innerHTML = `
      <div class="rounded-xl border border-dashed border-[#D2BE91] bg-[#FFFDF7] px-4 py-3 text-sm text-stone-500">
        Pilih gedung pada peta untuk melihat informasi ruangan.
      </div>
    `;
  }
}

// =====================================================================
// DRAW ROUTE
// =====================================================================
export function drawRoute(steps = []) {
  clearRoute();
  if (!steps || steps.length < 2) return;

  const polylineCoords = steps.map((s) => svgToLatLng(s.x, s.y));

  routeGlowLayer.addLayer(L.polyline(polylineCoords, {
    color: '#4ade80', weight: 12, opacity: 0.65, lineCap: 'round', lineJoin: 'round',
  }));
  routeCoreLayer.addLayer(L.polyline(polylineCoords, {
    color: '#16a34a', weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round',
  }));
  routeCoreLayer.addLayer(L.polyline(polylineCoords, {
    color: '#ffffff', weight: 2, opacity: 0.9, dashArray: '6, 10',
  }));

  steps.forEach((step, idx) => {
    const latLng = svgToLatLng(step.x, step.y);
    const isStart = idx === 0;
    const isEnd = idx === steps.length - 1;

    if (!isStart && !isEnd && !step.isBuilding) {
      const dotIcon = L.divIcon({
        className: 'fmipa-waypoint-dot',
        html: `<div style="width:10px;height:10px;border-radius:50%;background:#eab308;border:2px solid #fff;"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });
      routeMarkersLayer.addLayer(L.marker(latLng, { icon: dotIcon }));
      return;
    }

    let bgColor = '#eab308';
    let iconChar = '🟡';
    if (isStart) { bgColor = '#dc2626'; iconChar = '🔴'; }
    else if (isEnd) { bgColor = '#2563eb'; iconChar = '🔵'; }

    const pinIcon = L.divIcon({
      className: 'fmipa-route-pin',
      html: `<div style="
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 50%;
        background: ${bgColor}; border: 2px solid #fff;
        color: #fff; font-size: 13px;
      ">${iconChar}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    routeMarkersLayer.addLayer(L.marker(latLng, { icon: pinIcon }));
  });

  const routeBounds = L.polyline(polylineCoords).getBounds();
  mapInstance.fitBounds(routeBounds, {
    padding: [120, 120],
    maxZoom: -2,
    animate: true,
  });
}

export function clearRoute() {
  if (routeGlowLayer) routeGlowLayer.clearLayers();
  if (routeCoreLayer) routeCoreLayer.clearLayers();
  if (routeMarkersLayer) routeMarkersLayer.clearLayers();
}

export function clearUserMarkers() {
  if (userPinLayer) userPinLayer.clearLayers();
}

export function handleResetMap() {
  clearRoute();
  clearUserMarkers();
  clearSelectionHighlight();
  resetUserPinCounter();
}

export function resetUserPinCounter() {
  userPinIdCounter = 0;
}

export function resetMapView() {
  if (mapInstance) {
    mapInstance.fitBounds(MAP_BOUNDS, { padding: [0, 0], animate: true });
    try {
      const fitZoom = mapInstance.getBoundsZoom(MAP_BOUNDS, false);
      mapInstance.setMinZoom(fitZoom);
    } catch (e) {}
  }
}

export function addBuildingMarkers(onBuildingSelect) {
  renderNeutralMarkers({ onSetAsal: onBuildingSelect, onSetTujuan: onBuildingSelect });
}

export function getMap() { return mapInstance; }