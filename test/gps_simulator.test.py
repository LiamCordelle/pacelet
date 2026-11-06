"""Both pypkjs bridges must receive realistic timestamp-less phone callbacks."""
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('pacelet_sim', Path(__file__).resolve().parents[1]/'tools/pypkjs_gps_sim/sitecustomize.py')
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)
sys.modules['gevent'] = SimpleNamespace(sleep=lambda delay: None)
os.environ['PEBBLE_TRACKER_SIM_DELAY_S'] = '0'

for legacy in (False, True):
    class Geo:
        pass
    geo_module = SimpleNamespace(Geolocation=Geo)
    if legacy:
        geo_module.Coordinates = lambda runtime, lon, lat, accuracy: SimpleNamespace(longitude=lon, latitude=lat, accuracy=accuracy)
        geo_module.Position = lambda runtime, coords, *stamp: SimpleNamespace(coords=coords, **({'timestamp':stamp[0]} if stamp else {}))
    sim._patch_geolocation(geo_module)
    results=[]
    geo=Geo()
    geo.runtime=SimpleNamespace(group=SimpleNamespace(spawn=lambda fn,*args: fn(*args)),enqueue=lambda fn,arg: fn(arg))
    os.environ.pop('PEBBLE_TRACKER_SIM_TIMESTAMP',None)
    geo.getCurrentPosition(results.append)
    position=results.pop()
    if legacy:
        assert not hasattr(position,'timestamp')
        assert 3 <= position.coords.accuracy <= 12
    else:
        assert 'timestamp' not in position
        assert 3 <= position['coords']['accuracy'] <= 12
        assert 'latitude' in position['coords']
    os.environ['PEBBLE_TRACKER_SIM_TIMESTAMP']='milliseconds'
    geo.getCurrentPosition(results.append)
    position=results.pop()
    stamp=position.timestamp if legacy else position['timestamp']
    assert stamp > 1000000000000
print('ok - emulator GPS simulator supports QuickJS dictionaries and legacy V8 wrappers')
