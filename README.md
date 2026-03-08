# UK NOTAM Radius Search

Drop a pin on the map, adjust the search radius, and find all UK NOTAMs active within the next 7 days in that area.

## Data Source

NOTAM data is sourced from the **NATS AIS Contingency PIB** XML feed (`pibs.nats.co.uk`), which contains all UK NOTAMs valid at the time of generation plus the next 7 days. The feed is updated every 4 hours by NATS and requires no authentication.

## How to Use

1. Open `index.html` in a browser (or serve it locally — see below)
2. Click anywhere on the map to drop a pin
3. Drag the pin to reposition it
4. Use the slider to adjust the search radius (1–200 NM)
5. Click **Search NOTAMs** to fetch and filter
6. Click any result card to fly to its location on the map

## Running Locally

The NATS feed does not include CORS headers, so the app uses a public CORS proxy (`corsproxy.io` / `allorigins.win`). For reliability, serve locally with a simple proxy:

```bash
# Python
python3 -m http.server 8000

# Or Node
npx serve .
```

If CORS proxies are unavailable, you can proxy the feed yourself:

```bash
# Nginx example
location /notam-proxy {
    proxy_pass https://pibs.nats.co.uk/operational/pibs/PIB.xml;
}
```

Then update `NOTAM_XML_URL` in `notam.js` to point to your proxy.

## Features

- Interactive Leaflet map centered on the UK
- Draggable pin with adjustable radius circle overlay
- Parses ICAO Q-line coordinates from raw NOTAM XML
- Haversine distance calculation for radius filtering
- Results sorted by distance from pin
- Click-to-zoom on individual NOTAMs
- Dark theme UI

## NOTAM Fields Displayed

- **ID** — Series + Number/Year
- **Location** — Item A (aerodrome/area) and FIR
- **Q-codes** — Scope, subject/condition codes, flight levels
- **Validity** — Start and end times (UTC)
- **Text** — Item E (main NOTAM text)
- **Schedule** — Item D (if present)
- **Altitude** — Items F/G (if present)
- **Distance** — Nautical miles from your pin
