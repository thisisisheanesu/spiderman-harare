// Harare CBD street-life data: vehicles, kombi ranks, hwindi calls, pedestrians, vendors, Shona phrases,
// trees, street props, sound design and sky/light for late September.
//
// Plain ES module, no dependencies. Research notes and source URLs: docs/references/STREETLIFE.md
//
// Conventions
//   - Colours are CSS hex strings (feed straight into THREE.Color).
//   - Units: metres, seconds, m/s. Angles in degrees unless the name says otherwise.
//   - World axes match src/core/geo.js: x = east, y = up, z = south (north = -z).
//   - `weight` fields are relative frequencies (use rng.weighted from src/core/rng.js).
//   - `approx: true` marks estimates or general knowledge that no source verified.
//   - Shona lines carry `conf`: 'high' (verified or very common) | 'medium' (believed correct; have a native speaker check).
//   - Brands: vehicle model names are descriptive only. Billboards and shops should use invented names
//     (see GENERIC_SIGNAGE).

const kmh = (v) => +(v / 3.6).toFixed(2);

export const HARARE = {
  lat: -17.8292,
  lon: 31.0522,
  elevationM: 1490,
  timezone: 'Africa/Harare',
  utcOffsetHours: 2, // CAT, no daylight saving
};

// ---------------------------------------------------------------------------------------------------------------
// VEHICLES
// ---------------------------------------------------------------------------------------------------------------

// Common car paint colours (regional data: white > silver > grey > black; others rarer).
const CAR_COLORS = {
  white: '#eeeeea',
  pearl: '#e4e1d8',
  silver: '#b7bbbf',
  grey: '#7c8187',
  gunmetal: '#4a4f55',
  black: '#16181b',
  navy: '#1e2d55',
  blue: '#2b56a1',
  skyBlue: '#7fa3c7',
  red: '#a3171c',
  maroon: '#5b1b22',
  champagne: '#c8b78e',
  green: '#27463a',
  lime: '#9fbf3b',
  orange: '#d0671f',
};
const C = CAR_COLORS;

export const VEHICLE_COLORS = CAR_COLORS;

export const VEHICLE_TYPES = [
  {
    type: 'kombi',
    label: 'Minibus taxi (Toyota HiAce-type, boxy cab-over, 1990s-2000s)',
    weight: 0.2, // share of CBD traffic (approx); raise near ranks
    approx: true,
    length: 4.7,
    width: 1.69,
    height: 2.0,
    wheelbase: 2.8,
    seats: 15, // VID-registered; "18-seater" 4-per-bench layout is common, overloading more so
    typicalLoad: [12, 18],
    maxSpeed: kmh(70), // exceeds the 60 km/h limit when it can
    cruiseSpeed: kmh(40),
    accel: 2.4,
    brakeDecel: 6.0,
    aggression: 0.85, // 0..1: gap acceptance, lane jumping, red-light running
    stopsAnywhere: true, // loads and unloads at undesignated points
    hootRate: 0.25, // hoots per second while touting
    colors: [C.white, C.white, C.white, C.white, C.pearl, C.silver, C.skyBlue, C.navy, C.maroon],
    liveries: [
      { id: 'plain_white', weight: 0.34, body: '#efeee8', dirt: 0.45 },
      { id: 'zupco_franchise', weight: 0.18, body: '#efeee8', dirt: 0.35,
        decals: [{ text: 'ZUPCO', color: '#1c3f94', where: ['side', 'windscreen_top'], bg: '#ffffff' }],
        note: 'Franchise sticker (2019+). Fake sticker sets were sold for ~US$15.' },
      { id: 'factory_stripes', weight: 0.14, body: '#efeee8', stripe: ['#1f4e9c', '#b01e23', '#3a7d44', '#d88c1c'], stripeStyle: 'side_band', dirt: 0.4 },
      { id: 'slogan_banner', weight: 0.2, body: '#efeee8', dirt: 0.4, banner: 'KOMBI_SLOGANS',
        where: ['windscreen_top', 'rear_window'], bannerColors: ['#d6201f', '#1d4fb8', '#111111', '#e3b21b'] },
      { id: 'two_tone_old', weight: 0.06, body: '#e7e0cc', lower: '#6b4e37', dirt: 0.55, note: 'older Super Custom-style two-tone (approx)' },
      { id: 'coloured', weight: 0.08, body: [C.silver, C.skyBlue, C.navy, C.maroon], dirt: 0.4 },
    ],
    roofRackChance: 0.12,
    slidingDoorSide: 'left', // kerb side when driving on the left
    wear: { dents: 0.5, crackedWindscreen: 0.2, missingHubcaps: 0.6 },
    crew: ['driver', 'hwindi'],
    approxNote: 'dimensions ≈ HiAce H100 long-body; colours/liveries approx',
  },
  {
    type: 'hatch',
    label: 'Small hatchback (Honda Fit / Toyota Vitz / Aqua / Mazda Demio class)',
    weight: 0.25,
    approx: true,
    length: 3.95,
    width: 1.695,
    height: 1.5,
    wheelbase: 2.5,
    seats: 5,
    maxSpeed: kmh(65),
    cruiseSpeed: kmh(40),
    accel: 2.2,
    brakeDecel: 6.5,
    aggression: 0.45,
    colors: [C.white, C.white, C.silver, C.silver, C.grey, C.black, C.blue, C.skyBlue, C.red, C.lime, C.orange, C.pearl],
    subtypes: [
      { id: 'fit', weight: 0.5, length: 3.95, height: 1.53 },
      { id: 'vitz', weight: 0.2, length: 3.9, height: 1.5 },
      { id: 'aqua', weight: 0.25, length: 4.0, height: 1.45 },
      { id: 'demio', weight: 0.05, length: 3.9, height: 1.48 },
    ],
  },
  {
    type: 'mushikashika',
    label: 'Pirate taxi (unmarked hatchback, usually a Honda Fit), overloaded, reckless',
    weight: 0.04,
    length: 3.95,
    width: 1.695,
    height: 1.53,
    wheelbase: 2.5,
    seats: 5,
    typicalLoad: [5, 7], // sometimes one passenger in the boot
    maxSpeed: kmh(75),
    cruiseSpeed: kmh(45),
    accel: 2.6,
    brakeDecel: 7.0,
    aggression: 0.95,
    stopsAnywhere: true,
    colors: [C.silver, C.white, C.blue, C.grey, C.skyBlue, C.red],
    note: 'Loads on Leopold Takawira St and near ranks; runs red lights; weaves through gridlock.',
  },
  {
    type: 'sedan',
    label: 'Sedan (Toyota Corolla Axio / Allion / Premio; some older German executive saloons)',
    weight: 0.13,
    approx: true,
    length: 4.5,
    width: 1.7,
    height: 1.46,
    wheelbase: 2.6,
    seats: 5,
    maxSpeed: kmh(70),
    cruiseSpeed: kmh(40),
    accel: 2.0,
    brakeDecel: 6.5,
    aggression: 0.4,
    colors: [C.white, C.pearl, C.silver, C.silver, C.grey, C.gunmetal, C.black, C.navy, C.champagne, C.maroon],
    subtypes: [
      { id: 'axio_allion', weight: 0.7, length: 4.45, width: 1.695 },
      { id: 'german_exec', weight: 0.2, length: 4.8, width: 1.8, colors: [C.black, C.silver, C.white, C.navy] },
      { id: 'old_saloon', weight: 0.1, length: 4.3, width: 1.68, colors: [C.white, C.maroon, C.champagne, C.green] },
    ],
  },
  {
    type: 'wagon',
    label: 'Station wagon / small MPV (Toyota Wish / Fielder / Sienta / Noah class)',
    weight: 0.07,
    approx: true,
    length: 4.6,
    width: 1.695,
    height: 1.6,
    wheelbase: 2.75,
    seats: 7,
    maxSpeed: kmh(65),
    cruiseSpeed: kmh(40),
    accel: 1.9,
    brakeDecel: 6.0,
    aggression: 0.45,
    colors: [C.white, C.silver, C.silver, C.grey, C.black, C.navy, C.champagne],
  },
  {
    type: 'pickup',
    label: 'Double/single-cab pickup (Toyota Hilux, Isuzu KB/D-Max, Ford Ranger, Nissan NP200 class)',
    weight: 0.12,
    approx: true,
    length: 5.3,
    width: 1.85,
    height: 1.8,
    wheelbase: 3.1,
    seats: 5,
    maxSpeed: kmh(70),
    cruiseSpeed: kmh(40),
    accel: 1.8,
    brakeDecel: 6.0,
    aggression: 0.55,
    colors: [C.white, C.white, C.white, C.silver, C.grey, C.gunmetal, C.black, C.red, C.navy],
    subtypes: [
      { id: 'double_cab', weight: 0.65, length: 5.3 },
      { id: 'single_cab_load', weight: 0.25, length: 5.0, cargo: ['sacks', 'crates', 'water tanks', 'building sand', 'workers sitting in back'] },
      { id: 'small_bakkie', weight: 0.1, length: 4.3, width: 1.68, height: 1.55 },
    ],
  },
  {
    type: 'suv',
    label: 'SUV (Toyota Land Cruiser / Prado / Fortuner class, German SUVs)',
    weight: 0.08,
    approx: true,
    length: 4.85,
    width: 1.93,
    height: 1.88,
    wheelbase: 2.85,
    seats: 7,
    maxSpeed: kmh(70),
    cruiseSpeed: kmh(40),
    accel: 2.0,
    brakeDecel: 6.0,
    aggression: 0.6,
    colors: [C.white, C.pearl, C.black, C.black, C.silver, C.gunmetal, C.champagne],
    tintedWindows: 0.7,
  },
  {
    type: 'taxi',
    label: 'Metered taxi (white/silver saloon or hatch with roof sign)',
    weight: 0.02,
    length: 4.4,
    width: 1.695,
    height: 1.5,
    wheelbase: 2.6,
    seats: 5,
    maxSpeed: kmh(65),
    cruiseSpeed: kmh(38),
    accel: 2.0,
    brakeDecel: 6.5,
    aggression: 0.5,
    colors: [C.white, C.silver],
    roofSign: { color: '#f2d21b', text: 'TAXI' },
  },
  {
    type: 'bus',
    label: 'ZUPCO city bus (large Chinese-built single-decker, white body)',
    weight: 0.03,
    length: 11.5,
    width: 2.5,
    height: 3.2,
    wheelbase: 5.8,
    seats: 65,
    maxSpeed: kmh(60),
    cruiseSpeed: kmh(32),
    accel: 1.0,
    brakeDecel: 4.0,
    aggression: 0.35,
    colors: ['#f3f3f0'],
    liveries: [
      { id: 'zupco_white_blue', weight: 0.7, body: '#f3f3f0', stripe: '#1c3f94', accent: '#d9a520', text: 'ZUPCO', approx: true },
      { id: 'zupco_white_plain', weight: 0.3, body: '#f3f3f0', stripe: '#1c3f94', text: 'ZUPCO', approx: true },
    ],
    note: '500+ white buses commissioned from 2019 (FAW etc.); blue/gold accents approx.',
  },
  {
    type: 'truck',
    label: 'Light/medium delivery truck (Isuzu/Hino/UD-class cab-over, dropside or box body)',
    weight: 0.03,
    approx: true,
    length: 7.0,
    width: 2.2,
    height: 3.0,
    wheelbase: 3.9,
    seats: 3,
    maxSpeed: kmh(55),
    cruiseSpeed: kmh(30),
    accel: 1.0,
    brakeDecel: 4.5,
    aggression: 0.4,
    colors: ['#efefea', '#1f4e9c', '#b01e23', '#2e6b3f', '#d9a520'],
    bodyColors: ['#e8e8e2', '#b7bbbf', '#7a5a3a'],
  },
  {
    type: 'police',
    label: 'ZRP double-cab pickup (Ford Ranger / Isuzu type)',
    weight: 0.01,
    approx: true,
    length: 5.35,
    width: 1.86,
    height: 1.82,
    wheelbase: 3.2,
    seats: 5,
    maxSpeed: kmh(90),
    cruiseSpeed: kmh(40),
    accel: 2.2,
    brakeDecel: 6.5,
    aggression: 0.5,
    colors: ['#f2f2ee'],
    livery: { body: '#f2f2ee', band: '#1b2f6b', band2: '#e0b521', text: 'POLICE', lightBar: ['#1d4fff', '#ff2a2a'] },
    note: 'Livery approx. ZRP uniforms are blue/grey; traffic officers wear yellow reflective sleeves.',
  },
  {
    type: 'motorbike',
    label: 'Small motorcycle (couriers, food delivery)',
    weight: 0.02,
    approx: true,
    length: 1.9,
    width: 0.75,
    height: 1.2,
    wheelbase: 1.25,
    seats: 2,
    maxSpeed: kmh(70),
    cruiseSpeed: kmh(40),
    accel: 3.0,
    brakeDecel: 7.0,
    aggression: 0.7,
    colors: [C.black, C.red, C.blue, C.white],
    deliveryBoxChance: 0.5,
  },
];

