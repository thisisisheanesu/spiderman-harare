"""Vehicle specs. Each module defines NAME, body(), RULES, BREAKS, arches(), wheels(), wheel_mesh(),
details(ctx), paint(canvas), meta() and optional livery(path) / TOGGLES. See ../README.md."""
import importlib

ORDER = ['kombi', 'hatch_fit', 'sedan_corolla', 'sedan_mercedes', 'wagon_wish', 'pickup_hilux',
         'suv_landcruiser', 'taxi', 'police_landcruiser', 'bus_zupco', 'truck_isuzu']

ALL = {}
for _n in ORDER:
    try:
        ALL[_n] = importlib.import_module(f'specs.{_n}').SPEC
    except ModuleNotFoundError as e:
        if e.name != f'specs.{_n}':
            raise
