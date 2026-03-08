// UK NOTAM Radius Search
// Data source: NATS AIS Contingency PIB XML feed (all UK NOTAMs valid now + next 7 days)

const NOTAM_XML_URL = "https://pibs.nats.co.uk/operational/pibs/PIB.xml";
// GitHub-hosted mirror updated hourly — no CORS issues from GitHub Pages
const NOTAM_MIRROR_URL = "https://raw.githubusercontent.com/Jonty/uk-notam-archive/main/data/PIB.xml";
const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const NM_TO_KM = 1.852;
const EARTH_RADIUS_KM = 6371;

// ---- State ----
let map, pinMarker, radiusCircle;
let pinLat = null, pinLng = null;
let radiusNM = 25;
let notams = [];
let notamMarkers = [];

// ---- DOM refs ----
const radiusSlider = document.getElementById("radius-slider");
const radiusValue = document.getElementById("radius-value");
const pinCoords = document.getElementById("pin-coords");
const searchBtn = document.getElementById("search-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");
const resultsHeader = document.getElementById("results-header");
const resultsList = document.getElementById("results-list");

// ---- Map setup ----
function initMap() {
    map = L.map("map", { zoomControl: true }).setView([54.5, -2.5], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
    }).addTo(map);

    map.on("click", onMapClick);
}

function onMapClick(e) {
    pinLat = e.latlng.lat;
    pinLng = e.latlng.lng;

    if (pinMarker) {
        pinMarker.setLatLng(e.latlng);
    } else {
        pinMarker = L.marker(e.latlng, {
            draggable: true,
            title: "Search center",
        }).addTo(map);
        pinMarker.on("dragend", () => {
            pinLat = pinMarker.getLatLng().lat;
            pinLng = pinMarker.getLatLng().lng;
            updatePinDisplay();
            updateRadiusCircle();
        });
    }

    updatePinDisplay();
    updateRadiusCircle();
    searchBtn.disabled = false;
}

function updatePinDisplay() {
    const latDir = pinLat >= 0 ? "N" : "S";
    const lngDir = pinLng >= 0 ? "E" : "W";
    pinCoords.textContent =
        `${Math.abs(pinLat).toFixed(4)}°${latDir}  ${Math.abs(pinLng).toFixed(4)}°${lngDir}`;
}

function updateRadiusCircle() {
    if (pinLat === null) return;
    const radiusMeters = radiusNM * NM_TO_KM * 1000;

    if (radiusCircle) {
        radiusCircle.setLatLng([pinLat, pinLng]);
        radiusCircle.setRadius(radiusMeters);
    } else {
        radiusCircle = L.circle([pinLat, pinLng], {
            radius: radiusMeters,
            color: "#e94560",
            fillColor: "#e94560",
            fillOpacity: 0.08,
            weight: 2,
        }).addTo(map);
    }
}

// ---- Radius slider ----
radiusSlider.addEventListener("input", () => {
    radiusNM = parseInt(radiusSlider.value, 10);
    radiusValue.textContent = radiusNM;
    updateRadiusCircle();
});

// ---- NOTAM coordinate parsing ----
// ICAO format: DDMMN/DDDMME or DDMMNDDDMME (e.g. "5408N00316W")
function parseICAOCoord(str) {
    if (!str) return null;
    const m = str.match(/^(\d{2})(\d{2})(N|S)(\d{3})(\d{2})(E|W)$/);
    if (!m) return null;
    let lat = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
    if (m[3] === "S") lat = -lat;
    let lng = parseInt(m[4], 10) + parseInt(m[5], 10) / 60;
    if (m[6] === "W") lng = -lng;
    return { lat, lng };
}

