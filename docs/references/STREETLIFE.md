# Harare CBD street life: research notes

This is the reference for vehicles, NPCs, props, trees, sound and sky in *Spider-Man in Harare CBD* (a fan project).
The game reads its data from `src/data/streetlife.js`. This document explains where those numbers come from.

**About the research.** Only web search result snippets were available. Wikipedia, OSM, Commons, mapcarta and
news sites were blocked for direct fetch. Every URL below is a search result that supported the claim next to it.
Anything tagged **(approx)** is our own estimate or general knowledge that no source confirmed. Treat those values as
tunable defaults, not facts. Street geometry, lane counts and one-way flags should come from the OSM/Overture map
build (`tools/build_map.py`), not from this file.

Game origin: Africa Unity Square, lat -17.82932, lon 31.05202 (see `src/core/geo.js`). Harare's Wikipedia coordinates
are 17°49′45″S 31°3′8″E (-17.8292, 31.0522). Elevation is about 1,490 m.

---

## 1. Kombis (commuter omnibuses)

### Vehicles
- Kombis are mostly **Toyota HiAce** vans, plus some **Nissan Caravan**, imported second-hand from Japan and the UK.
  Harare has roughly 8,000+ intracity public transport vehicles (kombis, minibuses and buses). Kombi routes run up to
  about 20 km, and a kombi makes at least 6 round trips a day. About 40% of kombis do not comply with permits.
  Operators often run some vehicles under the ZUPCO franchise and some privately.
  UNEP-CCC e-Bus feasibility study: https://unepccc.org/wp-content/uploads/2022/08/e-bus-market-feasibility-in-city-of-harare.pdf
- The HiAce is the most popular kombi. Longer routes also use Toyota Quantum, Iveco and Sprinter minibuses.
  https://startupbiz.co.zw/starting-minibus-kombi-transport-business-zimbabwe-business-plan/ ,
  https://www.pindula.co.zw/Kombi
- Engines seen in Zimbabwe listings are the old **3L/5L diesel** and newer 1.8–2.8 L units.
  https://www.zimauto.co.zw/cars/for-sale/toyota/hiace , https://www.carbarn.co.zw/cars/toyota/hiace
- **(approx)** The typical Harare city kombi is a 1990s–2000s long-wheelbase HiAce "Commuter" (H100 series, boxy
  flat-nosed cab-over), about 4.7 × 1.7 × 2.0 m. Newer semi-bonneted H200 "Quantum" vans are also seen.
- **Passengers.** The VID registers most HiAce kombis for **15 seated passengers**. The "18-seater" layout packs
  four people per bench across four rows, with two beside the driver. Overloading is common and makes the news.
  https://becomingthemuse.net/2018/09/22/of-combie-diaries/ , https://allafrica.com/stories/201010251328.html ,
  https://www.myzimbabwe.co.zw/news/189710-chivhu-accident-update-15-seater-kombi-had-33-passengers-27-killed-22-bodies-identified-5-dna-tests-required-7-in-critical-condition.html

### Livery and decoration
- Most kombis are **white** (metered taxis are usually white or silver).
  https://thingstodoinzimbabwe.com/transportation/taxi-rideshare/
- In 2019 kombis joined the **ZUPCO franchise** and carried ZUPCO stickers. In 2020, fake ZUPCO sticker sets sold for
  about US$15 per kombi. https://allafrica.com/stories/201910120016.html ,
  https://www.pindula.co.zw/2020/05/31/kombis-with-fake-zupco-stickers-flood-roads/ ,
  https://startupbiz.co.zw/desperate-kombis-use-fake-zupco-stickers-to-get-back-on-the-road/
- **Inscriptions and names.** Kombis carry messages, maxims and names on banners, the windscreen top strip and the
  rear window. These include Bible verses and religious names, football stars, song titles, and topical jokes such as
  "Asiagate", "Scandal!", "9/11" and "Osama Bin Laden" (early 2000s). Kombis also work as mobile billboards.
  https://www.newsday.co.zw/2013/05/multimedia-the-writing-is-on-the-kombi ,
  https://benjamins.com/catalog/ijolc.00055.cha ,
  https://bulawayo24.com/index-id-news-sc-national-byo-264391.html