// Short painted names and messages on kombi banners (windscreen top strip / rear window).
export const KOMBI_SLOGANS = [
  { text: 'MWARI VANOKWANISA', en: 'God is able', lang: 'sn', conf: 'high' },
  { text: 'GOD IS ABLE', lang: 'en' },
  { text: 'ZVICHANAKA', en: 'It will be well', lang: 'sn', conf: 'high' },
  { text: 'TATENDA', en: 'We give thanks', lang: 'sn', conf: 'high' },
  { text: 'RUFARO', en: 'Joy', lang: 'sn', conf: 'high' },
  { text: 'NYASHA', en: 'Grace', lang: 'sn', conf: 'high' },
  { text: 'TINASHE', en: 'God is with us', lang: 'sn', conf: 'high' },
  { text: 'ROPAFADZO', en: 'Blessing', lang: 'sn', conf: 'high' },
  { text: 'BLESSED', lang: 'en' },
  { text: 'PSALM 23', lang: 'en' },
  { text: 'JEHOVAH JIREH', lang: 'en' },
  { text: 'I SHALL NOT DIE BUT LIVE', lang: 'en' },
  { text: 'NO HURRY IN AFRICA', lang: 'en' },
  { text: 'SCANDAL!', lang: 'en' },
  { text: 'HATERS WILL SEE', lang: 'en' },
  { text: 'MUKOMA', en: 'Big brother', lang: 'sn', conf: 'high' },
  { text: 'SHAMWARI', en: 'Friend', lang: 'sn', conf: 'high' },
  { text: 'CHITOWN EXPRESS', lang: 'en' },
];

// Zimbabwe number plates (2006 series): "ABC 1234", coat of arms centred, "ZW".
export const PLATES = {
  format: 'LLL NNNN',
  letters: 'ABCDEFGHJKLMNPRSTUVWXYZ',
  countryCode: 'ZW',
  emblem: 'coat of arms, centre',
  size: { w: 0.52, h: 0.113 },
  private: { bg: '#f6f6f1', fg: '#121212' },
  privateOld: { bg: '#f1c40f', fg: '#121212', weight: 0.15 },
  commercial: { bg: '#f6f6f1', fg: '#b3121b' }, // kombis, taxis, trucks, buses
  military: { bg: '#111111', fg: '#f6f6f1' },
  commercialTypes: ['kombi', 'taxi', 'bus', 'truck'],
};

// ---------------------------------------------------------------------------------------------------------------
// KOMBI RANKS AND DESTINATIONS
// ---------------------------------------------------------------------------------------------------------------

// Destinations with direction from the CBD and the shouted/short forms.
export const DESTINATIONS = [
  { name: 'Mbare', calls: ['Mbare!'], dir: 'SW', distKm: 2.5 },
  { name: 'Chitungwiza', calls: ['Chitown!', 'Chitungwiza!', 'Chi-town!'], dir: 'S', distKm: 25 },
  { name: 'Zengeza', calls: ['Zengeza!'], dir: 'S', distKm: 24, via: 'Chitungwiza' },
  { name: 'Seke', calls: ['Seke!'], dir: 'S', distKm: 24, via: 'Chitungwiza' },
  { name: "St Mary's", calls: ["St Mary's!"], dir: 'S', distKm: 22, via: 'Chitungwiza' },
  { name: 'Unit L', calls: ['Unit L!'], dir: 'S', distKm: 26, via: 'Chitungwiza', approx: true },
  { name: 'Budiriro', calls: ['Budiriro!', 'Budiro!'], dir: 'SW', distKm: 13 },
  { name: 'Glen View', calls: ['Glen View!', 'Glen!'], dir: 'SW', distKm: 11 },
  { name: 'Glen Norah', calls: ['Glen Norah!'], dir: 'SW', distKm: 10 },
  { name: 'Highfield', calls: ['Highfield!', 'Machipisa!'], dir: 'SW', distKm: 8 },
  { name: 'Mufakose', calls: ['Mufakose!'], dir: 'W', distKm: 12 },
  { name: 'Kambuzuma', calls: ['Kambuzuma!', 'Kambuzz!'], dir: 'W', distKm: 10 },
  { name: 'Kuwadzana', calls: ['Kuwadzana!'], dir: 'W', distKm: 13 },
  { name: 'Warren Park', calls: ['Warren Park!', 'Warren!'], dir: 'W', distKm: 7 },
  { name: 'Dzivarasekwa', calls: ['Dzivarasekwa!', 'Dzivah!'], dir: 'W', distKm: 14 },
  { name: 'Westlea', calls: ['Westlea!'], dir: 'W', distKm: 9 },
  { name: 'Mabelreign', calls: ['Mabelreign!'], dir: 'NW', distKm: 8 },
  { name: 'Avondale', calls: ['Avondale!'], dir: 'N', distKm: 3.5 },
  { name: 'Mt Pleasant', calls: ['Mt Pleasant!', 'UZ!'], dir: 'N', distKm: 7 },
  { name: 'Borrowdale', calls: ['Borrowdale!'], dir: 'N', distKm: 9 },
  { name: 'Hatcliffe', calls: ['Hatcliffe!'], dir: 'N', distKm: 20 },
  { name: 'Mabvuku', calls: ['Mabvuku!'], dir: 'E', distKm: 16 },
  { name: 'Tafara', calls: ['Tafara!'], dir: 'E', distKm: 17 },
  { name: 'Epworth', calls: ['Epworth!', 'Epiworth!'], dir: 'SE', distKm: 12 },
  { name: 'Ruwa', calls: ['Ruwa!'], dir: 'E', distKm: 22 },
  { name: 'Greendale', calls: ['Greendale!'], dir: 'E', distKm: 8 },
  { name: 'Domboshava', calls: ['Domboshava!', 'Dombo!'], dir: 'N', distKm: 30 },
  { name: 'Waterfalls', calls: ['Waterfalls!', 'Parktown!'], dir: 'S', distKm: 8 },
  { name: 'Hopley', calls: ['Hopley!'], dir: 'S', distKm: 12 },
  { name: 'Town', calls: ['Town! Town!', 'Town, town, town!'], dir: 'CBD', distKm: 0, note: 'shouted in suburbs for CBD-bound kombis' },
];