// ---- NOTAM validity date parsing ----
// Format: YYMMDDHHMM (e.g. "2603112359")
function parseNotamDate(str) {
    if (!str || str.length < 10) return null;
    const yy = parseInt(str.slice(0, 2), 10);
    const year = 2000 + yy;
    const month = parseInt(str.slice(2, 4), 10) - 1;
    const day = parseInt(str.slice(4, 6), 10);
    const hour = parseInt(str.slice(6, 8), 10);
    const min = parseInt(str.slice(8, 10), 10);
    return new Date(Date.UTC(year, month, day, hour, min));
}

function formatDate(d) {
    if (!d) return "N/A";
    return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

// ---- Haversine distance (km) ----
function haversineKm(lat1, lng1, lat2, lng2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- Fetch and parse NOTAMs ----
async function fetchNOTAMXml() {
    // Try GitHub mirror first (CORS-friendly, updated hourly)
    try {
        const resp = await fetch(NOTAM_MIRROR_URL, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
            const text = await resp.text();
            if (text.includes("<Pib") || text.includes("<Notam")) return text;
        }
    } catch {
        // fall through to NATS direct + CORS proxies
    }

    // Try NATS direct, then CORS proxies as fallback
    for (let i = -1; i < CORS_PROXIES.length; i++) {
        const url = i === -1 ? NOTAM_XML_URL : CORS_PROXIES[i](NOTAM_XML_URL);
        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!resp.ok) continue;
            const text = await resp.text();
            if (text.includes("<Pib") || text.includes("<Notam")) return text;
        } catch {
            // try next proxy
        }
    }
    throw new Error(
        "Could not fetch NOTAM data. All sources unavailable. " +
        "Try serving this page from a local server, or see README for proxy options."
    );
}

function parseNOTAMs(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const notamEls = doc.querySelectorAll("Notam");
    const results = [];

    notamEls.forEach((el) => {
        const getText = (tag) => {
            const node = el.querySelector(tag);
            return node ? node.textContent.trim() : "";
        };
        const getQLine = (tag) => {
            const qline = el.querySelector("QLine");
            if (!qline) return "";
            const node = qline.querySelector(tag);
            return node ? node.textContent.trim() : "";
        };

        const coordStr = getText("Coordinates");
        const coord = parseICAOCoord(coordStr);
        if (!coord) return; // skip NOTAMs without coordinates

        results.push({
            id: `${getText("Series")}${getText("Number")}/${getText("Year")}`,
            series: getText("Series"),
            number: getText("Number"),
            year: getText("Year"),
            type: getText("Type"),
            fir: getQLine("FIR"),
            code23: getQLine("Code23"),
            code45: getQLine("Code45"),
            traffic: getQLine("Traffic"),
            purpose: getQLine("Purpose"),
            scope: getQLine("Scope"),
            lowerFL: getQLine("Lower"),
            upperFL: getQLine("Upper"),
            coordRaw: coordStr,
            lat: coord.lat,
            lng: coord.lng,
            radiusNM: parseInt(getText("Radius"), 10) || 0,
            itemA: getText("ItemA"),
            startValidity: parseNotamDate(getText("StartValidity")),
            endValidity: parseNotamDate(getText("EndValidity")),
            itemE: getText("ItemE"),
            itemD: getText("ItemD"),
            itemF: getText("ItemF"),
            itemG: getText("ItemG"),
        });
    });

    return results;
}

// ---- Search ----
function searchNotams() {
    if (pinLat === null || notams.length === 0) return [];

    const maxDistKm = radiusNM * NM_TO_KM;
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return notams
        .map((n) => {
            const distKm = haversineKm(pinLat, pinLng, n.lat, n.lng);
            return { ...n, distKm, distNM: distKm / NM_TO_KM };
        })
        .filter((n) => {
            // Within radius
            if (n.distKm > maxDistKm) return false;
            // Active within next 7 days: start before 7 days from now AND end after now
            if (n.endValidity && n.endValidity < now) return false;
            if (n.startValidity && n.startValidity > sevenDays) return false;
            return true;
        })
        .sort((a, b) => a.distNM - b.distNM);
}

