# Elsewhere — World Map

A full-screen travel map built with HTML, CSS, JavaScript, and D3.

## Run locally

From this directory run:

```sh
npm run dev
```

Open http://127.0.0.1:5173. No npm install or build step is needed.

An internet connection is required for D3, fonts, and Natural Earth GeoJSON. The data loader first checks `assets/countries.geojson`, then the Natural Earth GitHub source and a CDN fallback. To self-host assets, download D3 7.9.0 to `assets/d3.min.js`, update its script URL in `index.html`, and put the Natural Earth 50m Admin 0 countries GeoJSON at `assets/countries.geojson`.

## Interaction

- Click a country, choose a color, and save its category with **Counts as visited** enabled.
- Drag or swipe to pan; scroll or pinch to zoom. Double-click also zooms.
- Use + / − to zoom, arrow keys to pan, Home to reset, / to search, Escape to close panels.
- Search and the country list provide keyboard access and access to microstates.
- The counter uses 193 UN members plus Palestine and the Holy See. Territories and other map areas are selectable and searchable, with their own visits and color categories. Their visited total is separate from the 195-country checklist.

Natural Earth uses de facto border conventions. Boundaries and recognition can be disputed, and data releases can lag changes. Source: https://www.naturalearthdata.com/downloads/50m-cultural-vectors/

## Persistence and extensions

The `elsewhere.visits.v1` localStorage record contains a version and country records keyed by stable ISO alpha-2 codes. Place records store their category ID and update time. Older records may include a standalone visit flag or a reserved photo field. The repository adapter in `app.js` is the replacement point for future authenticated API storage. Visit state is independent of geometry. Future photos can use SVG clip paths or patterns keyed to the same country IDs, with uploads stored outside localStorage.

Selections are specific to a browser and origin; clearing browser data removes them. Storage failures display a message instead of silently claiming a save. Changes synchronize between tabs on the same origin.

## Validation

`npm run check` checks JavaScript syntax. Country count/uniqueness, storage round trip, malformed storage recovery, and blocked writes were checked with Node. Browser visual and gesture checks remain necessary: the build environment did not permit a local HTTP listener or external asset downloads.

## Color categories

Select a place and choose one of ten colors. Edit **Category name** and **Counts as visited**, then select **Save**. Both settings apply to every place using the color, and the totals and Visited filter update together. **Clear** removes the place’s category and visit.

The saved data retains existing visits until a place is reassigned, cleared, or its category’s settings are saved. New color assignments count as visits once their category has **Counts as visited** enabled.

## Territories and other areas

All land features provided by the source dataset are selectable, including Puerto Rico, Greenland, disputed areas, and Antarctica. The initial world framing excludes Antarctica to preserve the existing view; search can focus it. Areas outside the country checklist use stable `area:<ADM0_A3>` keys in the same saved records. Existing country keys and selections are preserved. The compact counter adds an “other areas visited” line when needed, and category counts include all places.

## US States

Choose **States** next to Globe for an Albers USA map with Alaska and Hawaii insets. The footprint, search, list, category counts, and visited-only filter switch to the 50 states (excluding DC and territories). State assignments are independent of country assignments; category names, colors, and visit rules are shared. Visiting a state does not automatically mark the United States visited.

State records use `state:<two-digit FIPS>` keys in the existing storage and settings backup. Existing country-only backups remain supported. Downloaded settings include both country and state records. Restoring a backup replaces all records, including state records.

The state loader tries `assets/states.geojson` first (GeoJSON features with two-digit FIPS IDs and `properties.name`), then US Atlas 3.0.1 from jsDelivr and unpkg, decoded with TopoJSON Client 3.1.0. Sources: https://github.com/topojson/us-atlas and the US Census Bureau. A failed state-data load leaves the current view available and allows retrying.

## Geography quiz

Open `/quiz/` for the separate quiz. Map and Globe share country answers; States has its own answers. Save answers to color places ochre, then Grade for fern green (correct) and dusty rose (incorrect). Only answered places receive labels after grading. Editing clears the active dataset’s grade.

Choose Show All to display every name or Click to Show to reveal names on selection. Quiz returns to answer entry. Zoom to separate dense labels. Grading ignores case, accents, spaces and punctuation, and accepts common country aliases. Answers persist independently in `elsewhere.quiz.v1`. Start over clears only the active dataset.