// Official CBD ranks. Coordinates come from map listings found via search; tweak to snap to OSM bus_station polygons.
export const KOMBI_RANKS = [
  {
    id: 'copacabana',
    name: 'Copacabana',
    altNames: ['Copa', 'Copacabana Bus Terminus'],
    lat: -17.8321,
    lon: 31.0439,
    crossStreets: ['Joseph Msika St (ex-Cameron St)', 'Speke Ave'],
    crossStreetsApprox: true,
    serves: 'western & north-western suburbs',
    destinations: ['Kuwadzana', 'Warren Park', 'Dzivarasekwa', 'Westlea', 'Mabelreign', 'Avondale', 'Mbare', 'Borrowdale'],
    size: 'large',
    kombiCapacity: 40,
    vendors: ['fruit_veg', 'airtime_phone', 'sweets_snacks', 'money_changer', 'secondhand_clothes'],
  },
  {
    id: 'market_square',
    name: 'Market Square',
    altNames: ['Market Square Bus Terminus'],
    lat: -17.836,
    lon: 31.042,
    crossStreets: ['Mbuya Nehanda St', 'Bute St'],
    serves: 'western & southern suburbs',
    destinations: ['Glen Norah', 'Glen View', 'Highfield', 'Budiriro', 'Mbare', 'Mufakose', 'Kambuzuma', 'Waterfalls'],
    size: 'large',
    kombiCapacity: 45,
    vendors: ['fruit_veg', 'airtime_phone', 'money_changer', 'roast_maize', 'secondhand_clothes', 'megaphone_herbalist'],
  },
  {
    id: 'charge_office',
    name: 'Charge Office',
    altNames: ['Charge Office Bus Terminus'],
    lat: -17.8335,
    lon: 31.049,
    crossStreets: ['Julius Nyerere Way', 'Kenneth Kaunda Ave', 'Mayor Urimbo Terrace (ex-Inez Terrace)'],
    crossStreetsApprox: true,
    serves: 'Chitungwiza & southern suburbs',
    destinations: ['Chitungwiza', 'Zengeza', 'Seke', "St Mary's", 'Unit L', 'Hopley', 'Waterfalls'],
    landmark: 'Harare Central Police Station next door',
    size: 'large',
    kombiCapacity: 40,
    vendors: ['fruit_veg', 'airtime_phone', 'sweets_snacks', 'shoe_mender'],
  },
  {
    id: 'fourth_street',
    name: 'Fourth Street',
    altNames: ['Simon Muzenda St Terminus', '4th Street rank'],
    lat: -17.83,
    lon: 31.0558,
    crossStreets: ['Simon Muzenda St (ex-Fourth St)', 'Fifth St', 'Robert Mugabe Rd', 'George Silundika Ave'],
    serves: 'Ruwa, Marondera, eastern & north-eastern suburbs',
    destinations: ['Mabvuku', 'Tafara', 'Epworth', 'Ruwa', 'Greendale', 'Domboshava', 'Borrowdale', 'Hatcliffe'],
    size: 'large',
    kombiCapacity: 50,
    vendors: ['fruit_veg', 'airtime_phone', 'newspaper', 'sweets_snacks', 'umbrella_accessories', 'secondhand_clothes'],
  },
  {
    id: 'rezende',
    name: 'Rezende',
    altNames: ['Ruzende', 'Julia Zvobgo St rank', 'Rezende Parkade'],
    lat: -17.8309,
    lon: 31.0459,
    crossStreets: ['Julia Zvobgo St (ex-Rezende St)', 'Julius Nyerere Way'],
    crossStreetsApprox: true,
    serves: 'Mt Pleasant, University of Zimbabwe, northern suburbs',
    destinations: ['Mt Pleasant', 'Avondale', 'Borrowdale'],
    size: 'medium',
    kombiCapacity: 20,
    vendors: ['airtime_phone', 'sweets_snacks', 'fruit_veg'],
  },
];

// Informal loading points and transport nodes (approx positions; use for spawning kombis/mushikashika).
export const INFORMAL_PICKUPS = [
  { id: 'rmugabe_angwa', name: 'Robert Mugabe Rd / Angwa St', lat: -17.8318, lon: 31.0468, approx: true, destinations: ['Mabvuku', 'Tafara'] },
  { id: 'nyerere_ok', name: 'Julius Nyerere Way (outside supermarket)', lat: -17.8325, lon: 31.0478, approx: true, destinations: ['Waterfalls', 'Hopley'], note: 'Glenwood Park / Maruwa kombis block the road' },
  { id: 'takawira_pirates', name: 'Leopold Takawira St mushikashika rank', lat: -17.8275, lon: 31.0495, approx: true, vehicle: 'mushikashika' },
];

export const TRANSPORT_NODES = [
  { id: 'mbare_musika', name: 'Mbare Musika (rural & intercity buses)', lat: -17.853, lon: 31.037, approx: true, offMap: true },
  { id: 'roadport', name: 'Roadport (international coaches)', lat: -17.831, lon: 31.06, approx: true },
  { id: 'coventry_holding', name: 'Coventry Rd kombi holding bay', lat: -17.8446, lon: 31.0291, approx: true, offMap: true },
  { id: 'harare_station', name: 'Harare railway station', lat: -17.8365, lon: 31.0515, approx: true },
];

// ---------------------------------------------------------------------------------------------------------------
// HWINDI (conductor) CALLS
// ---------------------------------------------------------------------------------------------------------------
// kind: dest | seats | board | depart | fare | cant | banter. {dest} is replaced with a destination call.
export const HWINDI_CALL_PATTERNS = [
  '{dest} {dest} {dest}',
  '{dest} {dest}',
  '{dest} Imwe chete!',
  '{dest} Pindai, pindai!',
  'Ehe, {dest}',
  '{dest} Tiri kuenda!',
];

export const HWINDI_CALLS = [
  { text: 'Town! Town! Town!', lang: 'en', en: 'To the city centre!', kind: 'dest' },
  { text: 'Mbare! Mbare! Mbare!', lang: 'sn', en: 'Mbare!', kind: 'dest' },
  { text: 'Chitown! Chitown!', lang: 'mix', en: 'Chitungwiza!', kind: 'dest' },
  { text: 'Chitungwiza! Zengeza! Seke!', lang: 'sn', en: 'Chitungwiza, Zengeza, Seke!', kind: 'dest' },
  { text: 'Budiriro! Budiro!', lang: 'sn', en: 'Budiriro!', kind: 'dest' },
  { text: 'Glen View! Glen! Glen!', lang: 'en', en: 'Glen View!', kind: 'dest' },
  { text: 'Highfield! Machipisa!', lang: 'sn', en: 'Highfield, Machipisa shops!', kind: 'dest' },
  { text: 'Kuwadzana! Kuwadzana!', lang: 'sn', en: 'Kuwadzana!', kind: 'dest' },
  { text: 'Warren Park! Warren!', lang: 'en', en: 'Warren Park!', kind: 'dest' },
  { text: 'Mabvuku! Tafara!', lang: 'sn', en: 'Mabvuku, Tafara!', kind: 'dest' },
  { text: 'Epworth! Epworth!', lang: 'en', en: 'Epworth!', kind: 'dest' },
  { text: 'Dzivarasekwa! Dzivah!', lang: 'sn', en: 'Dzivarasekwa!', kind: 'dest' },
  { text: 'Avondale! Avondale!', lang: 'en', en: 'Avondale!', kind: 'dest' },
  { text: 'Borrowdale! Borrowdale!', lang: 'en', en: 'Borrowdale!', kind: 'dest' },
  { text: 'Ruwa! Ruwa! Ruwa!', lang: 'sn', en: 'Ruwa!', kind: 'dest' },
  { text: 'Mufakose! Kambuzuma!', lang: 'sn', en: 'Mufakose, Kambuzuma!', kind: 'dest' },
  { text: 'Glen Norah! Glen Norah!', lang: 'en', en: 'Glen Norah!', kind: 'dest' },
  { text: 'Imwe chete! Imwe chete!', lang: 'sn', en: 'Just one more (seat)!', kind: 'seats', conf: 'medium' },
  { text: 'Vaviri chete!', lang: 'sn', en: 'Just two (seats left)!', kind: 'seats', conf: 'medium' },
  { text: 'Tasara nevaviri!', lang: 'sn', en: 'We need two more!', kind: 'seats', conf: 'medium' },
  { text: 'Nzvimbo iripo!', lang: 'sn', en: "There's space!", kind: 'seats', conf: 'high' },
  { text: 'One more! One more!', lang: 'en', en: 'One more seat!', kind: 'seats' },
  { text: 'Pinda, pinda!', lang: 'sn', en: 'Get in, get in!', kind: 'board', conf: 'high' },
  { text: 'Pindai, mhamha!', lang: 'sn', en: 'Get in, ma\'am!', kind: 'board', conf: 'high' },
  { text: 'Pindai, mudhara!', lang: 'sn', en: 'Get in, sir!', kind: 'board', conf: 'high' },
  { text: 'Sisi, huya!', lang: 'mix', en: 'Sister, come!', kind: 'board', conf: 'high' },
  { text: 'Endai kumashure!', lang: 'sn', en: 'Move to the back!', kind: 'board', conf: 'high' },
  { text: 'Tiri kuenda! Tiri kuenda!', lang: 'sn', en: "We're leaving! We're leaving!", kind: 'depart', conf: 'high' },
  { text: 'Yadya basa! Driver, famba!', lang: 'sn', en: "It's full! Driver, go!", kind: 'depart', conf: 'medium', note: '"yadya basa" = kombi full (kombi cant)' },
  { text: 'Dhora rimwe chete!', lang: 'sn', en: 'Just one dollar!', kind: 'fare', conf: 'high' },
  { text: 'Chenji iripo!', lang: 'sn', en: 'There is change!', kind: 'fare', conf: 'high' },
  { text: 'Shura! Shura!', lang: 'sn', en: 'Loads of passengers!', kind: 'cant', conf: 'medium' },
  { text: 'PaKadoma pane nzvimbo!', lang: 'sn', en: "There's space in the middle!", kind: 'cant', conf: 'medium' },
  { text: 'Ndafema!', lang: 'sn', en: "This route isn't paying!", kind: 'cant', conf: 'medium' },
  { text: 'Mapurisa! Mapurisa!', lang: 'sn', en: 'Police! Police! (warning)', kind: 'banter', conf: 'high' },
];

// ---------------------------------------------------------------------------------------------------------------
// PEDESTRIANS
// ---------------------------------------------------------------------------------------------------------------