- **(approx)** Roof racks are uncommon on city routes and more common on long-distance kombis. Bodies are dusty, some
  have factory side stripes, and bumpers are often dented.

### Crew and language
- The **hwindi** (plural **mahwindi**) is the conductor or tout, and can mean the loaders and even the driver. A hwindi
  calls for passengers while the kombi waits at the rank and is paid once it is full.
  https://www.newsday.co.zw/2013/07/touts-the-best-language-masters , https://becomingthemuse.net/2018/09/22/of-combie-diaries/
- **Kombi cant** (Sabao, *Zimbabwean 'kombi' cant*):
  - "yadya basa": the kombi is full.
  - "shura": many commuters waiting.
  - "PaKadoma": the middle of the bus.
  - "Kusvipa shura": forced offloading, after a breakdown or by police.
  - "Ndafema!": a driver's complaint that the route did not pay.

  https://www.taylorfrancis.com/chapters/edit/10.4324/9781032705897-5/zimbabwean-kombi-cant-collen-sabao ,
  https://www.newsday.co.zw/2013/07/touts-the-best-language-masters
- **Destination nicknames.** "Chitown" means Chitungwiza. "Town" means the CBD.
  https://en.wikipedia.org/wiki/Chitungwiza (search summary)
- **(approx)** A hwindi shouts the destination two or three times in rhythm ("Mbare! Mbare! Mbare!"). He calls the
  number of free seats and waves passengers in. Rank marshals blow whistles. Drivers give short double hoots to catch
  pedestrians' attention. https://iniafrica.com/kombi-chaos-harares-streets-under-siege-by-disorder/

### Driving style
- Kombi and mushikashika crews drive against traffic and in the wrong lanes. They go straight from turning lanes, run red
  lights, drive on pavements and load at undesignated points.
  https://jtscm.co.za/index.php/jtscm/article/view/315/610 ,
  https://www.thestandard.co.zw/2016/12/18/mushikashika-authored-protected-influential ,
  https://newziana.co.zw/police-arrest-reckless-kombi-driver-featured-in-viral-video/
- On Julius Nyerere Way, kombis stop just past the flyover and load outside OK supermarket (for Glenwood Park and
  Maruwa), which blocks traffic. https://www.heraldonline.co.zw/plans-to-decongest-julius-nyerere-underway/ ,
  https://iniafrica.com/kombi-chaos-harares-streets-under-siege-by-disorder/

### Policy context (2025–2026)
- The Harare master plan for 2025–2045 includes Policy 109 (remove kombis within 36 months) and Policy 110 (end pirate
  taxis now). More than 13,500 unregistered kombis still operate.
  https://www.newsday.co.zw/local-news/article/200043929/harare-to-ban-kombis-pirate-taxis ,
  https://www.heraldonline.co.zw/the-countdown-to-kombi-phase-out-begins/
- **Operation Chenesa Harare** began on 9 September 2026 against CBD vendors. The government then relented and allowed
  selling between 06:00 and 18:00. Vendors use whistles and WhatsApp groups to warn each other.
  https://allafrica.com/stories/202609180020.html ,
  https://nehandaradio.com/2026/09/22/whistles-whatsapp-and-moving-stalls-how-harare-vendors-are-outsmarting-operation-chenesa/
  The game can show whistle-blowing lookouts and vendors packing up quickly.

## 2. CBD kombi ranks (termini)

Official CBD ranks and the areas they serve (Herald / Pindula, 2018 onward):