// ---- Display results ----
function clearResults() {
    resultsList.innerHTML = "";
    resultsHeader.textContent = "";
    notamMarkers.forEach((m) => map.removeLayer(m));
    notamMarkers = [];
}

function displayResults(results) {
    clearResults();

    if (results.length === 0) {
        resultsHeader.textContent = "No NOTAMs found within the search area.";
        return;
    }

    resultsHeader.textContent = `${results.length} NOTAM${results.length > 1 ? "s" : ""} found`;

    results.forEach((n) => {
        // Map marker
        const marker = L.circleMarker([n.lat, n.lng], {
            radius: 6,
            color: "#64ffda",
            fillColor: "#64ffda",
            fillOpacity: 0.7,
            weight: 1,
        }).addTo(map);

        marker.bindPopup(
            `<strong>${n.id}</strong><br>${n.itemA}<br>${n.itemE.slice(0, 200)}${n.itemE.length > 200 ? "..." : ""}`,
            { maxWidth: 300 }
        );
        notamMarkers.push(marker);

        // Sidebar card
        const card = document.createElement("div");
        card.className = "notam-card";
        card.innerHTML = `
            <div class="notam-id">${escapeHtml(n.id)} (${escapeHtml(n.type === "N" ? "NEW" : n.type === "R" ? "REPLACE" : n.type)})</div>
            <div class="notam-location">${escapeHtml(n.itemA)} — ${escapeHtml(n.fir)}</div>
            <div class="notam-qcodes">
                ${n.scope ? `<span class="qcode-tag">Scope: ${escapeHtml(n.scope)}</span>` : ""}
                ${n.code23 && n.code45 ? `<span class="qcode-tag">Q: ${escapeHtml(n.code23 + n.code45)}</span>` : ""}
                ${n.lowerFL !== "" && n.upperFL !== "" ? `<span class="qcode-tag">FL${escapeHtml(n.lowerFL)}-${escapeHtml(n.upperFL)}</span>` : ""}
            </div>
            <div class="notam-validity">
                ${formatDate(n.startValidity)} → ${formatDate(n.endValidity)}
            </div>
            <div class="notam-text">${escapeHtml(n.itemE)}</div>
            ${n.itemD ? `<div class="notam-text" style="margin-top:4px;color:#8892b0">${escapeHtml(n.itemD)}</div>` : ""}
            ${n.itemF || n.itemG ? `<div class="notam-text" style="margin-top:4px;color:#8892b0">F: ${escapeHtml(n.itemF)} G: ${escapeHtml(n.itemG)}</div>` : ""}
            <div class="notam-distance">${n.distNM.toFixed(1)} NM from pin</div>
        `;

        card.addEventListener("click", () => {
            map.setView([n.lat, n.lng], 10);
            marker.openPopup();
            document.querySelectorAll(".notam-card").forEach((c) => c.classList.remove("highlighted"));
            card.classList.add("highlighted");
        });

        resultsList.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ---- Event handlers ----
searchBtn.addEventListener("click", async () => {
    if (pinLat === null) return;

    searchBtn.disabled = true;
    setStatus("Fetching UK NOTAM data from NATS...", "loading");

    try {
        if (notams.length === 0) {
            const xml = await fetchNOTAMXml();
            notams = parseNOTAMs(xml);
            setStatus(`Loaded ${notams.length} NOTAMs. Searching...`, "loading");
        }

        const results = searchNotams();
        displayResults(results);
        setStatus(`Search complete. ${results.length} NOTAM${results.length !== 1 ? "s" : ""} within ${radiusNM} NM.`);
    } catch (err) {
        setStatus(err.message, "error");
    }

    searchBtn.disabled = false;
});

clearBtn.addEventListener("click", () => {
    clearResults();
    setStatus("");
});

function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = type || "";
}

// ---- Init ----
initMap();
