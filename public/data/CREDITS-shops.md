# shops.json: data sources, authors and licences

`public/data/shops.json` (the shop, bank, hotel and office signs of central Harare) is a derived database built by
`tools/build_shops.py`. It contains no images, logos or fonts: only names, categories, positions and colour values.
Method, schema and the per-business evidence list are in `docs/references/BUSINESSES.md`.

| Source | Author / rights holder | Licence | URL | What was used |
|---|---|---|---|---|
| Overture Maps places, release 2026-09-23.0 (record sources: Meta, Microsoft) | Overture Maps Foundation and its contributors | CDLA-Permissive-2.0 | https://docs.overturemaps.org/attribution/ | business names, categories, addresses and positions (1 079 signs: 1 018 with a Meta record, 50 with a Microsoft record) |
| Overture Maps places: AllThePlaces records (8 of those signs) | AllThePlaces contributors | CC0-1.0 | https://www.alltheplaces.xyz/ | as above |
| Overture Maps places: Foursquare OS Places records (3 of those signs) | Foursquare Labs, Inc. | Apache-2.0 | https://opensource.foursquare.com/os-places/ | as above |
| OpenStreetMap (Overpass snapshots of 2026-06-01 and 2026-09-27) | OpenStreetMap contributors | ODbL 1.0 | https://www.openstreetmap.org/copyright | named shops, amenities, offices and named buildings (271 signs) and the footprints the signs sit on (via `harare.json`) |
| `public/data/harare.json` building footprints | see the map attribution in `harare.json` `meta.attribution` (Overture Maps Foundation, OpenStreetMap contributors, Google Open Buildings, Microsoft ML Buildings) | ODbL 1.0 / CDLA-Permissive-2.0 / CC BY 4.0 | https://overturemaps.org/ | building index `b` and facade geometry |
| Web research (branch locators, directories, news, hotel sites) | the sites cited per row in `docs/references/BUSINESSES.md` §7 | facts only: no text, image or logo copied | see §7 | which business is at which address, and whether it is still open |
| Brand colours | sampled from each brand's own logo file or site, or estimated (§6) | facts only: hex values, no logo artwork | see §6 | `styles[].bg / fg / accent` |

Obligations:

- **ODbL share-alike.** `shops.json` is a Derivative Database of OpenStreetMap data, so it is offered under ODbL 1.0.
  Keep the attribution below visible to players, and publish the file (it is, in this repo) with this notice.
- **Attribution** (already shown by `src/ui/credits.js` and the big map; keep it there):
  "© OpenStreetMap contributors (ODbL)" and "© Overture Maps Foundation" (places under CDLA-Permissive-2.0; includes
  AllThePlaces data (CC0) and Foursquare OS Places data (Apache-2.0)).
- **Trademarks.** Business and brand names appear as plain text in the brand's colours so the streets read as real;
  no logos, emblems or trademarked artwork are reproduced, and no endorsement is implied.
