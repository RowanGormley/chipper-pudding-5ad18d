// Defaults that used to come from the hosting platform's props editor.
// Tweak these directly.
const CONFIG = {
  accentColor: "#ec6a1f",
  defaultWalkMins: 20,
  // When true, recommendations are ranked by a call to /api/recommend
  // (a serverless function backed by Claude — see api/recommend.js). If
  // that call fails, everything gracefully falls back to the deterministic
  // tag-matching ranker below.
  aiPersonalization: true,
};

const CATS = ["All", "Cafés", "Bars", "Food", "Culture", "Outdoors", "Music", "Shops"];
const TINT = {
  "Cafés": "oklch(0.9 0.055 70)",
  "Bars": "oklch(0.89 0.06 22)",
  "Food": "oklch(0.9 0.07 48)",
  "Culture": "oklch(0.9 0.045 305)",
  "Outdoors": "oklch(0.9 0.06 145)",
  "Music": "oklch(0.89 0.06 32)",
  "Shops": "oklch(0.91 0.05 92)",
};

const LIKE_MASTER = ["Live music", "Street food", "Museums", "Hidden bars", "Local markets", "Architecture", "Coffee shops", "Parks & gardens", "Art galleries", "Rooftop views", "Bookshops", "Nightlife", "History", "Craft beer", "Vintage shops", "Street art", "Fine dining", "Late nights", "Quiet spots", "People watching"];
const DISLIKE_MASTER = ["Tourist traps", "Loud crowds", "Chain restaurants", "Long queues", "Shopping malls", "Sports bars", "Fast food", "Karaoke", "Casinos", "Party hostels", "Early mornings", "Guided tours", "Theme parks"];
const PERIODS = [["morning", "6–12"], ["afternoon", "12–17"], ["evening", "17–22"], ["late night", "22–late"]];

// ---------- shared style fragments ----------
const S = {
  screen: { position: "absolute", inset: 0, paddingTop: 54, display: "flex", flexDirection: "column" },
  backBtn: { cursor: "pointer", background: "none", border: "none", padding: "8px 0", display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "'DM Mono'", fontWeight: 500, fontSize: 13, letterSpacing: "0.08em", color: "#ec6a1f", textTransform: "uppercase" },
  primaryBtn: { width: "100%", cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 17, padding: 16, borderRadius: 18 },
  sheetFooter: { padding: "14px 26px calc(20px + env(safe-area-inset-bottom))", borderTop: "1px solid #f0e8da", background: "#fffdf8" },
};

function BackArrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>;
}

class App extends React.Component {
  constructor(props) {
    super(props);
    const saved = this.load();
    const now = new Date();
    this.coords = saved.coords || null;
    this.state = {
      screen: "home",
      likes: saved.likes || ["Coffee shops", "Hidden bars", "Architecture", "Local markets", "History", "Quiet spots"],
      dislikes: saved.dislikes || ["Tourist traps", "Loud crowds", "Chain restaurants", "Long queues"],
      location: saved.location || "",
      walkMins: saved.walkMins || CONFIG.defaultWalkMins,
      period: saved.period || this.periodForHour(now.getHours()),
      clock: now,
      category: "All",
      view: "list",
      routing: false,
      route: [],
      recs: null,
      recsIntro: "",
      recsLoading: false,
      recsError: null,
      replacing: false,
      selected: null,
      editor: null,
      locDraft: "",
      walkDraft: 20,
      mapSel: null,
      whats: "intro",
      whatsResult: null,
      whatsPhoto: null,
      camError: null,
      loadingText: "Finding the good stuff nearby…",
    };
    this.PLACES = [];
  }

  componentDidMount() {
    this.timer = setInterval(() => this.setState({ clock: new Date() }), 30000);
  }
  componentWillUnmount() {
    clearInterval(this.timer);
    this.stopCam();
    if (this._map) { this._map.remove(); this._map = null; }
  }
  componentDidUpdate(pp, ps) {
    if (this._map) {
      const s = this.state;
      if (ps.recs !== s.recs || ps.category !== s.category || ps.route !== s.route || ps.routing !== s.routing || ps.mapSel !== s.mapSel) {
        this.renderMarkers();
      }
    }
  }

  // ---------- persistence ----------
  load() { try { return JSON.parse(localStorage.getItem("funfinder.v2")) || {}; } catch (e) { return {}; } }
  save() {
    const s = this.state;
    const data = { likes: s.likes, dislikes: s.dislikes, location: s.location, walkMins: s.walkMins, period: s.period, coords: this.coords };
    try { localStorage.setItem("funfinder.v2", JSON.stringify(data)); } catch (e) {}
  }

  // ---------- time helpers ----------
  periodForHour(h) { if (h < 12) return "morning"; if (h < 17) return "afternoon"; if (h < 22) return "evening"; return "late night"; }
  fmtTime(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  weekday(d) { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()]; }