| Rank | Serves | Approx. coordinates | Cross streets |
|---|---|---|---|
| **Copacabana** | Western and north-western suburbs (sometimes listed as western and southern). Kuwadzana, Warren Park, Dzivarasekwa, Westlea, Avondale, Ashdown Park, Mbare, Borrowdale | -17.8321, 31.0439 (mapcarta W541564208 via search) | 110 Cameron St, now **Joseph Msika St**, around Speke Ave (approx) |
| **Market Square** | Western and southern suburbs: Glen Norah, Glen View, Highfield (Machipisa), Budiriro, Mbare, Parktown/Waterfalls | -17.8360, 31.0420 (mapcarta W408937261) | **Mbuya Nehanda St / Bute St**, by the old Market Hall |
| **Charge Office** | Chitungwiza (Chikwanha hub, Seke, Zengeza) and southern suburbs | -17.8335, 31.0490 (Waze listing) | Next to Harare Central Police Station, near **Julius Nyerere Way / Kenneth Kaunda Ave** and Mayor Urimbo Terrace (ex-Inez Terrace) (approx) |
| **Fourth Street** (Simon Muzenda St terminus) | Ruwa, Marondera, eastern and north-eastern suburbs: Mabvuku, Tafara, Epworth, Greendale, Chisipite, Domboshava, Damofalls | -17.8300, 31.0558 (wikimapia 17°49'48"S 31°3'21"E) | **Simon Muzenda St** (ex-Fourth St) and Fifth St, between **Robert Mugabe Rd** and George Silundika Ave |
| **Rezende** (Julia Zvobgo St) | Mount Pleasant, University of Zimbabwe; (approx) Avondale and northern suburbs | -17.8309, 31.0459 (vymaps) | **Julia Zvobgo St** (ex-Rezende St). Rezende Parkade is on the corner with Julius Nyerere Way |

Sources:
https://news.pindula.co.zw/2018/02/20/new-kombi-ranks-harare-map-inside-effective-21-february-2018/ ,
https://www.heraldonline.co.zw/new-ranks-for-harare/ , https://www.heraldonline.co.zw/kombi-operators-vendors-ready-to-register/ ,
https://www.herald.co.zw/council-moves-to-decongest-market-square/ , https://mapcarta.com/W541564208 ,
https://mapcarta.com/W408937261 , https://mapcarta.com/W541559878 , http://wikimapia.org/1594954/4th-street-bus-station ,
https://vymaps.com/ZW/Rezende-Street-Bus-Terminal-735135/ , https://busmaps.com/en/zimbabwe/public_transit-agency-Harare-Kombis-2273304593-455400421 ,
https://busmaps.com/en/zimbabwe/public_transit-line-Fourth-Street-Rank-to-Domboshava-3522673169-1256877676 ,
https://zimbabwenow.co.zw/articles/9625/council-takes-back-fourth-street-terminus-from-touts ,
https://www.thestandard.co.zw/2015/03/22/upmarket-terminus-for-harares-fourth-street

- The UNEP study counts **7 CBD terminals**: Mbare (A and B), Market Square, Charge Office, Fourth Street, Copacabana,
  Ruzende (Rezende) Parkade, and Machipisa. Mbare and Machipisa are actually outside the CBD.
- **Informal pick-up points:**
  - Corner of Robert Mugabe Rd and Angwa St (Mabvuku, Tafara, Chizhanje).
  - Julius Nyerere Way at OK (Glenwood Park, Maruwa).
  - The mushikashika rank on **Leopold Takawira St** near council offices.

  https://hrt.org.zw/2020/02/14/traffic-congestion-in-harare/ ,
  https://bulawayo24.com/index-id-news-sc-national-byo-255413.html
- **Holding bays.** Kombis queue at the Coventry Road holding bay, west of the CBD at about -17.8446, 31.0291, and
  enter the ranks on a ticket. https://www.heraldonline.co.zw/1-extra-24-august-2014/
- **Off-map transport nodes (approx):**
  - Mbare Musika: rural and intercity buses plus kombis, about 2 km south-west, around -17.853, 31.037.
  - Roadport: international coaches, east CBD on Robert Mugabe Rd / Fifth St, around -17.831, 31.060.

### Street renames (signage uses the new names; people still use the old ones)
| Old name | New name |
|---|---|
| Cameron St | Joseph Msika St |
| Second St | Sam Nujoma St |
| Fourth St | Simon Vengai Muzenda St |
| Rezende St | Julia Zvobgo St |
| Inez Terrace | Mayor Urimbo Terrace |
| Selous Ave | John Landa Nkomo Ave |
| Baines Ave | Herbert Ushewokunze Ave |
| Livingstone Ave | Oliver Tambo Ave |

https://bulawayo24.com/index-id-news-sc-national-byo-253725.html , https://newziana.co.zw/harare-city-council-renames-major-roads-to-honour-african-global-icons/

## 3. Hwindi calls and destinations
- Destination groups for the game:
  - **West and north-west:** Kuwadzana, Dzivarasekwa, Warren Park, Westlea, Mabelreign, Marlborough.
  - **South-west:** Mbare, Highfield (Machipisa), Glen View, Glen Norah, Budiriro, Mufakose, Kambuzuma.
  - **South:** Chitungwiza (Seke, Zengeza, St Mary's, Unit L), Waterfalls, Hopley.
  - **East:** Mabvuku, Tafara, Epworth, Ruwa, Greendale.
  - **North:** Avondale, Mt Pleasant, UZ, Borrowdale, Hatcliffe.

  ZUPCO timetables list Mufakose, Kambuzuma, Machipisa-Lusaka, Seke 1 and 2, and Zengeza 1–4.
  https://www.heraldonline.co.zw/zupco-bus-timetables-released/
- The shouted forms in the data file (repeated names, "Town! Town!", seat calls) follow observed practice, but the
  exact phrasing is **(approx)**. Each Shona line has a confidence flag.

## 4. Other vehicles

### Private cars
- Imported second-hand Japanese cars dominate. The **Honda Fit** was named Harare's most common car (2020). Other
  common cars are the Toyota Vitz, Aqua and Prius (hybrids), and the Corolla Axio, Allion and Premio sedans.
  Wish and Fielder wagons and MPVs are also common. https://www.talesmag.com/real-post-report-city-question-answers/29/62 ,
  https://zimprofiles.com/fuel-efficient-cars-in-zimbabwe-a-review-of-honda-fit-hybrid-and-toyota-aqua/ ,
  https://carused.jp/blog/editors-picks-zimbabwes-favorite-japanese-used-cars/ ,
  https://my.sancarlo.co.uk/sancarlo-news/best-used-cars-in-zimbabwe-your-ultimate-guide-1767648080
- **Pickups:** Toyota Hilux, Isuzu (KB/D-Max), Ford Ranger, Nissan NP200/Navara and Mazda. **SUVs:** Land Cruiser,
  Prado, Fortuner and Mercedes (approx). https://shop.zimcompass.com/pickup
- **Colours:** regional data shows white first, then silver, grey and black.
  https://codera.co.za/what-are-the-most-common-car-colours-in-sa/ ,
  https://www.carmag.co.za/lifestyle-interests/what-is-the-most-popular-car-colour-in-south-africa/
- **Traffic mix weights (approx).** The vehicle weights in `streetlife.js` are game-tuning guesses. Hatchbacks
  dominate, kombis are about 20% in the CBD (higher near ranks), and pickups are common.

### Pirate taxis (mushikashika)
- "Mushikashika" means pirate taxis, and more broadly the lawless driving of pirate taxi and kombi drivers.
- The **Honda Fit** is the vehicle of choice, sometimes with seven passengers including one in the boot.
- They weave through gridlock and run red lights.

https://www.newsday.co.zw/technology/article/200058139/why-street-cameras-are-not-taming-harares-mushikashika-jungle-yet ,
https://bulawayo24.com/index-id-news-sc-national-byo-255413.html ,
https://www.thestandard.co.zw/2016/12/18/mushikashika-authored-protected-influential

### ZUPCO buses
- ZUPCO has 500+ white buses commissioned since 2019, and the fleet reached 831 buses and 896 omnibuses in 2020. The
  FAW-built buses carry blue and gold on white. Colour details are **(approx)**.
  https://en.wikipedia.org/wiki/Zimbabwe_United_Passenger_Company , https://www.pindula.co.zw/Zimbabwe_United_Passenger_Company

### Police
- In December 2025 the ZRP highway patrol got Ford Ranger double cabs. ZRP uniforms are blue and grey, and traffic
  police wear yellow reflective sleeves. The vehicle livery (white with blue and gold/yellow bands and a light bar) is
  **(approx)**. https://bulawayo24.com/index-id-news-sc-national-byo-260444.html ,
  https://www.behance.net/gallery/4687153/Zimbabwe-Republic-Police-Fleet ,
  https://www.uniforminsignia.net/zimbabwe-republic-police.html

### Metered taxis
- Metered taxis are white or silver with roof signs and wait at hotels and malls. Yellow Cab and Fife Avenue Taxis are
  known firms. https://thingstodoinzimbabwe.com/transportation/taxi-rideshare/

### Number plates
- The 2006 series reads **ABC 1234**: three letters, the coat of arms in the centre, four digits, and "ZW".
- **Private:** black on white since 2006; the older style is black on yellow.
- **Commercial:** red on white.
- **Military:** white on black.
- Plates are reflective metal, front and rear.

https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Zimbabwe (search summary)

## 5. Traffic rules and feel
- Zimbabwe drives on the **left** (right-hand-drive cars). The urban limit is **60 km/h**. Traffic lights are called
  **"robots"**. https://en.wikipedia.org/wiki/Speed_limits_in_Zimbabwe , https://x.com/AfricaFactsZone/status/1958447459002130609 ,
  https://tyremap.com/driving/zimbabwe/
- In May 2025 the CBD had **69 signalised intersections, of which only 48 (about 69%) worked**. Causes were faulty
  controllers, vandalism, power cuts, and solar panels and batteries being stolen. At a dead robot, drivers push through.
  https://news.pindula.co.zw/2025/05/29/over-30-of-harares-cbd-traffic-lights-not-working/ ,
  https://www.heraldonline.co.zw/harare-where-traffic-lights-are-ancient-relics-no-one-cares-about/
- **Streetlights:** about 60% of Harare's 85,000 streetlights do not work (2025–2045 draft master plan). At night the
  CBD is patchy: some lit blocks, some dark, plus shop and generator light.
  https://www.zimeye.net/2025/07/16/60-of-wicknell-funded-streetlights-in-harare-have-gone-dark/ ,
  https://www.heraldonline.co.zw/traffic-street-lighting-nightmare-in-harare/
- **Street width.** CBD streets are famously wide. The story is that they were laid out so a wagon with a span of 16
  oxen could make a U-turn. The grid follows Thomas Ross's plan, aligned to magnetic north.
  https://en.wikipedia.org/wiki/The_Avenues,_Harare , https://zimfieldguide.com/harare/harare-capital-zimbabwe
- **Samora Machel Ave** is a major east–west artery with 9 synchronised signals (Bishop Gaul, Rekayi Tangwena,
  Rotten Row, Chinhoyi St and others). A pedestrian footbridge was built between Julius Nyerere and Leopold Takawira.
  https://allafrica.com/stories/202109270212.html ,
  https://www.heraldonline.co.zw/council-re-opens-cbd-roads/
- **Julius Nyerere Way** is congested from Robert Mugabe Rd to past the flyover, near the railway at Kenneth Kaunda Ave.
  https://www.heraldonline.co.zw/plans-to-decongest-julius-nyerere-underway/
- **Lanes and one-way streets:** no reliable source found. Use the OSM `lanes` and `oneway` tags. Fallback defaults
  in `TRAFFIC.laneDefaults` are **(approx)**: CBD avenues have 2 lanes each way, and most streets have 1–2 lanes each way.
- **Road markings** follow the SADC Road Traffic Signs Manual:
  - White lane lines and white stop lines.
  - A **yellow left edge line** and a white right edge line on divided roads.
  - White zebra crossings.
  - **(approx)** CBD markings are heavily faded.

  https://en.wikipedia.org/wiki/Road_signs_in_the_Southern_African_Development_Community ,
  https://wiki.aaroads.com/wiki/SADC_Road_Traffic_Signs_Manual
- ZRP cameras caught red-light violators in the CBD (May 2025).
  https://zrp.gov.zw/?p=8290 , https://zimbabwenow.co.zw/articles/14915/digital-policing-picks-290-traffic-violations-in-harare-cbd

## 6. Pedestrians and vendors

### Vending
- Vendors crowd **street corners, robots (traffic lights) and pavements**. They sell fruit, vegetables, airtime,
  phone accessories, second-hand clothes, cheap electronics, rice, tomatoes and potatoes, meat, fish, rat poison and
  clothing. Only 5 official CBD vending sites exist, for fewer than 200 vendors, against thousands of actual vendors.
  https://www.aljazeera.com/features/2025/3/27/government-workers-moonlight-as-street-vendors-in-zimbabwe ,
  https://www.tandfonline.com/doi/full/10.1080/1369801X.2022.2099938 ,
  https://www.sundaymail.co.zw/well-win-war-against-vending-disorder
- At big intersections, vendors sell **umbrellas, fruit, toilet paper and "bestsellers"** to drivers. Other sellers
  offer airtime cards, sunglasses, windscreen wipers and phone chargers. Vendors sit on **cardboard** and keep stock in
  crates and sacks. https://www.mijksenaar.com/mobility/what-does-wayfinding-look-like-in-harare-zimbabwe/ ,
  https://www.foxnews.com/world/zimbabwes-street-vendors-turn-on-the-style-to-win-customers
- **Other informal trades:** cobblers or shoe menders, hawkers, forex dealers and street car washers.
  https://www.tandfonline.com/doi/full/10.1080/1369801X.2022.2099938
- **Money changers** have gathered since about 2007 on the pavements south and west of **Eastgate**, and at Market
  Square, Copacabana and Roadport. They wave bricks of notes.
  https://allafrica.com/stories/202004300149.html ,
  https://www.aljazeera.com/features/2025/10/8/the-work-we-do-is-illegal-zimbabwes-disabled-black-market-forex-dealers
- **Africa Unity Square** is known for its **flower sellers**, who work under the jacaranda canopy (roses, lilies,
  sunflowers and more), and for its photographers. It has a big fountain and covers 5.8 acres.
  https://www.gpsmycity.com/attractions/africa-unity-square-49912.html ,
  https://www.zimbabwenow.co.zw/articles/13852/love-in-bloom-harares-africa-unity-square-buzzes-with-valentines-day-cheer ,
  https://tendaitomu.medium.com/the-jacaranda-trees-of-harare-zimbabwe-d6282f926c34
- **Megaphone culture.** Herbalists, vendors and music pirates compete with megaphones. Messages advertise "poison for
  cockroaches and rodents… kills instantly". Street preachers take turns with speakers.
  https://link.springer.com/chapter/10.1007/978-3-032-19551-7_6 , https://nehandaradio.com/2017/11/13/rise-street-preacher/
- Operation Chenesa targets First St, Fourth St, Samora Machel Ave at Fifth St, and Ruzende. Those spots are vendor
  hotspots. https://allafrica.com/stories/202609180020.html

### Dress
- Many women wear a **dhuku** (headscarf) and a **zambia** wrap cloth, which doubles as a baby carrier. Young people
  wear hoodies, sneakers and denim, and mix in African prints.
  https://mercht.com/complete-guide-to-zimbabwe-clothing/ , https://fashiongtonpost.com/zimbabwe-traditional-clothing/
- Office wear: banks, law firms and government expect full suits. Business attire is a notch less formal and ties are
  rare. Blazers in African prints are increasingly common.
  https://www.newzimbabwe.com/what-it-actually-takes-to-dress-like-a-professional-in-harare-and-everywhere-else/
- **School uniforms:**
  - Primary: blue dresses with Peter Pan collars for girls; khaki shirts and shorts for boys.
  - Secondary: school-specific colours, for example Girls High (green and gold), Prince Edward (maroon, green and
    white) and Mazowe (maroon and navy).

  https://histclo.com/schun/country/afr/zim/sz-uni.html , https://en.wikipedia.org/wiki/Girls_High_School,_Harare ,
  https://en.wikipedia.org/wiki/Prince_Edward_School
- **(approx):**
  - Women carry loads on their heads (basins of produce, buckets, bundles).
  - Babies are tied on the back with a towel or zambia.
  - Men push two-wheeled handcarts.
  - Security guards wear navy or khaki uniforms with caps.
  - Apostolic sect members wear white robes.
  - The ZRP wears blue and grey; traffic officers add yellow reflective sleeves.

## 7. Streetscape

### Trees
- **Jacaranda** (*Jacaranda mimosifolia*) blooms from **late September to late October** and peaks in October. It
  forms canopies over the Avenues and carpets the tarmac with purple petals. Jacarandas dominate **Africa Unity
  Square**. **Leopold Takawira St** is the classic jacaranda avenue. Rare white jacarandas grow on Samora Machel Ave.
  The first seedlings came from Durban in 1899.
  https://combonimissionaries.ie/2024/08/14/the-jacaranda-floral-magic/ ,
  https://www.southworld.net/the-jacaranda-floral-magic/ ,
  https://treesociety.org.zw/discover-trees/white-jacarandas/ ,
  https://tendaitomu.medium.com/the-jacaranda-trees-of-harare-zimbabwe-d6282f926c34
- **Flame trees:**
  - *Spathodea campanulata* (African tulip tree) lines major roads such as Seventh St and has orange-red flowers.
  - *Delonix regia* (flamboyant) usually flowers in **November**, so it is not in bloom in late September. The famous
    flamboyants are on Blakiston St.

  https://treesociety.org.zw/tree-life/351/ , https://zimbabwefood.blogspot.com/2010/06/harares-flamboyant-tree-culture.html
- **Msasa** (*Brachystegia spiciformis*) puts out spring leaf flushes in **August–September** in pink, bronze, burgundy
  and wine-red, fading to green. A few old msasas remain in town, for example on Josiah Tongogara Ave near Sam Nujoma St.
  https://en.wikipedia.org/wiki/Brachystegia_spiciformis , https://treesociety.org.zw/tree-life/351/
- Harare's approved street-tree list includes **bauhinia**, **eucalyptus** and croton. Pavement trees on Samora Machel
  Ave and Sam Nujoma St are modest in size.
  https://www.heraldonline.co.zw/exotic-trees-doing-city-more-harm-than-good/

### Buildings, street furniture and litter
- The CBD mixes high-rises from the 1950s–60s and 1990s with Cape Dutch, Victorian and beaux-arts buildings at the edges.
  Greenwood Park has Art Deco flats. https://en.wikipedia.org/wiki/Causeway,_Harare , https://en.wikipedia.org/wiki/Greenwood_Park,_Harare
- **(approx)** Colonnaded shopfront **verandahs** (cantilevered canopies over the pavement), painted shop signage,
  steel roller shutters, concrete bollards at rank edges, simple steel bus shelters, and overflowing litter.
- Litter piles up at the Fourth Street, Copacabana and Market Square termini, and skip bins were placed in the CBD.
  https://theblast.co.zw/2025/05/10/accumulation-of-litterharare-residents-blame-city-council-private-players/ ,
  https://geopomona.co.zw/harare-clean-up-skip-bins-delivered/
- Billboards and shop signs should use **generic, made-up businesses**. Do not copy real brands.

## 8. Sound

### Street noise
- CBD noise comes from **touts, shop loudspeakers blaring music, and megaphone rat-poison sellers**. The worst areas
  are Robert Mugabe Rd and Mbuya Nehanda St by the Mbare kombi pick-up. Vendors use small speakers attached to
  recorders. Enforcement of the noise by-laws is weak.
  https://www.newsday.co.zw/news/article/116162/noise-pollution-proliferates-in-harares-central-business-district ,
  https://www.sundaymail.co.zw/noise-pollution-in-harare
- **Hooting:** drivers hoot to catch commuters' attention, and marshals whistle and shout destinations.
  https://iniafrica.com/kombi-chaos-harares-streets-under-siege-by-disorder/

### Music
- **Sungura:** guitar, bass and drums, upbeat, typically **125–135 BPM**, with interlocking picked guitars.
  https://www.chosic.com/genre-chart/sungura/
- **Zimdancehall** grew up in backyard studios, barbershops and **kombis**.
  https://link.springer.com/chapter/10.1007/978-3-031-41854-9_2
- **(approx)** Zimdancehall runs at about 90–105 BPM on digital riddims. Gospel and amapiano are also heard.

### Birds
- Dark-capped bulbul: chatter, "sweet-sweet-potato".
- Cape turtle dove: three-syllable croon heard all year.
- **(approx)** Also:
  - Laughing dove.
  - Feral rock pigeons in the CBD.
  - Pied crows.
  - Little swifts screaming around tall buildings.
  - Grey go-away-bird ("gwaaay") in parks such as Harare Gardens.
  - Hadeda ibis: loud "ha-ha-haa". It was historically rare in Mashonaland but is spreading, so use it sparingly.

https://avibirds.com/garden-birds-of-south-africa/ , https://en.wikipedia.org/wiki/Ring-necked_dove ,
https://www.birdlifezimbabwe.org/wp/wp-content/uploads/2026/03/The-Babbler-189-April-May-2026.pdf ,
https://en.wikipedia.org/wiki/Grey_go-away-bird , https://www.ajol.info/index.php/az/article/download/153177/142768/0

### Night
- **(approx)** Diesel generator hum during power cuts, crickets, distant dogs, and occasional hooting.

## 9. Sky and light (late September)
- **Sun on 27 Sep 2026, computed with the NOAA algorithm for lat -17.83, lon 31.05, CAT (UTC+2):**
  - Sunrise **05:41** at azimuth 92°. Sunset **17:53** at azimuth 268°. Civil twilight runs 05:20–18:14.
  - Solar noon is **11:47**, with a maximum elevation of **73.9°** to the **north**. Solar declination is -1.7°.

  timeanddate.com gives 05:44 and 17:53 for 25 Sep, which agrees.
  https://www.timeanddate.com/sun/zimbabwe/harare
- **Weather:**
  - Average September high is about **28.8 °C** and the low about **12.9 °C**.
  - Relative humidity is about **39%** (the least humid month).
  - Almost no rain.
  - It is the **windiest month**, at about 25 km/h.

  https://en.climate-data.org/africa/zimbabwe/harare-province/harare-3530/t/september-9/ ,
  https://www.weather-atlas.com/en/zimbabwe/harare-weather-september
- **Haze:** the veld-fire season runs 1 July to 31 October and peaks August–October. Smoke haze is very common
  July–October. Hot, dry and windy days carry dust. Deciduous trees are bare or just flushing.
  https://firesciencereviews.springeropen.com/articles/10.1186/2193-0414-2-2 ,
  https://zimfieldguide.com/mashonaland-west/wildfires-zimbabwe%E2%80%99s-scourge
- **(approx) Sky look:** clear sky with no cloud or rare fair-weather cumulus. The rains' build-up clouds start
  mid-October to November.
  - Overhead is a slightly milky blue.
  - The horizon is a pale, dusty grey-beige band.
  - The low sun turns orange-red through the smoke.
  - Long golden shadows appear after about 16:30.
  - Dusk comes fast, about 20 minutes of civil twilight.
  - Distance fog is warm grey-beige, with visibility around 10–20 km.

## 10. Shona language notes
- Shona uses standard orthography: bh, dh, mh, nh, sv, zv, ng', with no tone marks.
- Respect forms add **-i** or use the plural (Mhoroi, Makadii, Pindai). Speakers use them with elders and strangers.
  https://wisc.pb.unizin.org/lctlresources/chapter/chishona-greetings/
- **Verified by search:**
  - Mangwanani, Masikati, Manheru (good morning, afternoon, evening).
  - Makadii? and "Ndiripo, makadiiwo?" (How are you? / I'm fine, and you?).
  - Ndatenda and Maita basa (thank you).
  - Fambai zvakanaka (go well).
  - Mamuka sei? and Maswera sei? (How did you wake? / How was your day?).
  - Pamusoroi (excuse me), Imarii? (how much?), Hazvina mhosva (no problem).
  - Ndeipi? (what's up), Hezvo! (there it is!), Chenjera! (be careful!), mbavha (thief), bhururuka (fly).

  https://www.omniglot.com/language/phrases/shona.php , https://goldmidi.com/community/resources/no-problem-in-shona.831/ ,
  https://slangdefine.org/n/ndeipi-1503.html , https://sn.kasahorow.org/app/d/bhururuka ,
  https://en.opentran.net/shona-english/chenjera.html , https://goldmidi.com/community/resources/a-list-of-frequently-used-interjections-in-chishona-language.98/
- Other lines in the data file come from general knowledge and carry `conf: 'high' | 'medium'`. A native speaker should
  review anything marked `medium` before it ships as voiced audio.