export const PEDESTRIAN_STYLES = {
  skinTones: ['#3b2219', '#4a2c20', '#5a3825', '#6b4430', '#7a5038', '#8d5f42', '#a0714f', '#c69574', '#e0b896'],
  skinToneWeights: [0.16, 0.2, 0.2, 0.17, 0.12, 0.08, 0.04, 0.02, 0.01],
  hair: ['#0e0b0a', '#1a1412', '#2a1f1a', '#5c5752', '#d8d4cf'],
  hairStyles: ['short_crop', 'shaved', 'braids', 'cornrows', 'afro_puff', 'relaxed_bob', 'wig_straight', 'dreadlocks', 'headwrap', 'cap', 'beanie', 'bald'],
  shirt: ['#ffffff', '#f2efe6', '#bcd4ec', '#1e2d55', '#b01e23', '#f2c200', '#2e6b3f', '#e46f1f', '#6b3e8c', '#111111', '#7c8187', '#d44d7a', '#20a0b0', '#8b5a2b'],
  tshirtPrints: ['plain', 'stripe', 'football_jersey', 'slogan', 'church_event', 'campaign_tee'],
  footballJerseys: ['#1a3fa6' /* blue, Dynamos-style */, '#1f7a3a' /* green, CAPS-style */, '#111111' /* black-white stripes */, '#f2c200' /* national team gold */],
  trousers: ['#1f2a44', '#2e3f66', '#3b3b3b', '#111111', '#6b5a43', '#c2b28f', '#4a5d3a', '#5a6f8f' /* faded jeans */, '#27354f' /* dark jeans */],
  skirt: ['#111111', '#1e2d55', '#3b3b3b', '#6b1f2a', '#2e6b3f', '#c2b28f'],
  dress: ['#d62f3a', '#1d4fb8', '#f2c200', '#2e8b57', '#ff7f2a', '#7b2d8e', '#f2efe6', '#111111', '#e05a8a', '#20a0b0'],
  // Zambia wrap cloth: bright printed cotton (base + two pattern colours).
  zambiaWrap: [
    ['#d62f3a', '#f2c200', '#111111'],
    ['#1d4fb8', '#ffffff', '#f2c200'],
    ['#2e8b57', '#f2c200', '#d62f3a'],
    ['#ff7f2a', '#6b1f2a', '#ffffff'],
    ['#7b2d8e', '#f2c200', '#1d4fb8'],
    ['#20a0b0', '#111111', '#ffffff'],
  ],
  headwrap: ['#d62f3a', '#f2c200', '#1d4fb8', '#2e8b57', '#ff7f2a', '#7b2d8e', '#111111', '#ffffff', '#e05a8a'], // dhuku
  suit: ['#1b2233', '#22262e', '#2f3440', '#111111', '#3b3f47', '#4a3b2e'],
  suitShirt: ['#ffffff', '#dfe9f5', '#f4f1e8', '#e8dff0'],
  tie: ['#6b1f2a', '#1e2d55', '#2e6b3f', '#8a6d1f', '#3b3b3b'],
  shoes: ['#111111', '#3b2a1e', '#6b4a2e', '#ffffff', '#c2c2c2', '#1e2d55'],
  hats: [
    { id: 'sun_hat', colors: ['#d8c9a3', '#ffffff', '#6b5a43'] },
    { id: 'baseball_cap', colors: ['#111111', '#d62f3a', '#1d4fb8', '#ffffff', '#2e8b57'] },
    { id: 'bucket_hat', colors: ['#111111', '#c2b28f', '#4a5d3a'] },
    { id: 'beanie', colors: ['#111111', '#6b1f2a', '#1e2d55'] },
    { id: 'flat_cap', colors: ['#3b3b3b', '#6b5a43'] }, // older men
  ],
  bags: ['#111111', '#6b4a2e', '#d62f3a', '#1d4fb8', '#c2b28f', '#ffffff'],
  shoppingBags: ['#ffffff', '#1d4fb8', '#d62f3a', '#111111'], // plastic carrier bags
  umbrellas: ['#111111', '#1d4fb8', '#d62f3a', '#2e8b57', '#f2c200'], // sun umbrellas at midday
  uniforms: [
    { id: 'primary_boy', label: 'Primary school boy', shirt: '#c9b27c', shorts: '#8b6f47', socks: '#8b6f47', shoes: '#111111', jersey: '#6b1f2a', hat: { id: 'bush_hat', color: '#c9b27c' }, approx: true },
    { id: 'primary_girl', label: 'Primary school girl', dress: '#7fb2e5', collar: '#ffffff', socks: '#ffffff', shoes: '#111111', jersey: '#1e2d55', hat: { id: 'bush_hat', color: '#7fb2e5' }, approx: true },
    { id: 'high_boy_maroon', label: 'High school boy (maroon)', shirt: '#ffffff', trousers: '#6f7378', blazer: '#6b1f2a', tie: '#6b1f2a', shoes: '#111111', approx: true },
    { id: 'high_girl_green', label: 'High school girl (green)', blouse: '#ffffff', pinafore: '#2e6b3f', blazer: '#2e6b3f', socks: '#ffffff', shoes: '#111111', approx: true },
    { id: 'high_girl_navy', label: 'High school girl (navy)', blouse: '#ffffff', skirt: '#1e2d55', jersey: '#1e2d55', socks: '#ffffff', shoes: '#111111', approx: true },
    { id: 'high_boy_navy', label: 'High school boy (navy)', shirt: '#dfe9f5', trousers: '#1e2d55', jersey: '#1e2d55', tie: '#8a6d1f', shoes: '#111111', approx: true },
    { id: 'security_guard', label: 'Private security guard', shirt: '#6f7c8f', trousers: '#1e2d55', cap: '#1e2d55', boots: '#111111', approx: true },
    { id: 'zrp_officer', label: 'ZRP police officer', shirt: '#9fb3c8', trousers: '#1e2d55', cap: '#1e2d55', boots: '#111111', approx: true },
    { id: 'zrp_traffic', label: 'ZRP traffic officer', shirt: '#9fb3c8', trousers: '#1e2d55', cap: '#ffffff', sleeves: '#e8f21b', approx: true, note: 'yellow reflective sleeves' },
    { id: 'municipal_police', label: 'City of Harare municipal police', shirt: '#1e2d55', trousers: '#1e2d55', cap: '#1e2d55', vest: '#e8f21b', approx: true },
    { id: 'parking_marshal', label: 'Parking marshal / rank marshal', vest: '#ff7a1a', shirt: '#ffffff', trousers: '#27354f', approx: true },
    { id: 'apostolic', label: 'Apostolic sect member', robe: '#f8f8f4', headscarf: '#f8f8f4', staff: '#8b6f47', approx: true, note: 'white robes; men with shaved heads and beards, women headscarves' },
  ],
  // NPC archetypes for crowd spawning (weights approx for a weekday midday CBD pavement).
  archetypes: [
    { id: 'office_man', weight: 0.12, outfit: 'suit', props: ['briefcase', 'phone', 'folder'], walkSpeed: [1.3, 1.6] },
    { id: 'office_woman', weight: 0.11, outfit: 'skirt_suit_or_dress', props: ['handbag', 'phone'], walkSpeed: [1.2, 1.5] },
    { id: 'casual_man', weight: 0.15, outfit: 'tshirt_jeans_cap', props: ['phone', 'plastic_bag'], walkSpeed: [1.2, 1.6] },
    { id: 'casual_woman', weight: 0.13, outfit: 'dress_or_skirt_blouse', props: ['handbag', 'plastic_bag', 'umbrella'], walkSpeed: [1.1, 1.4] },
    { id: 'market_woman', weight: 0.08, outfit: 'zambia_wrap_headwrap', props: ['basin_on_head', 'baby_on_back', 'sack'], walkSpeed: [0.9, 1.2], carryOnHeadChance: 0.6, babyOnBackChance: 0.3 },
    { id: 'youth', weight: 0.1, outfit: 'streetwear_hoodie_sneakers', props: ['phone', 'earphones'], walkSpeed: [1.2, 1.7] },
    { id: 'school_kid', weight: 0.06, outfit: 'uniform', props: ['school_bag'], walkSpeed: [1.1, 1.8], hours: [6.5, 8, 13, 17] },
    { id: 'elder', weight: 0.05, outfit: 'jacket_flat_cap_or_long_dress', props: ['walking_stick', 'bible'], walkSpeed: [0.7, 1.0] },
    { id: 'hwindi', weight: 0.04, outfit: 'jeans_cap_hoodie', props: ['folded_notes_between_fingers'], walkSpeed: [1.3, 2.2], nearRanks: true },
    { id: 'security_guard', weight: 0.03, outfit: 'uniform:security_guard', props: ['baton'], stationary: 0.8 },
    { id: 'police', weight: 0.02, outfit: 'uniform:zrp_officer', props: ['notebook'], stationary: 0.5 },
    { id: 'handcart_pusher', weight: 0.02, outfit: 'overalls_or_tshirt', props: ['two_wheel_handcart'], walkSpeed: [0.9, 1.2] },
    { id: 'street_preacher', weight: 0.01, outfit: 'suit', props: ['bible', 'megaphone'], stationary: 0.9 },
    { id: 'apostolic', weight: 0.01, outfit: 'uniform:apostolic', props: ['staff'], groups: [3, 8] },
    { id: 'car_washer', weight: 0.01, outfit: 'shorts_tshirt', props: ['bucket', 'rag'], stationary: 0.7 },
  ],
};

// Common Zimbabwean first names (for NPC name tags / dialogue). Meanings for the Shona names.
export const NPC_FIRST_NAMES = [
  { name: 'Tatenda', en: 'We are thankful', g: 'u' },
  { name: 'Tendai', en: 'Be thankful', g: 'u' },
  { name: 'Farai', en: 'Rejoice', g: 'u' },
  { name: 'Nyasha', en: 'Grace', g: 'u' },
  { name: 'Tinashe', en: 'God is with us', g: 'u' },
  { name: 'Rutendo', en: 'Faith', g: 'f' },
  { name: 'Chipo', en: 'Gift', g: 'f' },
  { name: 'Rumbidzai', en: 'Praise (God)', g: 'f' },
  { name: 'Kudzai', en: 'Honour (God)', g: 'u' },
  { name: 'Tafadzwa', en: 'We have been pleased', g: 'u' },
  { name: 'Tapiwa', en: 'We have been given', g: 'u' },
  { name: 'Takudzwa', en: 'We have been honoured', g: 'u' },
  { name: 'Munashe', en: 'With God', g: 'u' },
  { name: 'Tsitsi', en: 'Mercy', g: 'f' },
  { name: 'Fadzai', en: 'Make happy', g: 'f' },
  { name: 'Tonderai', en: 'Remember', g: 'm' },
  { name: 'Simba', en: 'Strength', g: 'm' },
  { name: 'Tawanda', en: 'We have multiplied', g: 'm' },
  { name: 'Blessing', g: 'u' },
  { name: 'Memory', g: 'f' },
  { name: 'Precious', g: 'f' },
  { name: 'Prosper', g: 'm' },
  { name: 'Givemore', g: 'm' },
  { name: 'Privilege', g: 'f' },
];