  // ---------- geo helpers ----------
  distMeters(a, b, c, d) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(c - a), dLon = toR(d - b);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  cap(x) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }

  classify(t) {
    const a = t.amenity, to = t.tourism, l = t.leisure, h = t.historic, sh = t.shop, w = t.waterway;
    if (a === "cafe" || a === "ice_cream") return { category: "Cafés", type: a === "ice_cream" ? "Ice cream" : "Café", tags: ["Coffee shops", "Quiet spots"] };
    if (a === "bar" || a === "pub" || a === "biergarten") return { category: "Bars", type: a === "pub" ? "Pub" : "Bar", tags: ["Hidden bars", "Nightlife", "Craft beer"] };
    if (a === "nightclub") return { category: "Music", type: "Nightclub", tags: ["Nightlife", "Live music", "Late nights"] };
    if (a === "restaurant") return { category: "Food", type: "Restaurant", tags: ["Fine dining", "Street food"] };
    if (a === "fast_food" || a === "food_court") return { category: "Food", type: "Casual eats", tags: ["Street food"] };
    if (a === "marketplace") return { category: "Food", type: "Market", tags: ["Local markets", "Street food", "People watching"] };
    if (a === "theatre" || a === "arts_centre") return { category: "Culture", type: "Theatre", tags: ["Live music", "History"] };
    if (a === "cinema") return { category: "Culture", type: "Cinema", tags: ["Nightlife"] };
    if (a === "place_of_worship") return { category: "Culture", type: this.cap(t.building && t.building !== "yes" ? t.building : "Place of worship"), tags: ["History", "Architecture", "Quiet spots"] };
    if (to === "museum") return { category: "Culture", type: "Museum", tags: ["Museums", "History", "Art galleries"] };
    if (to === "gallery" || to === "artwork") return { category: "Culture", type: to === "artwork" ? "Public art" : "Gallery", tags: ["Art galleries", "Street art"] };
    if (to === "viewpoint") return { category: "Outdoors", type: "Viewpoint", tags: ["Rooftop views", "Quiet spots"] };
    if (to === "attraction" || to === "theme_park" || to === "zoo" || to === "aquarium") return { category: "Culture", type: this.cap(to.replace(/_/g, " ")), tags: ["People watching", "History"] };
    if (l === "park" || l === "garden" || l === "nature_reserve") return { category: "Outdoors", type: l === "garden" ? "Garden" : "Park", tags: ["Parks & gardens", "Quiet spots", "People watching"] };
    if (l === "marina") return { category: "Outdoors", type: "Marina", tags: ["Quiet spots", "People watching"] };
    if (w === "river" || w === "canal") return { category: "Outdoors", type: w === "canal" ? "Canal walk" : "River walk", tags: ["Parks & gardens", "Quiet spots", "People watching"] };
    if (h) return { category: "Culture", type: this.cap(String(h).replace(/_/g, " ")), tags: ["History", "Architecture", "Quiet spots"] };
    if (sh === "books") return { category: "Shops", type: "Bookshop", tags: ["Bookshops", "Quiet spots"] };
    if (sh === "art") return { category: "Shops", type: "Art shop", tags: ["Art galleries", "Vintage shops"] };
    if (sh === "music") return { category: "Shops", type: "Record shop", tags: ["Vintage shops", "Nightlife"] };
    if (sh === "bakery" || sh === "chocolate" || sh === "deli") return { category: "Shops", type: this.cap(sh), tags: ["Local markets", "Street food"] };
    if (sh) return { category: "Shops", type: "Shop", tags: ["Vintage shops", "Local markets"] };
    return { category: "Culture", type: "Spot", tags: ["People watching"] };
  }

  // Relayed through api/places.js (which races several Overpass mirrors
  // server-side) rather than calling Overpass directly from the browser.
  // Direct-from-phone calls kept failing in ways that couldn't be
  // reproduced or diagnosed from here; routing through our own backend
  // means a future failure can be reproduced by hitting that endpoint
  // directly instead of being invisible.
  async fetchOverpass(query) {
    const res = await fetch("/api/places", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); if (j.detail) detail = " (" + j.detail.join("; ") + ")"; } catch (e) {}
      throw new Error("places " + res.status + detail);
    }
    return await res.json();
  }

  async fetchPlaces(lat, lon) {
    const R = Math.min(3500, Math.max(400, Math.round(this.state.walkMins * 85)));
    const q = `[out:json][timeout:25];(` +
      `nwr["amenity"~"^(cafe|bar|pub|biergarten|restaurant|fast_food|ice_cream|marketplace|theatre|cinema|arts_centre|nightclub|place_of_worship)$"]["name"](around:${R},${lat},${lon});` +
      `nwr["tourism"~"^(museum|gallery|artwork|attraction|viewpoint|zoo|aquarium|theme_park)$"]["name"](around:${R},${lat},${lon});` +
      `nwr["leisure"~"^(park|garden|nature_reserve|marina)$"]["name"](around:${R},${lat},${lon});` +
      `nwr["historic"]["name"](around:${R},${lat},${lon});` +
      `nwr["shop"~"^(books|art|music|gift|craft|antiques|second_hand|clothes|deli|chocolate|florist|department_store|variety_store|jewelry|bakery)$"]["name"](around:${R},${lat},${lon});` +
      `nwr["waterway"~"^(river|canal)$"]["name"](around:${R},${lat},${lon});` +
      `);out center 400;`;
    const json = await this.fetchOverpass(q);
    const seen = new Set();
    const out = [];
    for (const el of (json.elements || [])) {
      const t = el.tags; if (!t || !t.name) continue;
      const plat = el.lat != null ? el.lat : (el.center && el.center.lat);
      const plon = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (plat == null || plon == null) continue;
      const key = t.name.toLowerCase();
      if (seen.has(key)) continue;
      const meters = this.distMeters(lat, lon, plat, plon);
      const walkMins = Math.max(1, Math.round(meters / 80));
      const cl = this.classify(t);
      seen.add(key);
      out.push({
        id: el.type + "/" + el.id,
        name: t.name,
        category: cl.category,
        type: cl.type,
        tags: cl.tags,
        walkMins, meters,
        lat: plat, lon: plon,
        area: t["addr:suburb"] || t["addr:neighbourhood"] || t["addr:city"] || "",
        hoursLabel: t.opening_hours || "",
        caption: cl.type.toLowerCase(),
        blurb: t.description || "",
        website: t.website || t["contact:website"] || "",
        wiki: t.wikipedia || "",
      });
    }
    out.sort((a, b) => a.meters - b.meters);
    return out.slice(0, 60);
  }

  // Relayed through api/geocode.js rather than calling Nominatim directly
  // from the browser — the same missing-User-Agent issue already found
  // with Overpass (see api/places.js) applies here too, since Nominatim's
  // usage policy also requires one.
  async reverseGeocode(lat, lon) {
    const r = await fetch("/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "reverse", lat, lon }),
    });
    const j = await r.json();
    const a = j.address || {};
    const name = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.town || a.village || a.city || a.county || "Your location";
    const city = a.city || a.town || a.village || a.county || "";
    return city && name !== city ? `${name}, ${city}` : name;
  }
  async geocode(query) {
    const r = await fetch("/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "search", query }),
    });
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return null;
    const hit = j[0];
    const a = hit.address || {};
    const name = a.neighbourhood || a.suburb || a.city || a.town || a.village || (hit.display_name || query).split(",")[0];
    const city = a.city || a.town || a.village || "";
    return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), name: city && name !== city ? `${name}, ${city}` : name };
  }
  // Geocodes a place NAME scoped near a given point (via api/geocode.js's
  // bounded viewbox), used to turn Claude's free-text recommendations back
  // into map coordinates without accidentally matching a same-named place
  // in a different town.
  async geocodeNear(name, lat, lon) {
    try {
      const r = await fetch("/api/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "search", query: name, lat, lon }),
      });
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) return null;
      return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
    } catch (e) { return null; }
  }
  // Turns Claude's named picks ({name, category, type, text}) into full
  // place objects with real coordinates, by geocoding each one near the
  // user's location and computing the actual walking distance ourselves
  // rather than trusting Claude's own sense of distance. Drops anything
  // that geocodes wildly further away than asked for (a likely mismatch
  // to a same-named place) or that fails to geocode at all.
  async geocodePicks(picks) {
    if (!this.coords) return [];
    const { lat, lon } = this.coords;
    const maxWalk = Math.max(this.state.walkMins * 2.5, 30);
    const results = await Promise.allSettled(picks.map(async pk => {
      if (!pk || !pk.name) return null;
      const g = await this.geocodeNear(pk.name, lat, lon);
      if (!g) return null;
      const meters = this.distMeters(lat, lon, g.lat, g.lon);
      const walkMins = Math.max(1, Math.round(meters / 80));
      if (walkMins > maxWalk) return null;
      const category = CATS.includes(pk.category) ? pk.category : "Culture";
      const type = pk.type || category;
      return {
        id: "geo/" + encodeURIComponent(pk.name.toLowerCase()),
        name: pk.name, category, type, tags: [],
        walkMins, meters, lat: g.lat, lon: g.lon, area: "",
        hoursLabel: "", caption: type.toLowerCase(), blurb: "", website: "", wiki: "",
        text: pk.text || "",
      };
    }));
    return results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
  }

  // ---------- top-level flow ----------
  onUseLocation() {
    if (this.PLACES.length && this.coords) { this.buildRecs(); return; }
    this.locateAndFetch();
  }
  locateAndFetch() {
    this.setState({ screen: "recs", recsLoading: true, recsError: null, recs: null, view: "list", mapSel: null, route: [], routing: false, loadingText: "Finding where you are…" });
    if (!navigator.geolocation) { this.geoFail(); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        this.coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        try { const nm = await this.reverseGeocode(this.coords.lat, this.coords.lon); this.setState({ location: nm }); } catch (e) {}
        this.save();
        this.fetchThenRecs();
      },
      () => this.geoFail(),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }
  geoFail() {
    this.setState({ recsLoading: false, recsError: "Couldn't get your location — allow location access, or type where you are. (Location needs a secure https connection.)" });
  }
  async fetchThenRecs() {
    if (!this.coords) { this.geoFail(); return; }
    this.setState({ recsLoading: true, recsError: null, loadingText: "Looking for good things nearby…" });
    try {
      const places = await this.fetchPlaces(this.coords.lat, this.coords.lon);
      this.PLACES = places;
      if (!places.length) {
        this.setState({ recsLoading: false, recsError: "Nothing much turned up within your walking range. Try widening the distance or another spot." });
        return;
      }
      this.buildRecs();
    } catch (e) {
      console.warn("fetch places failed", e);
      this.setState({ recsLoading: false, recsError: "Couldn't reach the places service. Check your connection and try again." });
    }
  }

  // ---------- navigation ----------
  back() { this.setState({ screen: "home", editor: null, selected: null }); }

  // ---------- route building ----------
  toggleRoute() { this.setState(s => ({ routing: !s.routing, mapSel: null })); }
  addToRoute(p) {
    this.setState(s => {
      const has = s.route.includes(p.id);
      return { route: has ? s.route.filter(x => x !== p.id) : [...s.route, p.id] };
    });
  }
  clearRoute() { this.setState({ route: [] }); }
  startRoute() {
    const places = this.state.route.map(id => this.PLACES.find(p => p.id === id)).filter(Boolean);
    if (!places.length) return;
    // Apple Maps' web link doesn't support multi-stop routes the way Google
    // Maps' does, but it's the one link iOS reliably hands off to the native
    // Maps app instead of loading as a page (see mapsUrl() below) — so we
    // send the first unvisited stop; the app's own route panel still shows
    // the full ordered list to work through.
    window.open(this.mapsUrl(places[0].lat, places[0].lon), "_blank");
  }

  // Opens Apple Maps for walking directions. Using maps.apple.com (a
  // universal link iOS intercepts before ever loading it as a webpage) — not
  // Google Maps — matters specifically because this app is usually run from
  // the iOS home screen as a standalone web app, which has no tabs and no
  // back button. A plain web link (Google Maps included) would just
  // navigate the whole app away in place with no way back; this hands off
  // to the native Maps app instead and leaves the app untouched underneath.
  mapsUrl(lat, lon) {
    return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
  }

  // ---------- preferences ----------
  toggle(kind, label) {
    this.setState(s => {
      const arr = s[kind].includes(label) ? s[kind].filter(x => x !== label) : [...s[kind], label];
      return { [kind]: arr };
    }, () => this.save());
  }

  // ---------- recommendations ----------
  eligible() {
    const within = this.PLACES.filter(p => p.walkMins <= this.state.walkMins);
    return within.length >= 5 ? within : [...this.PLACES].sort((a, b) => a.walkMins - b.walkMins).slice(0, Math.min(8, this.PLACES.length));
  }
  matchScore(p) {
    const L = this.state.likes, D = this.state.dislikes;
    let s = 0;
    p.tags.forEach(t => { if (L.includes(t)) s += 2; if (D.includes(t)) s -= 3; });
    return s;
  }
  fallbackRecs() {
    const ranked = this.eligible()
      .map(p => ({ p, score: this.matchScore(p) }))
      .sort((a, b) => (b.score - a.score) || (a.p.walkMins - b.p.walkMins))
      .slice(0, 5);
    return ranked.map(({ p }) => {
      const text = p.blurb || `${p.type}${p.area ? " in " + p.area : ""}, about ${p.walkMins} min on foot.`;
      return { ...p, text };
    });
  }

  // Photo lookup, tried cheapest-first: Wikipedia's summary API is free, no
  // key, CORS-enabled for direct browser calls — but only covers places
  // notable enough to have a wikipedia= tag in OSM. For everything else we
  // fall back to Google Places Photos (via api/photo.js, which holds the
  // key server-side and needs GOOGLE_PLACES_API_KEY set on Vercel) — much
  // broader coverage, including ordinary local shops and pubs, at a small
  // per-lookup cost. Only called for the final picks, not the whole
  // candidate list, so it stays fast and keeps the cost down.
  async fetchWikiPhoto(wiki) {
    try {
      const i = wiki.indexOf(":");
      const lang = i === -1 ? "en" : wiki.slice(0, i);
      const title = i === -1 ? wiki : wiki.slice(i + 1);
      if (!title) return null;
      const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!r.ok) return null;
      const j = await r.json();
      return (j.thumbnail && j.thumbnail.source) || null;
    } catch (e) { return null; }
  }
  async fetchGooglePhoto(name, lat, lon) {
    try {
      const r = await fetch("/api/photo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, lat, lon }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.photo || null;
    } catch (e) { return null; }
  }
  async attachPhotos(places) {
    const results = await Promise.allSettled(places.map(async p => {
      const photo = (p.wiki && await this.fetchWikiPhoto(p.wiki)) || await this.fetchGooglePhoto(p.name, p.lat, p.lon);
      return photo ? { id: p.id, photo } : null;
    }));
    const photos = Object.fromEntries(results.filter(r => r.status === "fulfilled" && r.value).map(r => [r.value.id, r.value.photo]));
    if (!Object.keys(photos).length) return;
    this.setState(s => ({ recs: s.recs ? s.recs.map(p => photos[p.id] ? { ...p, photo: photos[p.id] } : p) : s.recs }));
  }

  // "Tell me more" on the detail sheet: fetches a genuinely detailed,
  // multi-paragraph write-up for one specific place (history, what
  // survives, practical visiting notes), replacing the short list-view
  // line. Reuses /api/recommend since it just forwards any prompt to
  // Claude — this one asks for plain prose, not the JSON shape buildRecs()
  // uses. Result is cached onto both the open detail sheet and the
  // matching card in recs, so re-opening it later doesn't re-fetch.
  async expandPlace(place) {
    if (place.expanded || place.expanding) return;
    const loc = this.state.location || "this area";
    const patch = (upd) => this.setState(st => ({
      selected: st.selected && st.selected.id === place.id ? { ...st.selected, ...upd } : st.selected,
      recs: st.recs ? st.recs.map(p => p.id === place.id ? { ...p, ...upd } : p) : st.recs,
    }));
    patch({ expanding: true, expandError: false });
    const prompt = `Write a genuinely informative description of "${place.name}" (a ${place.type}) near ${loc}. 2-4 short paragraphs of real, specific prose: history or origin, what actually survives or is there today, and anything practically useful to know (access, opening days, ownership) if relevant. Plain prose only — no headings, no bullet points, no markdown, no meta-commentary about the search itself, and don't just repeat the place's name as an opener. If you don't have reliable specific knowledge of this exact place, say so plainly in one short line rather than inventing detail.`;
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error("expand failed: " + res.status);
      const { raw } = await res.json();
      patch({ text: (raw || "").trim(), expanding: false, expanded: true });
    } catch (e) {
      console.warn("expandPlace failed", e);
      patch({ expanding: false, expandError: true });
    }
  }

  async buildRecs() {
    this.setState({ screen: "recs", recsLoading: true, recsError: null, recs: null, recsIntro: "", selected: null, category: "All", route: [], routing: false, mapSel: null, loadingText: "Picking your 5 best…" });
    if (!CONFIG.aiPersonalization) {
      setTimeout(() => {
        const recs = this.fallbackRecs();
        this.setState({ recs, recsLoading: false });
        this.attachPhotos(recs);
      }, 400);
      return;
    }

    const s = this.state;
    // Deliberately NOT restricted to the map-data candidate list (this.PLACES)
    // the way this used to work — that approach could only ever surface what
    // happened to be tagged in a matching way in OpenStreetMap, which kept
    // missing genuinely famous local landmarks. Claude is asked directly,
    // with web search enabled server-side, for real knowledge of the area;
    // its picks are geocoded afterwards (see geocodePicks) purely to get map
    // coordinates for the UI.
    //
    // Kept deliberately minimal for now — no time-of-day/opening-hours
    // awareness, no likes/dislikes personalization, no "mix of categories"
    // steering. Each of those added real prompt complexity and each caused
    // its own bug (personalization silently vetoing famous landmarks, the
    // category-mix quota distorting or burying the obvious #1 pick) without
    // a clear win in return. Simplest version first; re-add whichever of
    // those earns its keep once this baseline is confirmed fast and reliable.
    const prompt = `List the 7 most interesting real things to see or do within about ${s.walkMins} minutes' walk of ${s.location || "this location"}, ranked best-first. Use real, current knowledge, including web search if it helps.

For each, give:
- "name": exact, correctly-spelled real name (needed to look it up on a map afterwards)
- "category": exactly one of ${CATS.filter(c => c !== "All").join(", ")}
- "type": a short 1-3 word label, e.g. "Pier", "Museum", "Pub"
- "text": ONE short, factual sentence describing it, e.g. "12th-century motte-and-bailey ruin with a striking keep, right in town."

Return ONLY this JSON shape, no markdown fences:
{"intro":"one short sentence setting up the answer, no place names in it","places":[{"name":"...","category":"...","type":"...","text":"..."}]} — exactly 7 entries in "places" (the top 5 will
be used, plus 2 spares in case any fail to look up on a map afterwards).`;

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error("recommend request failed: " + res.status);
      const { raw } = await res.json();
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : raw);
      const picks = Array.isArray(parsed.places) ? parsed.places : [];
      // Ask for 7 ranked candidates but only geocode as many as needed to
      // reach 5, in rank order, so a couple of failed lookups don't
      // silently shrink the list — falls back only if fewer than 3 of the
      // ranked candidates work out at all.
      const recs = [];
      for (const pick of picks) {
        if (recs.length >= 5) break;
        const [geocoded] = await this.geocodePicks([pick]);
        if (geocoded) recs.push(geocoded);
      }
      if (recs.length < 3) throw new Error("too few after geocoding");
      this.setState({ recs, recsIntro: parsed.intro || "", recsLoading: false });
      this.attachPhotos(recs);
    } catch (e) {
      console.warn("AI recs failed, using fallback", e);
      const recs = this.fallbackRecs();
      this.setState({ recs, recsIntro: "", recsLoading: false });
      this.attachPhotos(recs);
    }
  }

  // Drops a disliked recommendation and fetches exactly one replacement,
  // keeping the list at 5. Asks Claude directly (same reasoning as
  // buildRecs() above) rather than restricting it to leftover map-data
  // candidates; falls back to the deterministic tag-matching pick from the
  // map-data pool (this.eligible()) if that fails.
  async replaceRec(placeId) {
    const s = this.state;
    const outgoing = (s.recs || []).find(p => p.id === placeId);
    const kept = (s.recs || []).filter(p => p.id !== placeId);
    this.setState({ recs: kept, replacing: true });

    const finish = (pick) => {
      this.setState(st => ({ recs: [...(st.recs || []), pick], replacing: false }));
      this.attachPhotos([pick]);
    };
    const bestFallback = () => {
      const usedIds = new Set(kept.map(p => p.id));
      if (outgoing) usedIds.add(outgoing.id);
      const candidates = this.eligible().filter(p => !usedIds.has(p.id));
      const ranked = candidates.map(p => ({ p, score: this.matchScore(p) })).sort((a, b) => (b.score - a.score) || (a.p.walkMins - b.p.walkMins));
      const next = ranked[0] && ranked[0].p;
      return next ? { ...next, text: next.blurb || `${next.type}${next.area ? " in " + next.area : ""}, about ${next.walkMins} min on foot.` } : null;
    };

    if (!CONFIG.aiPersonalization || !this.coords) {
      const pick = bestFallback();
      if (pick) finish(pick); else this.setState({ replacing: false });
      return;
    }

    const prompt = `Already recommended, within about ${s.walkMins} minutes' walk of ${s.location || "this area"}: ${kept.map(p => p.name).join(", ") || "nothing yet"}.
${outgoing ? `They didn't want "${outgoing.name}" (a ${outgoing.type}) — if a genuinely good option exists, prefer something different in kind from it.` : ""}

Use real, current knowledge of this specific area, including web search if it helps. Pick the
SINGLE most interesting genuine place to add to the list above, within about ${s.walkMins}
minutes' walk. Don't repeat anything already recommended.
Give "name" (exact, correctly-spelled real name), "category" (exactly one of ${CATS.filter(c => c !== "All").join(", ")}),
"type" (short 1-3 word label), and "text" (ONE short, factual, information-dense sentence in this
register: "12th-century motte-and-bailey ruin with a striking keep, right in town." No "right up
your street" framing, don't talk to them ("you")).
Return ONLY this JSON shape, no markdown fences: {"name":"...","category":"...","type":"...","text":"..."}`;

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error("replace request failed: " + res.status);
      const { raw } = await res.json();
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : raw);
      const recs = await this.geocodePicks([parsed]);
      if (!recs.length) throw new Error("geocode failed");
      finish(recs[0]);
    } catch (e) {
      console.warn("replaceRec failed, using fallback", e);
      const pick = bestFallback();
      if (pick) finish(pick); else this.setState({ replacing: false });
    }
  }

  // ---------- camera ----------
  videoRef = (el) => {
    this._video = el;
    if (el) {
      el.muted = true; el.playsInline = true;
      el.setAttribute("playsinline", ""); el.setAttribute("autoplay", "");
      if (this._stream) { el.srcObject = this._stream; el.play().catch(() => {}); }
    }
  };
  async openCamera() {
    this.setState({ whats: "camera", whatsResult: null, whatsPhoto: null, camError: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      this._stream = stream;
      if (this._video) { this._video.srcObject = stream; this._video.play().catch(() => {}); }
    } catch (e) {
      this.stopCam();
      this.setState({ whats: "intro", camError: "Camera unavailable — allow camera access. (Camera needs a secure https connection.)" });
    }
  }
  stopCam() { if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; } }
  capturePhoto() {
    const v = this._video;
    let url = null;
    if (v && v.videoWidth) {
      const cv = document.createElement("canvas");
      cv.width = v.videoWidth; cv.height = v.videoHeight;
      cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
      url = cv.toDataURL("image/jpeg", 0.8);
    }
    this.stopCam();
    this.setState({ whats: "loading", whatsPhoto: url });
    this.identifyPhoto(url);
  }
  // Sends the captured photo to our own /api/identify endpoint (a small
  // server-side function — see api/identify.js) which forwards it to
  // Claude's vision API. The API key never touches the browser.
  async identifyPhoto(photoDataUrl) {
    const loc = this.state.location || "your area";
    const fallback = {
      title: "Couldn't identify that",
      type: "No result",
      blurb: "The scan didn't come back with a clear answer. Try a closer, better-lit photo of the thing you're curious about.",
      facts: ["Point at a building, dish, statue or sign.", "Good lighting and a steady shot help a lot.", "You can always try again."],
    };
    if (!photoDataUrl) { this.setState({ whats: "result", whatsResult: fallback }); return; }
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: photoDataUrl, location: loc }),
      });
      if (!res.ok) throw new Error("identify request failed: " + res.status);
      const r = await res.json();
      if (!r.title || !Array.isArray(r.facts)) throw new Error("unexpected response shape");
      this.setState({ whats: "result", whatsResult: r });
    } catch (e) {
      console.warn("identifyPhoto failed", e);
      this.setState({ whats: "result", whatsResult: fallback });
    }
  }

  // ---------- filters (location / time / walk distance) ----------
  openFilters() {
    this.setState({ editor: "filters", locDraft: this.state.location, walkDraft: this.state.walkMins });
  }
  useGpsFromEditor() {
    this.setState({ editor: null });
    this.coords = null; this.PLACES = [];
    this.locateAndFetch();
  }
  applyFilters() {
    const q = (this.state.locDraft || "").trim();
    const locationChanged = q && q !== this.state.location;
    const walkChanged = this.state.walkDraft !== this.state.walkMins;
    this.setState({ editor: null, walkMins: this.state.walkDraft }, () => {
      this.save();
      if (locationChanged) this.geocodeThenFetch(q);
      else if (walkChanged) this.fetchThenRecs();
      else this.buildRecs();
    });
  }
  async geocodeThenFetch(q) {
    this.setState({ screen: "recs", recsLoading: true, recsError: null, recs: null, view: "list", loadingText: "Finding that place…" });
    try {
      const g = await this.geocode(q);
      if (!g) { this.setState({ recsLoading: false, recsError: "Couldn't find that place. Try a more specific name." }); return; }
      this.coords = { lat: g.lat, lon: g.lon };
      this.PLACES = [];
      this.setState({ location: g.name || q }, () => this.save());
      this.fetchThenRecs();
    } catch (e) {
      this.setState({ recsLoading: false, recsError: "Location lookup failed. Try again." });
    }
  }

  // ---------- leaflet map ----------
  setMapEl = (el) => {
    if (!el) { if (this._map) { this._map.remove(); this._map = null; this._layer = null; } return; }
    if (this._map) return;
    this._mapEl = el;
    this.initMap();
  };
  initMap() {
    if (!window.L) { this._mapWait = (this._mapWait || 0) + 1; if (this._mapWait < 40) setTimeout(() => this.initMap(), 150); return; }
    if (!this._mapEl || this._map) return;
    const c = this.coords || { lat: 41.3851, lon: 2.1734 };
    this._map = window.L.map(this._mapEl, { zoomControl: false, attributionControl: true }).setView([c.lat, c.lon], 15);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19, attribution: "© OpenStreetMap © CARTO" }).addTo(this._map);
    setTimeout(() => { if (this._map) this._map.invalidateSize(); }, 120);
    this.renderMarkers();
  }
  renderMarkers() {
    const L = window.L;
    if (!this._map || !L) return;
    if (this._layer) this._layer.remove();
    this._layer = L.layerGroup().addTo(this._map);
    const accent = CONFIG.accentColor;
    const s = this.state;
    if (this.coords) {
      L.marker([this.coords.lat, this.coords.lon], { icon: L.divIcon({ className: "", html: `<div style="width:18px;height:18px;border-radius:50%;background:#2a6fdb;border:3px solid #fff;box-shadow:0 0 0 5px rgba(42,111,219,0.22);"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(this._layer);
    }
    const allRecs = s.recs || [];
    const filtered = s.category === "All" ? allRecs : allRecs.filter(p => p.category === s.category);
    const routeMode = s.routing;
    const bounds = [];
    if (this.coords) bounds.push([this.coords.lat, this.coords.lon]);
    filtered.forEach(p => {
      const rank = allRecs.indexOf(p) + 1;
      const routeIdx = s.route.indexOf(p.id);
      const inRoute = routeIdx >= 0;
      const hl = routeMode ? inRoute : (s.mapSel && s.mapSel.id === p.id);
      const size = hl ? 38 : 30;
      const bg = hl ? accent : (routeMode ? "#8a8275" : "#17171f");
      const label = routeMode ? (inRoute ? String(routeIdx + 1) : "+") : String(rank);
      const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:${hl ? 3 : 2.5}px solid #fffdf8;box-shadow:0 6px 14px -4px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:'Fredoka',sans-serif;font-weight:600;font-size:${hl ? 15 : 13}px;color:#fffdf8;">${label}</div>`;
      const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: hl ? 1000 : 0 }).addTo(this._layer);
      m.on("click", () => routeMode ? this.addToRoute(p) : this.setState({ mapSel: p }));
      bounds.push([p.lat, p.lon]);
    });
    if (routeMode) {
      const pts = s.route.map(id => allRecs.find(p => p.id === id)).filter(Boolean).map(p => [p.lat, p.lon]);
      if (pts.length >= 2) L.polyline(pts, { color: accent, weight: 3.5, dashArray: "2 9", lineCap: "round" }).addTo(this._layer);
    }
    if (!this._fitted && bounds.length >= 2) {
      try { this._map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 }); this._fitted = true; } catch (e) {}
    }
  }

  // ---------- style helpers ----------
  chipStyle(active, tone) {
    const base = { cursor: "pointer", fontFamily: "'Hanken Grotesk'", fontWeight: 600, fontSize: 14, padding: "9px 15px", borderRadius: 22, borderWidth: 1, borderStyle: "solid" };
    if (active && tone === "like") return { ...base, background: "#ec6a1f", color: "#fffdf8", borderColor: "#ec6a1f" };
    if (active && tone === "dislike") return { ...base, background: "#17171f", color: "#fffdf8", borderColor: "#17171f" };
    return { ...base, background: "#f6efe3", color: "#8a8275", borderColor: "#ece3d3" };
  }
  tabStyle(active) {
    const base = { cursor: "pointer", flexShrink: 0, fontFamily: "'DM Mono'", fontWeight: 500, fontSize: 13, padding: "8px 15px", borderRadius: 20, borderWidth: 1, borderStyle: "solid" };
    return active ? { ...base, background: "#17171f", color: "#fffdf8", borderColor: "#17171f" } : { ...base, background: "#fffdf8", color: "#8a8275", borderColor: "#eadfce" };
  }
  toggleBtnStyle(active) {
    const base = { cursor: "pointer", border: "none", height: 32, padding: "0 13px", borderRadius: 15, display: "flex", alignItems: "center", gap: 6, fontFamily: "'DM Mono'", fontWeight: 500, fontSize: 12.5 };
    return active ? { ...base, background: "#fffdf8", color: "#17171f" } : { ...base, background: "transparent", color: "#b7ab9b" };
  }
  imgBg(cat) { const t = TINT[cat] || "oklch(0.9 0.05 70)"; return `linear-gradient(150deg, ${t}, oklch(0.86 0.04 60))`; }

  // ---------- render ----------
  cardFor(p, i) {
    return {
      ...p,
      rank: i + 1,
      imgBg: this.imgBg(p.category),
      metaLine: `${p.category} · ${p.walkMins} min walk${p.area ? " · " + p.area : ""}`,
      walkLabel: `${p.walkMins} min walk`,
      categoryLabel: p.category,
      typeArea: p.area ? `${p.type} · ${p.area}` : p.type,
      hasHours: !!p.hoursLabel,
      onClick: () => this.setState({ selected: p }),
      directions: (e) => { if (e && e.stopPropagation) e.stopPropagation(); const url = p.lat != null ? this.mapsUrl(p.lat, p.lon) : `https://maps.apple.com/?daddr=${encodeURIComponent(p.name)}&dirflg=w`; window.open(url, "_blank"); },
    };
  }

  render() {
    const s = this.state;
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, background: "radial-gradient(120% 120% at 50% 0%, #efe7da 0%, #e3d8c5 100%)" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 428, height: "100dvh", maxHeight: 924, background: "#fffdf8", overflow: "hidden", boxShadow: "0 40px 90px -30px rgba(40,28,12,0.45)" }}>
          {this.renderStatusBar()}
          {s.screen === "home" && this.renderHome()}
          {s.screen === "about" && this.renderAbout()}
          {s.screen === "whats" && this.renderWhats()}
          {s.screen === "recs" && this.renderRecs()}
          {s.selected && this.renderDetailSheet()}
          {s.editor && this.renderEditorSheet()}
        </div>
      </div>
    );
  }

  renderStatusBar() {
    return (
      <React.Fragment>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 54, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", fontFamily: "'Hanken Grotesk'", fontWeight: 700, fontSize: 15, color: "#1a1a22", pointerEvents: "none" }}>
          <span>{this.fmtTime(this.state.clock)}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="18" height="12" viewBox="0 0 18 12" fill="none"><rect x="0" y="7" width="3" height="5" rx="1" fill="#1a1a22" /><rect x="5" y="4.5" width="3" height="7.5" rx="1" fill="#1a1a22" /><rect x="10" y="2" width="3" height="10" rx="1" fill="#1a1a22" /><rect x="15" y="0" width="3" height="12" rx="1" fill="#1a1a22" opacity="0.35" /></svg>
            <svg width="17" height="12" viewBox="0 0 17 12" fill="none"><path d="M8.5 2.4c2 0 3.9.75 5.3 2.05l1.2-1.25A9.4 9.4 0 0 0 8.5.4 9.4 9.4 0 0 0 2 3.2l1.2 1.25A7.6 7.6 0 0 1 8.5 2.4Z" fill="#1a1a22" /><path d="M8.5 6.1c1 0 1.95.4 2.65 1.05l1.2-1.25a6 6 0 0 0-7.7 0l1.2 1.25A3.75 3.75 0 0 1 8.5 6.1Z" fill="#1a1a22" /><circle cx="8.5" cy="9.7" r="1.7" fill="#1a1a22" /></svg>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}><div style={{ width: 24, height: 12, border: "1.6px solid rgba(26,26,34,0.4)", borderRadius: 3.5, padding: 1.6 }}><div style={{ width: "41%", height: "100%", background: "#1a1a22", borderRadius: 1.5 }} /></div><div style={{ width: 1.6, height: 4, background: "rgba(26,26,34,0.4)", borderRadius: 2 }} /></div>
          </div>
        </div>
        <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 118, height: 30, background: "#14141b", borderRadius: "0 0 18px 18px", zIndex: 41 }} />
      </React.Fragment>
    );
  }

  renderHome() {
    return (
      <div style={{ position: "absolute", inset: 0, padding: "74px 30px 30px", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <h1 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 40, lineHeight: 1.04, letterSpacing: "-0.01em", color: "#1a1a22", margin: "0 0 40px", textWrap: "balance" }}>What's interesting<br />to see,<br />right here?</h1>
          <button className="press" style={{ "--press-scale": 0.97, border: "none", cursor: "pointer", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 18, padding: "19px 34px", borderRadius: 20, boxShadow: "0 14px 30px -12px rgba(23,23,31,0.6)", display: "inline-flex", alignItems: "center", gap: 10 }} onClick={() => this.onUseLocation()}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" /><circle cx="12" cy="10" r="2.6" /></svg>
            Use my location
          </button>
          <div style={{ fontFamily: "'DM Mono'", fontSize: 11.5, color: "#a89f90", marginTop: 14, letterSpacing: "0.02em" }}>Real places around you, right now</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <button className="press" style={{ "--press-scale": 0.98, cursor: "pointer", textAlign: "center", background: "#f6efe3", border: "1px solid #ece3d3", borderRadius: 20, padding: 13, display: "flex", flexDirection: "column", gap: 10 }} onClick={() => this.setState({ screen: "whats", whats: "intro", camError: null })}>
            <span style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 15, color: "#1a1a22" }}>What's this?</span>
            <span style={{ width: "100%", height: 62, borderRadius: 12, background: "#fffdf8", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z" /><circle cx="12" cy="13" r="3.5" /></svg></span>
          </button>
          <button className="press" style={{ "--press-scale": 0.98, cursor: "pointer", textAlign: "center", background: "#f6efe3", border: "1px solid #ece3d3", borderRadius: 20, padding: 13, display: "flex", flexDirection: "column", gap: 10 }} onClick={() => this.setState({ screen: "about" })}>
            <span style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 15, color: "#1a1a22" }}>All About Me</span>
            <span style={{ width: "100%", height: 62, borderRadius: 12, background: "#fffdf8", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5" /></svg></span>
          </button>
        </div>
      </div>
    );
  }

  renderAbout() {
    const s = this.state;
    return (
      <div style={S.screen}>
        <div style={{ padding: "8px 26px 0" }}>
          <button style={S.backBtn} onClick={() => this.back()}><BackArrow /> Back</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 26px 40px" }}>
          <h1 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 34, letterSpacing: "-0.01em", margin: "6px 0 4px", color: "#1a1a22" }}>All About Me</h1>
          <p style={{ fontSize: 15, color: "#8a8275", margin: "0 0 26px" }}>Tap to tell me what you love and what to skip.</p>

          <h2 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 19, margin: "0 0 14px", color: "#1a1a22" }}>I like…</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            {LIKE_MASTER.map(l => (
              <button key={l} className="press" style={{ "--press-scale": 0.95, ...this.chipStyle(s.likes.includes(l), "like") }} onClick={() => this.toggle("likes", l)}>{l}</button>
            ))}
          </div>

          <h2 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 19, margin: "34px 0 14px", color: "#1a1a22" }}>I don't like…</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            {DISLIKE_MASTER.map(l => (
              <button key={l} className="press" style={{ "--press-scale": 0.95, ...this.chipStyle(s.dislikes.includes(l), "dislike") }} onClick={() => this.toggle("dislikes", l)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={S.sheetFooter}>
          <button className="press" style={{ "--press-scale": 0.985, ...S.primaryBtn }} onClick={() => this.onUseLocation()}>Show me what's fun →</button>
        </div>
      </div>
    );
  }

  renderWhats() {
    const s = this.state;
    return (
      <div style={S.screen}>
        <div style={{ padding: "8px 26px 0" }}>
          <button style={S.backBtn} onClick={() => { this.stopCam(); this.back(); }}><BackArrow /> Back</button>
        </div>
        <div style={{ padding: "6px 26px 0" }}>
          <h1 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 34, letterSpacing: "-0.01em", margin: "6px 0 0", color: "#1a1a22" }}>What's this?</h1>
        </div>

        {s.whats === "intro" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 26px 26px" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "30px 0" }}>
              <div style={{ width: "100%", aspectRatio: "1", borderRadius: 28, background: "#f4ede1", border: "1.5px dashed #d9cfbd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, textAlign: "center", padding: 30 }}>
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#c3b7a2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z" /><circle cx="12" cy="13" r="3.5" /></svg>
                <div style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 20, color: "#1a1a22", lineHeight: 1.25 }}>Point your camera at<br />something interesting</div>
                <div style={{ fontSize: 13, color: "#9a9082", maxWidth: 220 }}>A building, a dish, a statue, a sign — anything you're curious about.</div>
                {s.camError && (
                  <div style={{ fontFamily: "'DM Mono'", fontSize: 11.5, color: "#c2591b", background: "#fbe7d8", padding: "8px 12px", borderRadius: 10, maxWidth: 250, lineHeight: 1.4 }}>{s.camError}</div>
                )}
              </div>
            </div>
            <button className="press" style={{ "--press-scale": 0.985, width: "100%", cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 17, padding: 18, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }} onClick={() => this.openCamera()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Open camera
            </button>
          </div>
        )}

        {s.whats === "camera" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 26px 26px" }}>
            <div style={{ flex: 1, position: "relative", borderRadius: 28, overflow: "hidden", background: "#14141b", marginBottom: 18 }}>
              <video ref={this.videoRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, border: "2px solid rgba(255,255,255,0.18)", borderRadius: 28, pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 14, left: 14, fontFamily: "'DM Mono'", fontSize: 11, color: "#fffdf8", background: "rgba(0,0,0,0.4)", padding: "5px 10px", borderRadius: 10 }}>live camera</div>
            </div>
            <button className="press" style={{ "--press-scale": 0.985, width: "100%", cursor: "pointer", border: "none", background: "#ec6a1f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 17, padding: 18, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }} onClick={() => this.capturePhoto()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fffdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /></svg>
              Capture
            </button>
          </div>
        )}

        {s.whats === "loading" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 26px 26px" }}>
            <div style={{ flex: 1, position: "relative", borderRadius: 28, overflow: "hidden", background: "#16161d" }}>
              {s.whatsPhoto && <img src={s.whatsPhoto} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />}
              <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,14,0.35)" }} />
              <div style={{ position: "absolute", left: "6%", right: "6%", height: 2, background: "linear-gradient(90deg, transparent, #ec6a1f, transparent)", boxShadow: "0 0 16px 2px rgba(236,106,31,0.7)", animation: "ff-scan 1.4s ease-in-out infinite alternate" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "#fffdf8" }}>
                <div style={{ width: 30, height: 30, border: "3px solid rgba(255,255,255,0.25)", borderTopColor: "#ec6a1f", borderRadius: "50%", animation: "ff-spin 0.8s linear infinite" }} />
                <div style={{ fontFamily: "'DM Mono'", fontSize: 12.5, letterSpacing: "0.06em" }}>Looking…</div>
              </div>
            </div>
          </div>
        )}

        {s.whats === "result" && (() => {
          const r = s.whatsResult || { title: "", type: "", blurb: "", facts: [] };
          return (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, overflowY: "auto", padding: "18px 26px 26px" }}>
                <div style={{ position: "relative", width: "100%", aspectRatio: "16/10", borderRadius: 22, overflow: "hidden", background: "#16161d", animation: "ff-pop 0.4s ease" }}>
                  {s.whatsPhoto && <img src={s.whatsPhoto} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                  <div style={{ position: "absolute", top: 12, left: 12, fontFamily: "'DM Mono'", fontSize: 11, color: "#fffdf8", background: "rgba(0,0,0,0.45)", padding: "4px 9px", borderRadius: 8 }}>your photo</div>
                </div>
                <h2 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 26, letterSpacing: "-0.01em", margin: "16px 0 4px", color: "#1a1a22" }}>{r.title}</h2>
                <div style={{ fontFamily: "'DM Mono'", fontSize: 12, color: "#ec6a1f", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>{r.type}</div>
                <p style={{ fontSize: 15.5, lineHeight: 1.5, color: "#4b463d", margin: "0 0 18px" }}>{r.blurb}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(r.facts || []).map((fact, i) => (
                    <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", background: "#f6efe3", border: "1px solid #ece3d3", borderRadius: 15, padding: "13px 15px" }}>
                      <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: "#ec6a1f", marginTop: 7 }} />
                      <span style={{ fontSize: 14, lineHeight: 1.4, color: "#403b33" }}>{fact}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={S.sheetFooter}>
                <button className="press" style={{ "--press-scale": 0.985, width: "100%", cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 17, padding: 16, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }} onClick={() => this.openCamera()}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  Scan something else
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  renderRecs() {
    const s = this.state;
    const allRecs = s.recs || [];
    const filtered = s.category === "All" ? allRecs : allRecs.filter(p => p.category === s.category);
    const cards = filtered.map(p => this.cardFor(p, allRecs.indexOf(p)));
    const locationText = s.location ? s.location.split(",")[0] : "Set location";
    const showListView = !s.recsLoading && !s.recsError && s.view === "list";
    const showMapView = !s.recsLoading && !s.recsError && s.view === "map";

    return (
      <div style={S.screen}>
        <div style={{ padding: "8px 26px 0", flexShrink: 0 }}>
          <button style={S.backBtn} onClick={() => this.back()}><BackArrow /> Back</button>
          <h1 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 30, lineHeight: 1.05, letterSpacing: "-0.01em", margin: "4px 0 14px", color: "#1a1a22" }}>{locationText}</h1>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 0 4px" }}>
            <button className="press filter-chip" style={{ "--press-scale": 0.97, flexShrink: 0, cursor: "pointer", border: "1px solid #ece3d3", background: "#fffdf8", padding: "8px 14px 8px 11px", borderRadius: 14, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => this.openFilters()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="#fffdf8" /><line x1="4" y1="12" x2="20" y2="12" /><circle cx="16" cy="12" r="2" fill="#fffdf8" /><line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="#fffdf8" /></svg>
              <span style={{ fontFamily: "'Hanken Grotesk'", fontWeight: 700, fontSize: 14, color: "#1a1a22" }}>Filter</span>
            </button>
            <div style={{ flexShrink: 0, display: "flex", background: "#17171f", borderRadius: 19, padding: 4, gap: 2 }}>
              <button style={this.toggleBtnStyle(s.view === "list")} onClick={() => this.setState({ view: "list" })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg> List</button>
              <button style={this.toggleBtnStyle(s.view === "map")} onClick={() => { this._fitted = false; this.setState({ view: "map", mapSel: allRecs[0] || null }); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 3.5 5v16L9 19l6 2 5.5-2V3L15 5 9 3Z" /><path d="M9 3v16M15 5v16" /></svg> Map</button>
            </div>
          </div>
        </div>

        {s.recsLoading && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40 }}>
            <div style={{ width: 34, height: 34, border: "3.5px solid #f0e6d6", borderTopColor: "#ec6a1f", borderRadius: "50%", animation: "ff-spin 0.8s linear infinite" }} />
            <div style={{ fontFamily: "'DM Mono'", fontSize: 13, color: "#9a9082", textAlign: "center", lineHeight: 1.5 }}>{s.loadingText}</div>
          </div>
        )}

        {!!s.recsError && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40, textAlign: "center" }}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5h.01" /></svg>
            <div style={{ fontSize: 15, color: "#8a8275", maxWidth: 260, lineHeight: 1.5 }}>{s.recsError}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 15, padding: "12px 24px", borderRadius: 16 }} onClick={() => (this.coords ? this.fetchThenRecs() : this.locateAndFetch())}>Try again</button>
              <button style={{ cursor: "pointer", border: "1px solid #e6ddcd", background: "#fffdf8", color: "#1a1a22", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 15, padding: "12px 24px", borderRadius: 16 }} onClick={() => this.openFilters()}>Type location</button>
            </div>
          </div>
        )}

        {showListView && (
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 26px calc(24px + env(safe-area-inset-bottom))" }}>
            {s.recsIntro && (
              <p style={{ fontFamily: "'Hanken Grotesk'", fontSize: 15.5, lineHeight: 1.6, color: "#4b463d", margin: "0 0 22px" }}>{s.recsIntro}</p>
            )}
            {cards.map(c => (
              <div key={c.id} style={{ marginBottom: 22, display: "flex", gap: 14 }}>
                <div className="press" style={{ "--press-scale": 0.97, cursor: "pointer", flexShrink: 0, width: 64, height: 64, borderRadius: 14, overflow: "hidden", background: c.imgBg, position: "relative" }} onClick={c.onClick}>
                  {c.photo ? (
                    <img src={c.photo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 8px, transparent 8px 16px)" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <h3 className="press" style={{ "--press-scale": 0.98, cursor: "pointer", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 19, margin: 0, color: "#1a1a22", letterSpacing: "-0.01em" }} onClick={c.onClick}>{c.name}</h3>
                    <button className="press" style={{ "--press-scale": 0.9, flexShrink: 0, cursor: "pointer", border: "none", background: "#f4ede1", color: "#9a9082", width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }} onClick={() => this.replaceRec(c.id)} aria-label="Not interested, show something else">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                  <div style={{ fontFamily: "'DM Mono'", fontSize: 11.5, color: "#b5ab9a", margin: "3px 0 8px" }}>{c.metaLine}</div>
                  <p style={{ fontFamily: "'Hanken Grotesk'", fontSize: 15.5, lineHeight: 1.6, color: "#4b463d", margin: "0 0 8px" }}>{c.text}</p>
                  <button className="press" style={{ "--press-scale": 0.96, cursor: "pointer", border: "none", background: "none", padding: 0, display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "'DM Mono'", fontWeight: 500, fontSize: 12, color: "#ec6a1f", letterSpacing: "0.03em" }} onClick={c.onClick}>
                    More <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </div>
            ))}
            {s.replacing && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 22px", color: "#9a9082", fontFamily: "'DM Mono'", fontSize: 13 }}>
                <div style={{ width: 16, height: 16, border: "2.5px solid #f0e6d6", borderTopColor: "#ec6a1f", borderRadius: "50%", animation: "ff-spin 0.8s linear infinite" }} />
                Finding something else…
              </div>
            )}
            <div style={{ textAlign: "center", fontFamily: "'DM Mono'", fontSize: 11, color: "#b5ab9a", padding: "8px 0 4px" }}>
              {s.category === "All" ? `${allRecs.length} picks · tuned to your taste` : `${cards.length} in ${s.category}`}
            </div>
          </div>
        )}

        {showMapView && this.renderMap(allRecs)}
      </div>
    );
  }

  renderMap(allRecs) {
    const s = this.state;
    const mapSel = s.mapSel ? this.cardFor(s.mapSel, allRecs.indexOf(s.mapSel)) : null;
    const routeStops = s.route.map(id => allRecs.find(p => p.id === id)).filter(Boolean).map((p, i) => ({ order: i + 1, name: p.name, walk: `${p.walkMins} min` }));
    return (
      <div style={{ flex: 1, position: "relative", margin: "10px 20px calc(20px + env(safe-area-inset-bottom))", borderRadius: 24, overflow: "hidden", border: "1px solid #e4e8de" }}>
        <div ref={this.setMapEl} style={{ position: "absolute", inset: 0, background: "#eaece3" }} />

        <button
          className="press"
          style={{
            "--press-scale": 0.97, position: "absolute", top: 12, left: 12, zIndex: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 14px", borderRadius: 16, fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 13.5, border: "none", boxShadow: "0 6px 16px -6px rgba(40,28,12,0.5)",
            background: s.routing ? "#ec6a1f" : "#fffdf8", color: s.routing ? "#fffdf8" : "#1a1a22",
          }}
          onClick={() => this.toggleRoute()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2.4" /><circle cx="18" cy="5" r="2.4" /><path d="M8.4 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.6" /></svg> {s.routing ? "Done" : "Build route"}
        </button>

        {!s.routing && mapSel && (
          <div style={{ cursor: "pointer", position: "absolute", left: 14, right: 14, bottom: 14, zIndex: 500, background: "#fffdf8", borderRadius: 18, padding: "12px 14px", boxShadow: "0 12px 30px -12px rgba(40,28,12,0.5)", display: "flex", gap: 12, alignItems: "center", animation: "ff-up 0.3s ease" }} onClick={mapSel.onClick}>
            <div style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 14, background: mapSel.imgBg, position: "relative" }}><div style={{ position: "absolute", inset: 0, borderRadius: 14, backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 8px, transparent 8px 16px)" }} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 16, color: "#1a1a22" }}>{mapSel.rank}. {mapSel.name}</div>
              <div style={{ fontFamily: "'DM Mono'", fontSize: 11.5, color: "#9a9082", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mapSel.metaLine}</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c9bfad" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
          </div>
        )}

        {s.routing && (
          <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 500, background: "#fffdf8", borderRadius: 20, padding: "14px 15px 15px", boxShadow: "0 16px 36px -14px rgba(40,28,12,0.55)", animation: "ff-up 0.3s ease" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 17, color: "#1a1a22" }}>Your route <span style={{ color: "#ec6a1f" }}>{routeStops.length}</span></div>
              <button style={{ cursor: "pointer", border: "1px solid #eadfce", background: "#fffdf8", color: "#9a9082", fontFamily: "'DM Mono'", fontSize: 11.5, padding: "5px 11px", borderRadius: 12, opacity: routeStops.length ? 1 : 0.5, pointerEvents: routeStops.length ? "auto" : "none" }} onClick={() => this.clearRoute()}>Clear</button>
            </div>
            {routeStops.length === 0 && (
              <div style={{ fontFamily: "'DM Mono'", fontSize: 12, color: "#9a9082", lineHeight: 1.5, padding: "4px 2px 8px" }}>Tap the pins in the order you want to visit them.</div>
            )}
            {routeStops.length > 0 && (
              <React.Fragment>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 168, overflowY: "auto", marginBottom: 12 }}>
                  {routeStops.map(stop => (
                    <div key={stop.order} style={{ display: "flex", alignItems: "center", gap: 11, padding: "5px 0" }}>
                      <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#ec6a1f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{stop.order}</span>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: "'Hanken Grotesk'", fontWeight: 600, fontSize: 14.5, color: "#1a1a22", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stop.name}</span>
                      <span style={{ flexShrink: 0, fontFamily: "'DM Mono'", fontSize: 11, color: "#a89f90" }}>{stop.walk}</span>
                    </div>
                  ))}
                </div>
                <button className="press" style={{ "--press-scale": 0.98, width: "100%", cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 15.5, padding: 13, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={() => this.startRoute()}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2Z" /></svg> Start walking route</button>
              </React.Fragment>
            )}
          </div>
        )}
      </div>
    );
  }

  renderDetailSheet() {
    const s = this.state;
    const allRecs = s.recs || [];
    const detail = this.cardFor(s.selected, allRecs.indexOf(s.selected));
    return (
      <React.Fragment>
        <div onClick={() => this.setState({ selected: null })} style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(20,14,4,0.45)", animation: "ff-scrim 0.25s ease" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 61, maxHeight: "88%", background: "#fffdf8", borderRadius: "28px 28px 0 0", display: "flex", flexDirection: "column", animation: "ff-sheet 0.32s cubic-bezier(0.22,1,0.36,1)" }}>
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 42, height: 5, borderRadius: 3, background: "#e2d8c6" }} /></div>
          <div style={{ overflowY: "auto", padding: "8px 24px calc(24px + env(safe-area-inset-bottom))" }}>
            <div style={{ position: "relative", width: "100%", height: 170, borderRadius: 20, overflow: "hidden", background: detail.imgBg, marginBottom: 18 }}>
              {detail.photo ? (
                <img src={detail.photo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0 11px, transparent 11px 22px)" }} />
              )}
              <button className="press" style={{ "--press-scale": 0.95, position: "absolute", top: 12, right: 12, cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'DM Mono'", fontWeight: 500, fontSize: 11, padding: "7px 12px", borderRadius: 14, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={detail.directions}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2Z" /></svg> Show me the way</button>
              {!detail.photo && (
                <div style={{ position: "absolute", bottom: 12, left: 14, fontFamily: "'DM Mono'", fontSize: 11, color: "rgba(26,26,34,0.45)" }}>// {detail.caption}</div>
              )}
            </div>
            <div>
              <h2 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 27, letterSpacing: "-0.01em", margin: 0, color: "#1a1a22" }}>{detail.name}</h2>
              <div style={{ fontFamily: "'DM Mono'", fontSize: 12.5, color: "#ec6a1f", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{detail.typeArea}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f4ede1", borderRadius: 12, padding: "9px 12px", fontSize: 13, fontWeight: 600, color: "#403b33" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4" r="1.6" /><path d="m9 21 1.5-6-2.5-2 1-5 3 1.5 2.5 2M8 13l-2 8M14.5 12l2 3 3 1" /></svg>{detail.walkLabel}</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f4ede1", borderRadius: 12, padding: "9px 12px", fontSize: 13, fontWeight: 600, color: "#403b33" }}>{detail.categoryLabel}</div>
              {detail.hasHours && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f4ede1", borderRadius: 12, padding: "9px 12px", fontSize: 13, fontWeight: 600, color: "#403b33" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{detail.hoursLabel}</div>
              )}
            </div>
            {detail.expanding ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 20px", color: "#9a9082", fontFamily: "'DM Mono'", fontSize: 13 }}>
                <div style={{ width: 16, height: 16, border: "2.5px solid #f0e6d6", borderTopColor: "#ec6a1f", borderRadius: "50%", animation: "ff-spin 0.8s linear infinite" }} />
                Getting more detail…
              </div>
            ) : (
              <p style={{ fontSize: 15.5, lineHeight: 1.55, color: "#4b463d", margin: "0 0 8px", whiteSpace: "pre-line" }}>{detail.text}</p>
            )}
            {detail.expandError && !detail.expanding && (
              <div style={{ fontFamily: "'DM Mono'", fontSize: 12, color: "#c2591b", margin: "0 0 12px" }}>Couldn't load more just then — try again.</div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              {!detail.expanded && (
                <button className="press" style={{ "--press-scale": 0.98, flex: 1, cursor: "pointer", border: "none", background: "#17171f", color: "#fffdf8", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 16, padding: 15, borderRadius: 16, opacity: detail.expanding ? 0.6 : 1 }} onClick={() => this.expandPlace(detail)}>
                  {detail.expanding ? "Loading…" : "Tell me more"}
                </button>
              )}
              <button className="press" style={{ "--press-scale": 0.98, flex: detail.expanded ? 1 : undefined, flexShrink: detail.expanded ? undefined : 0, cursor: "pointer", border: "1px solid #e6ddcd", background: "#fffdf8", color: "#1a1a22", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 16, padding: detail.expanded ? 15 : "15px 22px", borderRadius: 16 }} onClick={() => this.setState({ selected: null })}>Close</button>
            </div>
          </div>
        </div>
      </React.Fragment>
    );
  }

  renderEditorSheet() {
    const s = this.state;
    const allRecs = s.recs || [];
    const present = new Set(allRecs.map(p => p.category));
    const tabList = ["All", ...CATS.filter(c => c !== "All" && present.has(c))];
    const showCategoryPicker = tabList.length > 1;
    return (
      <React.Fragment>
        <div onClick={() => this.setState({ editor: null })} style={{ position: "absolute", inset: 0, zIndex: 70, background: "rgba(20,14,4,0.4)", animation: "ff-scrim 0.2s ease" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 71, maxHeight: "88%", background: "#fffdf8", borderRadius: "28px 28px 0 0", display: "flex", flexDirection: "column", animation: "ff-sheet 0.3s cubic-bezier(0.22,1,0.36,1)" }}>
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 42, height: 5, borderRadius: 3, background: "#e2d8c6" }} /></div>
          <div style={{ overflowY: "auto", padding: "6px 24px calc(24px + env(safe-area-inset-bottom))" }}>
            {showCategoryPicker && (
              <React.Fragment>
                <h3 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 21, margin: "0 0 14px", color: "#1a1a22" }}>Category</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
                  {tabList.map(label => (
                    <button key={label} style={this.tabStyle(s.category === label)} onClick={() => this.setState({ category: label, mapSel: null, editor: null })}>{label}</button>
                  ))}
                </div>
              </React.Fragment>
            )}

            <h3 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 21, margin: "0 0 14px", color: "#1a1a22" }}>Where are you?</h3>
            <button className="press" style={{ "--press-scale": 0.985, width: "100%", cursor: "pointer", border: "1.5px solid #ec6a1f", background: "#fbe7d8", color: "#c2591b", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 15.5, padding: 14, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 14 }} onClick={() => this.useGpsFromEditor()}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ec6a1f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" /><circle cx="12" cy="10" r="2.6" /></svg> Use my current location</button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><div style={{ flex: 1, height: 1, background: "#ece3d3" }} /><span style={{ fontFamily: "'DM Mono'", fontSize: 11, color: "#b5ab9a" }}>or type it</span><div style={{ flex: 1, height: 1, background: "#ece3d3" }} /></div>
            <input className="text-input" value={s.locDraft} onChange={(e) => this.setState({ locDraft: e.target.value })} placeholder="City, neighbourhood or address" style={{ width: "100%", fontFamily: "'Hanken Grotesk'", fontSize: 16, fontWeight: 600, color: "#1a1a22", padding: "15px 16px", border: "1.5px solid #e6ddcd", borderRadius: 15, background: "#fdfaf3" }} />

            <h3 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 21, margin: "28px 0 14px", color: "#1a1a22" }}>When?</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {PERIODS.map(([p, hint]) => {
                const active = s.period === p;
                return (
                  <button key={p} style={{
                    cursor: "pointer", textAlign: "left",
                    border: active ? "1.5px solid #ec6a1f" : "1.5px solid #ece3d3",
                    background: active ? "#fbe7d8" : "#f6efe3",
                    color: active ? "#c2591b" : "#403b33",
                    fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 16, padding: "14px 16px", borderRadius: 16,
                  }} onClick={() => this.setState({ period: p })}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                    <span style={{ display: "block", fontFamily: "'DM Mono'", fontSize: 11, fontWeight: 400, opacity: 0.7, marginTop: 3 }}>{hint}</span>
                  </button>
                );
              })}
            </div>

            <h3 style={{ fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 21, margin: "28px 0 6px", color: "#1a1a22" }}>How far will you walk?</h3>
            <div style={{ textAlign: "center", fontFamily: "'Fredoka'", fontWeight: 600, fontSize: 40, color: "#ec6a1f", margin: "10px 0 4px" }}>{s.walkDraft}<span style={{ fontSize: 18, color: "#9a9082", fontWeight: 500 }}> min</span></div>
            <input type="range" min="5" max="45" step="5" value={s.walkDraft} onChange={(e) => this.setState({ walkDraft: parseInt(e.target.value, 10) })} style={{ width: "100%", accentColor: "#ec6a1f", height: 30 }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'DM Mono'", fontSize: 11, color: "#b5ab9a", marginTop: -2 }}><span>5 min</span><span>45 min</span></div>

            <button className="press" style={{ "--press-scale": 0.985, ...S.primaryBtn, marginTop: 22 }} onClick={() => this.applyFilters()}>Update recommendations</button>
          </div>
        </div>
      </React.Fragment>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