// ---------------------------------------------------------------------------------------------------------------
// VENDORS
// ---------------------------------------------------------------------------------------------------------------
// placement: pavement | corner | robot (traffic-light island, walks between cars) | rank | square | verandah
export const VENDOR_TYPES = [
  {
    type: 'fruit_veg',
    weight: 0.26,
    vendor: 'woman (often with baby on back)',
    placement: ['pavement', 'corner', 'rank'],
    goods: ['tomatoes', 'onions', 'potatoes', 'bananas', 'oranges', 'apples', 'avocados', 'leafy greens (covo/rape)', 'sweet potatoes', 'green peppers', 'carrots', 'butternut', 'groundnuts'],
    goodsColors: { tomatoes: '#d6331f', onions: '#b5654a', potatoes: '#b99b6b', bananas: '#f0d23c', oranges: '#f08c1a', apples: '#b3202a', avocados: '#3d5a1f', greens: '#2f7d32', sweetPotatoes: '#8a4b3a', peppers: '#3a9a2a', carrots: '#ef7d1f', butternut: '#e9b05a', groundnuts: '#c89a62' },
    props: ['low wooden table or upturned crates', 'tomatoes stacked in small pyramids of 4-5', 'plastic basins (dishes)', 'cardboard sheet to sit on', 'small plastic bags', 'sun umbrella or shade cloth', 'bucket'],
    callouts: [
      { sn: 'Tengai madomasi!', en: 'Buy tomatoes!', conf: 'high' },
      { sn: 'Madomasi, dhora!', en: 'Tomatoes, a dollar!', conf: 'high' },
      { sn: 'Mabhanana akaibva!', en: 'Ripe bananas!', conf: 'high' },
      { sn: 'Huya uone, mhamha!', en: "Come and see, ma'am!", conf: 'high' },
    ],
  },
  {
    type: 'airtime_phone',
    weight: 0.16,
    vendor: 'young man, sometimes in a bright bib',
    placement: ['corner', 'robot', 'rank', 'pavement'],
    goods: ['airtime scratch cards', 'phone chargers', 'USB cables', 'earphones', 'phone cases', 'screen protectors', 'power banks', 'memory cards'],
    props: ['folding table', 'cardboard display board with hanging cables', 'small glass case', 'waist bag'],
    callouts: [
      { sn: 'Airtime! Airtime!', en: 'Airtime!', conf: 'high' },
    ],
  },
  {
    type: 'sweets_snacks',
    weight: 0.1,
    vendor: 'woman or youth',
    placement: ['pavement', 'rank', 'robot'],
    goods: ['sweets', 'chewing gum', 'biscuits', 'maputi (puffed maize)', 'frozen juice sachets', 'bottled water', 'boiled eggs', 'single cigarettes', 'crisps'],
    props: ['cooler box', 'small tray on a stand', 'bucket of water sachets'],
    callouts: [
      { sn: 'Mvura inotonhora!', en: 'Cold water!', conf: 'high' },
      { sn: 'Mazai! Mazai!', en: 'Eggs! Eggs!', conf: 'high' },
    ],
  },
  {
    type: 'newspaper',
    weight: 0.05,
    vendor: 'man',
    placement: ['robot', 'corner'],
    goods: ['daily newspapers', 'weekly tabloids'],
    props: ['stack of papers under a stone', 'newspaper poster clipped to a lamp post with headline', 'waist pouch'],
    headlines: ['CITY CRACKS DOWN ON VENDORS', 'MYSTERY WEB-SLINGER SPOTTED IN CBD!', 'KOMBI FARES UP AGAIN', 'JACARANDAS IN BLOOM', 'HEATWAVE HITS HARARE'],
    callouts: [{ sn: 'Pepa! Pepa!', en: 'Paper! Paper!', conf: 'medium' }],
  },
  {
    type: 'shoe_mender',
    weight: 0.05,
    vendor: 'older man',
    placement: ['verandah', 'pavement', 'corner'],
    goods: ['shoe repairs', 'polish', 'laces', 'insoles'],
    props: ['wooden shoe-last stand', 'low stool', 'stack of rubber soles (old tyre)', 'glue tin', 'hammer and awl', 'row of repaired shoes', 'beach umbrella'],
  },
  {
    type: 'flowers',
    weight: 0.04,
    vendor: 'women and men at stalls',
    placement: ['square'],
    hotspot: 'africa_unity_square',
    goods: ['red roses', 'lilies', 'sunflowers', 'carnations', 'arum lilies', 'mixed bouquets', 'potted plants'],
    goodsColors: ['#c8102e', '#ffffff', '#f7c21b', '#e75480', '#ff8c42', '#7b2d8e'],
    props: ['metal buckets of water', 'tiered wooden stands', 'cellophane wraps', 'shade under jacarandas'],
    callouts: [{ sn: 'Maruva! Maruva akanaka!', en: 'Flowers! Beautiful flowers!', conf: 'high' }],
  },
  {
    type: 'secondhand_clothes',
    weight: 0.08,
    vendor: 'man or woman',
    placement: ['pavement', 'rank'],
    goods: ['bales of second-hand clothes (mabhero)', 'jeans', 'jackets', 'shoes', 'handbags', 'belts'],
    props: ['plastic sheet on ground', 'clothes hanging from a verandah rail', 'sacks'],
    callouts: [{ sn: 'Mabhero! Sarudzai!', en: 'Bale clothes! Take your pick!', conf: 'medium' }],
  },
  {
    type: 'umbrella_accessories',
    weight: 0.06,
    vendor: 'man',
    placement: ['robot', 'corner'],
    goods: ['sun umbrellas', 'sunglasses', 'hats', 'belts', 'wallets', 'windscreen wipers', 'phone holders', 'toilet paper', 'car fresheners'],
    props: ['goods held up and walked between stopped cars', 'rack or board on shoulder'],
  },
  {
    type: 'money_changer',
    weight: 0.05,
    vendor: 'man or woman (some with disabilities)',
    placement: ['pavement', 'rank'],
    hotspots: ['eastgate_pavements', 'market_square', 'copacabana', 'roadport'],
    goods: ['cash exchange (US$, ZiG, rand)'],
    props: ['brick of banknotes in hand', 'calculator', 'phone'],
    callouts: [
      { sn: 'Mari! Mari!', en: 'Money! Money! (exchange)', conf: 'high' },
      { sn: 'Chenji iripo!', en: 'I have change!', conf: 'high' },
    ],
  },
  {
    type: 'roast_maize',
    weight: 0.04,
    vendor: 'woman',
    placement: ['rank', 'corner'],
    goods: ['roasted maize cobs', 'boiled maize', 'roasted groundnuts'],
    props: ['small charcoal brazier', 'smoke plume', 'basin of cobs'],
    note: 'green maize is scarce in late September (approx); boiled or dried cobs more likely',
  },
  {
    type: 'megaphone_herbalist',
    weight: 0.03,
    vendor: 'man with battery megaphone looping a recording',
    placement: ['pavement', 'rank'],
    goods: ['rat and cockroach poison', 'herbal remedies', 'pirated music on flash drives'],
    props: ['handheld megaphone', 'small mat with packets', 'dead-rat illustration placard'],
    callouts: [
      { sn: 'Mushonga wembeva nemapete!', en: 'Poison for rats and cockroaches!', conf: 'high' },
      { sn: 'Unouraya pakarepo!', en: 'It kills instantly!', conf: 'high' },
    ],
  },
  {
    type: 'barber',
    weight: 0.03,
    vendor: 'young man',
    placement: ['verandah', 'pavement'],
    goods: ['haircuts', 'shaves'],
    props: ['plastic chair', 'mirror nailed to wall', 'clippers on extension cord or battery', 'hand-painted price board'],
  },
  {
    type: 'car_wash',
    weight: 0.02,
    vendor: 'youths',
    placement: ['pavement'],
    goods: ['car washing'],
    props: ['buckets', 'rags', 'water containers', 'wet patch on tarmac'],
  },
];

// Vendor lookout behaviour during 2026 crackdowns ("Operation Chenesa"): whistle, pack, scatter.
export const VENDOR_RAID = {
  lookoutWhistle: true,
  packUpSeconds: [4, 10],
  warnings: [
    { sn: 'Mapurisa! Mapurisa!', en: 'Police! Police!', conf: 'high' },
    { sn: 'Kanzuru!', en: 'Council (municipal police)!', conf: 'medium' },
    { sn: 'Mhanyai!', en: 'Run!', conf: 'high' },
  ],
  sellingHours: [6, 18],
};

// ---------------------------------------------------------------------------------------------------------------
// SHONA / ZIMBABWEAN SPEECH
// ---------------------------------------------------------------------------------------------------------------
// Everyday phrases for speech bubbles. timeOfDay: 'morning' | 'afternoon' | 'evening' (omit = any).
export const NPC_SAYINGS = [
  { sn: 'Mhoro!', en: 'Hi!', conf: 'high' },
  { sn: 'Mhoroi!', en: 'Hello! (respectful)', conf: 'high' },
  { sn: 'Mangwanani!', en: 'Good morning!', timeOfDay: 'morning', conf: 'high' },
  { sn: 'Masikati!', en: 'Good afternoon!', timeOfDay: 'afternoon', conf: 'high' },
  { sn: 'Manheru!', en: 'Good evening!', timeOfDay: 'evening', conf: 'high' },
  { sn: 'Mamuka sei?', en: 'How did you wake up?', timeOfDay: 'morning', conf: 'high' },
  { sn: 'Maswera sei?', en: 'How has your day been?', timeOfDay: 'afternoon', conf: 'high' },
  { sn: 'Makadii?', en: 'How are you? (respectful)', conf: 'high' },
  { sn: 'Wakadii?', en: 'How are you?', conf: 'high' },
  { sn: 'Ndiripo, makadiiwo?', en: "I'm fine, and you?", conf: 'high' },
  { sn: 'Ndiripowo.', en: "I'm fine too.", conf: 'high' },
  { sn: 'Ndeipi?', en: "What's up?", conf: 'high' },
  { sn: 'Hapana, sha.', en: 'Nothing much, bro.', conf: 'high' },
  { sn: 'Zviri sei?', en: 'How are things?', conf: 'high' },
  { sn: 'Zvakanaka.', en: "It's all good.", conf: 'high' },
  { sn: 'Ndatenda!', en: 'Thank you!', conf: 'high' },
  { sn: 'Maita basa!', en: 'Thank you (for your help)!', conf: 'high' },
  { sn: 'Ndinotenda.', en: 'I thank you.', conf: 'high' },
  { sn: 'Fambai zvakanaka!', en: 'Go well!', conf: 'high' },
  { sn: 'Sarai zvakanaka!', en: 'Stay well!', conf: 'high' },
  { sn: 'Tichaonana!', en: 'See you later!', conf: 'high' },
  { sn: 'Pamusoroi.', en: 'Excuse me.', conf: 'high' },
  { sn: 'Ndine urombo.', en: "I'm sorry.", conf: 'high' },
  { sn: 'Hazvina mhosva.', en: 'No problem.', conf: 'high' },
  { sn: 'Imarii?', en: 'How much is it?', conf: 'high' },
  { sn: 'Zvakadhura!', en: "That's expensive!", conf: 'high' },
  { sn: 'Hongu.', en: 'Yes.', conf: 'high' },
  { sn: 'Ehe.', en: 'Yeah.', conf: 'high' },
  { sn: 'Aiwa.', en: 'No.', conf: 'high' },
  { sn: 'Handizivi.', en: "I don't know.", conf: 'high' },
  { sn: 'Hameno.', en: 'Who knows.', conf: 'high' },
  { sn: 'Ndiri kuenda kutown.', en: "I'm going to town.", conf: 'high' },
  { sn: 'Ndanonoka!', en: "I'm late!", conf: 'high' },
  { sn: 'Kwapisa nhasi!', en: "It's hot today!", conf: 'high' },
  { sn: 'Mvura ichanaya here?', en: 'Will it rain?', conf: 'high' },
  { sn: 'Zvinhu zvakaoma.', en: 'Things are tough.', conf: 'high' },
  { sn: 'Ndipei chenji yangu!', en: 'Give me my change!', conf: 'high' },
  { sn: 'Ndichaburuka pano.', en: "I'll get off here.", conf: 'medium' },
  { sn: 'Mira, mudhara!', en: 'Stop, driver!', conf: 'high' },
  { sn: 'Tinotenda Mwari.', en: 'We thank God.', conf: 'high' },
  { sn: 'Shamwari yangu!', en: 'My friend!', conf: 'high' },
  { sn: 'Uri kupi?', en: 'Where are you?', conf: 'high' },
  { sn: 'Ndiri kuuya!', en: "I'm coming!", conf: 'high' },
  { sn: 'Ndiri kutsvaga basa.', en: "I'm looking for work.", conf: 'high' },
  { sn: 'Mhamha, tengai!', en: "Ma'am, buy!", conf: 'high' },
  { sn: 'Deredzai mutengo!', en: 'Lower the price!', conf: 'medium' },
  { sn: 'Makombi eMbare ari kupi?', en: 'Where are the Mbare kombis?', conf: 'medium' },
  { sn: 'Mabasa akaoma nhasi.', en: 'Work is hard today.', conf: 'medium' },
];

// Exclamations when Spider-Man lands, swings or flies overhead.
export const REACTIONS = [
  { sn: 'Hezvo!', en: 'There it is!', conf: 'high' },
  { sn: 'Maiwe!', en: 'Oh my! (lit. "oh mother!")', conf: 'high' },
  { sn: 'Maiwe-e, maiwe!', en: 'Oh my, oh my!', conf: 'high' },
  { sn: 'Mwari wangu!', en: 'My God!', conf: 'high' },
  { sn: 'Tarisa!', en: 'Look!', conf: 'high' },
  { sn: 'Tarisai uko!', en: 'Look over there!', conf: 'high' },
  { sn: 'Hona!', en: 'See!', conf: 'high' },
  { sn: 'Chii ichocho?!', en: 'What is that?!', conf: 'high' },
  { sn: 'Ndiani uyo?', en: 'Who is that?', conf: 'high' },
  { sn: 'Abhururuka!', en: 'He flew!', conf: 'high' },
  { sn: 'Anobhururuka!', en: 'He flies!', conf: 'high' },
  { sn: 'Aenda!', en: "He's gone!", conf: 'high' },
  { sn: 'Waona here?', en: 'Did you see that?', conf: 'high' },
  { sn: 'Handitendi!', en: "I don't believe it!", conf: 'high' },
  { sn: 'Zvinoshamisa!', en: 'Amazing!', conf: 'high' },
  { sn: 'Zvinotyisa!', en: 'Scary!', conf: 'high' },
  { sn: 'Ndatya!', en: "I'm scared!", conf: 'high' },
  { sn: 'Chenjera!', en: 'Watch out!', conf: 'high' },
  { sn: 'Chenjerai!', en: 'Watch out, everyone!', conf: 'high' },
  { sn: 'Mhanya!', en: 'Run!', conf: 'high' },
  { sn: 'Iwe!', en: 'Hey, you!', conf: 'high' },
  { sn: 'Nhai?!', en: 'Really?!', conf: 'high' },
  { sn: 'Yowe-e!', en: 'Yikes!', conf: 'high' },
  { sn: 'Mira!', en: 'Stop!', conf: 'high' },
  { sn: 'Spider-Man auya!', en: 'Spider-Man is here!', conf: 'high' },
  { sn: 'Spider-Man ari kuitei muHarare?', en: 'What is Spider-Man doing in Harare?', conf: 'high' },
  { sn: 'Ndimi here, Spider-Man?', en: 'Is that you, Spider-Man?', conf: 'high' },
  { sn: 'Maita basa, Spider-Man!', en: 'Thank you, Spider-Man!', conf: 'high' },
  { sn: 'Tora pikicha!', en: 'Take a picture!', conf: 'medium' },
  { sn: 'Eish!', en: 'Eish! (dismay)', lang: 'zw-slang', conf: 'high' },
  { sn: 'Haa, sha!', en: 'Whoa, bro!', lang: 'zw-slang', conf: 'high' },
  { sn: 'Ah, no ways!', en: 'No way!', lang: 'en-zw' },
];

// Crime / chase shouts (if the game has pickpocket or bag-snatch events).
export const CRIME_SHOUTS = [
  { sn: 'Mbavha! Mbavha!', en: 'Thief! Thief!', conf: 'high' },
  { sn: 'Batai mbavha!', en: 'Catch the thief!', conf: 'high' },
  { sn: 'Atora bhegi rangu!', en: 'He took my bag!', conf: 'medium' },
  { sn: 'Mapurisa!', en: 'Police!', conf: 'high' },
  { sn: 'Mirai!', en: 'Stop! (to a group)', conf: 'high' },
];

// ---------------------------------------------------------------------------------------------------------------
// TREES
// ---------------------------------------------------------------------------------------------------------------
export const TREES = {
  jacaranda: {
    species: 'Jacaranda mimosifolia',
    weight: 0.45, // share of CBD street/square trees (approx)
    bloom: '#8e6fd1',
    bloomPalette: ['#8e6fd1', '#9c80dc', '#7d62c4', '#a992e3', '#b6a3e8'],
    bloomMonths: [9, 10], // late Sep to late Oct, peak October
    lateSeptemberBloom: 0.55, // fraction of full bloom around 27 Sep (approx; intensifies with heat)
    leaf: '#6f9a3c', // fine fern-like leaves, sparse while in bloom
    leafDensityInBloom: 0.35,
    trunk: '#4e4038',
    height: [8, 14],
    canopyRadius: [4, 7],
    canopyShape: 'wide_umbrella',
    petalCarpet: { color: '#9a82d6', coverage: 0.4 }, // fallen petals purple the tarmac and pavements
    whiteVariantChance: 0.01, // rare white jacarandas on Samora Machel Ave
    whiteBloom: '#f2f0ea',
    where: ['Africa Unity Square (dominant, canopy over flower sellers)', 'Leopold Takawira St', 'the Avenues north of Samora Machel Ave', 'Harare Gardens'],
  },
  flame: {
    // "Flame tree" in Harare = African tulip tree, lining major roads (e.g. Seventh St).
    species: 'Spathodea campanulata',
    weight: 0.12,
    approx: true, // bloom timing and street placement approx
    bloom: '#e0461d',
    bloomPalette: ['#e0461d', '#f05a22', '#c9321a', '#f07a2a'],
    bloomMonths: [8, 9, 10, 11], // approx; flowers through the dry-season end
    lateSeptemberBloom: 0.5,
    leaf: '#2f5e2a',
    trunk: '#5e554b',
    height: [10, 18],
    canopyRadius: [3.5, 6],
    canopyShape: 'dense_upright_oval',
    where: ['Seventh St and major roads'],
  },
  flamboyant: {
    species: 'Delonix regia',
    weight: 0.05,
    bloom: '#e83a21',
    bloomMonths: [11, 12],
    lateSeptemberBloom: 0.0, // not flowering in late September; mostly bare/sparse, pods hanging
    leaf: '#5d8a3a',
    leafDensityLateSep: 0.25,
    pods: '#3b2a1e',
    trunk: '#6e645a',
    height: [7, 12],
    canopyRadius: [5, 8],
    canopyShape: 'flat_spreading',
    where: ['Blakiston St (Avenues)', 'scattered'],
  },
  msasa: {
    species: 'Brachystegia spiciformis',
    weight: 0.04,
    springFlush: ['#8c2a2f', '#a8412f', '#c46a3a', '#d98f5a', '#b33b4a', '#e7b38a'], // wine-red, bronze, amber, pink
    flushMonths: [8, 9], // new leaves Aug-Sep, maturing to green
    lateSeptemberFlush: 0.7,
    matureLeaf: '#3f6b2e',
    trunk: '#4b4038',
    height: [8, 15],
    canopyRadius: [4, 7],
    canopyShape: 'flat_umbrella',
    where: ['remnant specimens, e.g. Josiah Tongogara Ave near Sam Nujoma St', 'parks'],
  },
  bauhinia: {
    species: 'Bauhinia variegata (orchid tree)',
    weight: 0.12,
    bloom: '#d98bc4',
    bloomPalette: ['#d98bc4', '#e8b3d8', '#f4f0f2', '#b8609e'],
    bloomMonths: [8, 9, 10],
    lateSeptemberBloom: 0.6,
    leaf: '#6f9a4a',
    trunk: '#6a5d52',
    height: [5, 8],
    canopyRadius: [2.5, 4],
    canopyShape: 'round',
    where: ['pavement street tree (approved city list)'],
    approx: true,
  },
  eucalyptus: {
    species: 'Eucalyptus spp. (gum)',
    weight: 0.1,
    leaf: '#7f9a86',
    trunk: '#c9c0b0',
    barkPeel: '#8d7b66',
    height: [15, 30],
    canopyRadius: [3, 6],
    canopyShape: 'tall_open',
    where: ['railway reserve, edges, parks'],
  },
  palm: {
    species: 'Washingtonia / date-type palms (approx)',
    weight: 0.04,
    leaf: '#5f7d3a',
    trunk: '#7a6a58',
    height: [8, 18],
    canopyRadius: [2, 3],
    canopyShape: 'palm',
    where: ['government grounds, hotel frontages'],
    approx: true,
  },
  generic: {
    weight: 0.08,
    leaf: '#4f7a34',
    trunk: '#5a4b40',
    height: [5, 10],
    canopyRadius: [2.5, 4.5],
    canopyShape: 'round',
  },
  // Late-September seasonal state
  season: {
    grass: '#b8a46a', // dry winter grass, straw-coloured; watered lawns patchy green '#6f8f3a'
    wateredLawn: '#6f8f3a',
    dustOnLeaves: 0.35,
    bareDeciduousFraction: 0.25,
  },
};

// ---------------------------------------------------------------------------------------------------------------
// STREET PROPS & STREETSCAPE (approx unless noted)
// ---------------------------------------------------------------------------------------------------------------
export const STREET_PROPS = {
  streetlight: {
    style: 'galvanised steel pole with single outreach arm',
    height: 9,
    armLength: 1.8,
    spacing: [30, 40],
    color: '#8a8d90',
    lampColor: '#ffb35c', // sodium-orange; newer LEDs '#f4f1e6'
    ledChance: 0.3,
    workingFraction: 0.4, // ~60% of Harare's streetlights are dark (2025)
  },
  trafficLight: {
    name: 'robot',
    poleColor: '#2b2b2b',
    housingColor: '#1a1a1a',
    backboard: '#111111',
    backboardBorder: '#f2f2f2',
    height: 3.2,
    aspects: ['red', 'amber', 'green'],
    colors: { red: '#ff2b1c', amber: '#ffb000', green: '#19e07a' },
    workingFraction: 0.69, // 48 of 69 CBD signalised intersections worked (May 2025)
    deadModes: ['dark', 'flashing_amber', 'stuck_red'],
  },
  sidewalk: {
    material: 'concrete slabs / paving bricks, cracked, patched with tar',
    color: '#a39d92',
    kerbHeight: 0.18,
    kerbColor: '#b8b2a6',
    kerbPaint: ['#f2f2f2', '#1a1a1a'], // faded black/white kerb striping at ranks and corners
    width: [3, 6], // wide CBD pavements
    litter: 0.35,
  },
  verandah: {
    // cantilevered shop canopies over the pavement on older 1-3 storey blocks
    chance: 0.45,
    depth: [2.2, 3.5],
    height: [3.2, 4.0],
    fascia: ['#f2efe6', '#c9c2b0', '#6f7378', '#1e2d55', '#8b2a2a'],
    columnsChance: 0.3, // some supported on thin steel/concrete posts at the kerb
  },
  shopfront: {
    rollerShutter: '#9aa0a6',
    burglarBars: 0.6,
    paintedSigns: true,
    signColors: ['#d6201f', '#f2c200', '#1d4fb8', '#2e8b57', '#ffffff', '#111111'],
    speakerOutside: 0.2, // shops blasting music onto the street
  },
  busShelter: {
    style: 'steel frame, corrugated or flat sheet roof, bench, often missing panels',
    frame: '#5c6b73',
    roof: '#b9bdb8',
    size: { w: 4, d: 1.8, h: 2.6 },
  },
  bollard: { style: 'concrete', color: '#b8b2a6', height: 0.8, diameter: 0.3, stripe: '#f2c200', where: ['rank edges', 'square perimeters', 'pedestrian malls (First St)'] },
  bin: { style: 'steel drum or concrete bin on pole / skip at ranks', colors: ['#2e6b3f', '#1e2d55', '#6f7378'], overflowChance: 0.5, skipColor: '#c77b1f' },
  litter: { items: ['plastic bags', 'water sachets', 'maize husks', 'paper', 'bottles', 'airtime card scraps'], colors: ['#ffffff', '#1d4fb8', '#d6201f', '#e6d9a8', '#7aa0b8'], hotspots: ['fourth_street', 'copacabana', 'market_square'] },
  billboard: { style: 'steel gantry on rooftop or pole', size: [[6, 3], [12, 4]], content: 'GENERIC_SIGNAGE', faded: 0.4 },
  handcart: { color: '#6b4a2e', wheel: '#111111', length: 2.2, width: 1.0 },
  vendorUmbrella: { diameter: 2.2, colors: ['#d6201f', '#1d4fb8', '#2e8b57', '#f2c200', '#ffffff', '#ff7a1a'] },
  generator: { color: '#d6201f', size: [0.8, 0.6, 0.6], humHz: 50, note: 'diesel/petrol gensets outside shops during power cuts' },
  fountain: { where: 'africa_unity_square', note: 'large central fountain' },
};

// Invented businesses for signage (do not use real brands).
export const GENERIC_SIGNAGE = [
  'MUZUKURU WHOLESALERS', 'TAKUNDA BUTCHERY', 'SIMBA HARDWARE', 'CHIPO FASHIONS', 'NHASI CELLPHONE REPAIRS',
  'RUFARO SUPERMARKET', 'KUDZI BAKERY', 'ZIVAI PHARMACY', 'MAKOMBORERO BOUTIQUE', 'HWINDI HAIR SALON',
  'NYASHA ELECTRICALS', 'JACARANDA TAKEAWAYS', 'SUNSHINE CITY FURNITURE', 'KOPJE MOTOR SPARES', 'AVENUES DENTAL SURGERY',
  'MUSHANDIRAPAMWE TAILORS', 'TENDAI CASH & CARRY', 'CITY CENTRE OPTICIANS', 'TAWANDA FAST FOODS', 'KUMUSHA BUILDING SUPPLIES',
  'MAKANAKA PAWN SHOP', 'SADZA & STEW 24HRS', 'ZIG EXCHANGE BUREAU', 'SUPER BUS TOURS', 'HOPE CLINIC',
];

// ---------------------------------------------------------------------------------------------------------------
// TRAFFIC RULES & FEEL
// ---------------------------------------------------------------------------------------------------------------
export const TRAFFIC = {
  driveOnLeft: true,
  rightHandDrive: true,
  speedLimitUrban: kmh(60),
  typicalCbdSpeed: [kmh(15), kmh(40)],
  peakHours: [[6.5, 8.5], [16.5, 18.5]], // approx
  densityByHour: { 0: 0.05, 5: 0.15, 6: 0.5, 7: 0.9, 8: 0.85, 10: 0.6, 12: 0.7, 13: 0.75, 15: 0.7, 17: 1.0, 18: 0.9, 19: 0.5, 21: 0.2, 23: 0.08 }, // approx
  trafficLightName: 'robot',
  robots: {
    signalisedIntersectionsCbd: 69,
    workingFraction: 0.69,
    cycle: { green: 28, amber: 3, allRed: 1.5, red: 30 }, // approx
    atDeadRobot: 'treat as uncontrolled; kombis and mushikashika push through, others creep (4-way stop feel)',
  },
  laneWidth: 3.4, // approx
  laneDefaults: {
    // fallback when OSM has no lanes tag (approx). Values are lanes per direction.
    primaryAvenue: 2, // Samora Machel, Julius Nyerere, Jason Moyo, Nelson Mandela, Robert Mugabe Rd, Kenneth Kaunda
    secondary: 2,
    street: 1,
    oneWayStreet: 3,
  },
  oneWay: 'Several CBD streets are one-way; honour OSM oneway tags. No reliable list was found.',
  markings: {
    standard: 'SADC Road Traffic Signs Manual',
    laneLine: { color: '#eeeeea', dash: [3, 6], width: 0.1 },
    leftEdgeLine: { color: '#e8c21a', width: 0.1 }, // yellow edge on the left (kerb) side
    rightEdgeLineDivided: { color: '#eeeeea', width: 0.1 },
    stopLine: { color: '#eeeeea', width: 0.5 },
    zebra: { color: '#eeeeea', stripe: 0.5, gap: 0.5 },
    fadedFraction: 0.6, // CBD markings mostly faded/worn (approx)
    asphalt: ['#3a3a3c', '#4a494a', '#565453'],
    potholeDensity: 0.25,
  },
  behaviour: {
    kombi: { runRedChance: 0.35, stopAnywhereChance: 0.6, wrongSideChance: 0.06, pavementChance: 0.02, turnLaneStraightChance: 0.2, hoot: 'short double toot to solicit passengers' },
    mushikashika: { runRedChance: 0.5, stopAnywhereChance: 0.7, wrongSideChance: 0.1, pavementChance: 0.04 },
    private: { runRedChance: 0.05, hootAtDelay: 0.3 },
    bus: { runRedChance: 0.05 },
    pedestrians: { jaywalk: 0.6, crossBetweenStoppedCars: true },
  },
  horn: {
    // car horns: dual tone ~400/500 Hz; kombi horns often shriller aftermarket units (approx)
    car: { freqs: [415, 520], pattern: [[0, 0.35]] },
    kombi: { freqs: [480, 600], pattern: [[0, 0.12], [0.2, 0.12]] }, // "toot-toot"
    bus: { freqs: [300, 375], pattern: [[0, 0.6]] },
    musicalHornChance: 0.05,
  },
  parking: { style: 'kerbside parallel/angle bays with orange-bibbed marshals', doubleParking: 0.2 },
};

// ---------------------------------------------------------------------------------------------------------------
// SOUND DESIGN (for synthesis; approx unless noted)
// ---------------------------------------------------------------------------------------------------------------
export const SOUNDSCAPE = {
  layers: [
    { id: 'traffic_bed', desc: 'low diesel rumble plus tyres; old HiAce diesel idle ~700 rpm (4-cyl firing ~23 Hz), rattling bodywork', gain: 0.5 },
    { id: 'kombi_hoots', desc: 'short double toots, frequent near ranks and robots', ratePerMinNearRank: 25, ratePerMinStreet: 6 },
    { id: 'hwindi_shouts', desc: 'young male voices, destination repeated 2-3x, rhythmic', source: 'HWINDI_CALLS', nearRanks: true },
    { id: 'rank_whistles', desc: 'marshals\' pea-whistle blasts, 2.5-3.5 kHz trill', ratePerMinNearRank: 4 },
    { id: 'shop_music', desc: 'shop loudspeakers blasting onto pavement; distorted, bass-light', genres: 'MUSIC_STYLES', perBlockChance: 0.4 },
    { id: 'megaphones', desc: 'looped recorded vendor pitch through a cheap megaphone: bandpass 800-3000 Hz, clipped', source: 'VENDOR_TYPES.megaphone_herbalist.callouts' },
    { id: 'street_preacher', desc: 'amplified sermon with reverb from buildings, call-and-response "Amen!"', chance: 0.2 },
    { id: 'crowd_murmur', desc: 'Shona/English chatter, laughter, phone calls', gain: 0.35 },
    { id: 'generators', desc: 'small gensets humming outside shops during power cuts (50 Hz + harmonics)', chance: 0.3 },
    { id: 'birds', source: 'BIRDS', gain: 0.25 },
    { id: 'wind', desc: 'dry gusty September wind, rustling jacaranda and paper litter', gain: 0.2 },
  ],
  night: ['crickets (4-5 kHz chirps)', 'distant dogs barking', 'occasional hooting', 'generator hum', 'music from a bar', 'security guard whistle'],
};

export const MUSIC_STYLES = [
  {
    id: 'sungura',
    bpm: [125, 135],
    desc: 'fast interlocking picked electric guitars (clean, chorus), busy melodic bass runs, driving hi-hat and snare on the offbeat',
    synthHints: { lead: 'plucked saw/triangle, short decay, 16th-note arpeggios', bass: 'round sine+square, walking', drums: 'hi-hat 8ths, snare 2&4, kick 4-on-floor-ish' },
    weight: 0.35,
  },
  {
    id: 'zimdancehall',
    bpm: [90, 105],
    approx: true,
    desc: 'digital dancehall riddims, heavy sub bass, sparse synth stabs, chanted vocals',
    synthHints: { bass: 'sub sine with glide', drums: 'dembow-ish kick/snare pattern', stabs: 'short detuned square chords' },
    weight: 0.3,
  },
  {
    id: 'gospel',
    bpm: [100, 120],
    approx: true,
    desc: 'keyboard-led choir gospel, handclaps',
    synthHints: { keys: 'electric piano chords', drums: 'claps on 2&4' },
    weight: 0.2,
  },
  {
    id: 'amapiano',
    bpm: [110, 115],
    approx: true,
    desc: 'log-drum bass, shakers, airy pads (popular across the region in the 2020s)',
    synthHints: { bass: 'pitched log-drum: sine with fast pitch envelope', perc: 'shaker 16ths' },
    weight: 0.15,
  },
];

export const BIRDS = [
  { id: 'cape_turtle_dove', name: 'Cape turtle dove (ring-necked dove)', call: 'rhythmic 3-syllable croon "kuk-KOORR-uk", repeated', freqHz: [400, 700], weight: 0.25, time: 'day' },
  { id: 'laughing_dove', name: 'Laughing dove', call: 'soft bubbling "oo-ku-ku-ku-oo"', freqHz: [350, 650], weight: 0.15, time: 'day', approx: true },
  { id: 'rock_pigeon', name: 'Feral pigeon', call: 'low cooing on ledges, wing claps on take-off', freqHz: [250, 500], weight: 0.2, time: 'day', approx: true },
  { id: 'dark_capped_bulbul', name: 'Dark-capped bulbul', call: 'bright chatter "sweet-sweet-sweet-potato"', freqHz: [1500, 3500], weight: 0.15, time: 'day' },
  { id: 'pied_crow', name: 'Pied crow', call: 'harsh "kraak"', freqHz: [600, 1800], weight: 0.08, time: 'day', approx: true },
  { id: 'little_swift', name: 'Little swift', call: 'high screaming trills around tall buildings', freqHz: [4000, 7000], weight: 0.08, time: 'day', approx: true },
  { id: 'grey_go_away_bird', name: 'Grey go-away-bird', call: 'nasal drawn-out "gwaaay" / "go-way"', freqHz: [500, 1500], weight: 0.05, time: 'day', where: 'parks, Harare Gardens' },
  { id: 'hadeda', name: 'Hadeda ibis', call: 'loud "ha-ha-haa-de-da" in flight, dawn/dusk', freqHz: [700, 2000], weight: 0.02, time: 'dawn_dusk', note: 'historically rare in Mashonaland; use sparingly' },
  { id: 'crickets', name: 'Field crickets', call: 'continuous chirps', freqHz: [4000, 5000], weight: 0, time: 'night' },
];

// ---------------------------------------------------------------------------------------------------------------
// SKY / LIGHT — late September (dry season, hot, hazy highveld, 1490 m)
// ---------------------------------------------------------------------------------------------------------------
// Sun computed (NOAA algorithm) for 27 Sep 2026, lat -17.83, lon 31.05, CAT (UTC+2).
// `dir` is a unit vector from the scene toward the sun in world axes (x east, y up, z south).
export const SKY = {
  date: '2026-09-27',
  sunrise: 5.69, // 05:41
  sunset: 17.88, // 17:53
  civilDawn: 5.33, // 05:20
  civilDusk: 18.23, // 18:14
  solarNoon: 11.78, // 11:47
  noonElevation: 73.9, // sun to the NORTH at noon (declination -1.7°)
  sunriseAzimuth: 92.0,
  sunsetAzimuth: 267.8,
  defaultTimeOfDay: 10.5,
  approxColors: true, // keyframe colours are art-directed estimates; sun angles are computed
  climate: {
    highC: 28.8,
    lowC: 12.9,
    humidity: 0.39,
    rainDays: 1,
    windKmh: 25, // windiest month
    cloudCover: 0.05, // almost cloudless; build-up clouds from mid-October
    visibilityKm: [10, 20],
    hazeSources: ['veld-fire smoke (peak Aug-Oct)', 'dust'],
  },
  keyframes: [
    { t: 0.0, elev: -70.4, az: 170.3, dir: [0.057, -0.942, 0.331], zenith: '#05070d', horizon: '#141722', fog: '#0f121a', sunColor: '#000000', sunIntensity: 0, ambient: 0.08, cityGlow: '#3a2a1a' },
    { t: 5.0, elev: -10.7, az: 95.2, dir: [0.979, -0.185, 0.089], zenith: '#0b1224', horizon: '#2a2a3a', fog: '#1e2130', sunColor: '#000000', sunIntensity: 0, ambient: 0.12 },
    { t: 5.33, elev: -6.0, az: 93.6, dir: [0.993, -0.104, 0.063], zenith: '#1b2847', horizon: '#6b5a5a', fog: '#4a4450', sunColor: '#000000', sunIntensity: 0, ambient: 0.2 },
    { t: 5.69, elev: -0.8, az: 92.0, dir: [0.999, -0.014, 0.034], zenith: '#3c5a86', horizon: '#e39a62', fog: '#b98c72', sunColor: '#ff7a3a', sunIntensity: 0.2, ambient: 0.35 },
    { t: 6.0, elev: 3.6, az: 90.5, dir: [0.998, 0.063, 0.009], zenith: '#5a7fae', horizon: '#f0b27a', fog: '#d1a888', sunColor: '#ff9150', sunIntensity: 0.6, ambient: 0.45 },
    { t: 6.5, elev: 10.8, az: 88.2, dir: [0.982, 0.187, -0.03], zenith: '#6a91c2', horizon: '#e8c7a0', fog: '#d8c3a8', sunColor: '#ffb070', sunIntensity: 1.2, ambient: 0.6 },
    { t: 7.5, elev: 25.0, az: 83.3, dir: [0.9, 0.423, -0.106], zenith: '#6d9bd0', horizon: '#d9d2c2', fog: '#d3cbbb', sunColor: '#ffd9a8', sunIntensity: 2.0, ambient: 0.8 },
    { t: 9.0, elev: 46.0, az: 73.2, dir: [0.665, 0.719, -0.201], zenith: '#5f93cf', horizon: '#cfd0c8', fog: '#cbc8bd', sunColor: '#fff0d8', sunIntensity: 2.6, ambient: 0.95 },
    { t: 10.5, elev: 65.2, az: 51.6, dir: [0.329, 0.908, -0.261], zenith: '#588dcb', horizon: '#cdd0cb', fog: '#c9c8bf', sunColor: '#fff4e2', sunIntensity: 2.9, ambient: 1.0 },
    { t: 11.78, elev: 73.9, az: 0.0, dir: [0.0, 0.961, -0.278], zenith: '#5689c6', horizon: '#cfd0ca', fog: '#cac7bd', sunColor: '#fff6e8', sunIntensity: 3.0, ambient: 1.0 },
    { t: 13.0, elev: 65.9, az: 309.8, dir: [-0.314, 0.913, -0.262], zenith: '#5a8bc6', horizon: '#d2d0c6', fog: '#ccc7ba', sunColor: '#fff3e0', sunIntensity: 2.9, ambient: 1.0 },
    { t: 14.5, elev: 46.9, az: 287.2, dir: [-0.653, 0.73, -0.202], zenith: '#618fc7', horizon: '#d6d0c0', fog: '#cfc6b4', sunColor: '#ffeccf', sunIntensity: 2.6, ambient: 0.95 },
    { t: 16.0, elev: 25.9, az: 276.9, dir: [-0.893, 0.437, -0.108], zenith: '#6891c4', horizon: '#dccdb0', fog: '#d2c1a2', sunColor: '#ffd49a', sunIntensity: 2.0, ambient: 0.8 },
    { t: 17.0, elev: 11.7, az: 271.9, dir: [-0.979, 0.202, -0.032], zenith: '#6a86b3', horizon: '#e8b27a', fog: '#d6a67c', sunColor: '#ffab5c', sunIntensity: 1.3, ambient: 0.6 },
    { t: 17.5, elev: 4.5, az: 269.6, dir: [-0.997, 0.079, 0.008], zenith: '#5a6f9a', horizon: '#ef8f4f', fog: '#c98460', sunColor: '#ff7a36', sunIntensity: 0.7, ambient: 0.45 },
    { t: 17.88, elev: -0.9, az: 267.8, dir: [-0.999, -0.015, 0.038], zenith: '#44557e', horizon: '#d9683d', fog: '#9a6552', sunColor: '#ff5a26', sunIntensity: 0.15, ambient: 0.32 },
    { t: 18.23, elev: -5.9, az: 266.2, dir: [-0.993, -0.102, 0.066], zenith: '#26304f', horizon: '#7a4a4a', fog: '#4a3a40', sunColor: '#000000', sunIntensity: 0, ambient: 0.18, cityGlow: '#3a2a1a' },
    { t: 18.75, elev: -13.3, az: 263.7, dir: [-0.967, -0.23, 0.107], zenith: '#111a30', horizon: '#2e2a36', fog: '#1f1e28', sunColor: '#000000', sunIntensity: 0, ambient: 0.1, cityGlow: '#3a2a1a' },
    { t: 20.0, elev: -30.9, az: 256.6, dir: [-0.835, -0.513, 0.199], zenith: '#070a14', horizon: '#171a24', fog: '#11141c', sunColor: '#000000', sunIntensity: 0, ambient: 0.08, cityGlow: '#3a2a1a' },
  ],
  haze: {
    color: '#cbc4b2', // warm dusty grey-beige
    fogNear: 250,
    fogFar: 2200, // approx from 10-20 km visibility, compressed for game scale
    horizonBandHeightDeg: 8,
    sunsetExtraRedden: 0.3, // smoke makes low sun orange-red
  },
  moon: { note: 'Full moon on 26 Sep 2026 (approx): bright moon rising in the east around sunset', approx: true },
  stars: { density: 0.6, note: 'Southern Cross low in the south-west in the evening (approx)' },
  nightLighting: { streetlightWorkingFraction: 0.4, shopLightColor: '#ffd8a0', generatorLitShopsFraction: 0.3 },
};
