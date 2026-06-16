import importlib.abc
import importlib.util
import math
import os
import random
import sys
import time


TARGET_MODULE = 'pypkjs.javascript.navigator.geolocation'


def _enabled():
    return os.environ.get('PEBBLE_TRACKER_SIM_GPS') == '1'


def _float_env(name, fallback):
    try:
        return float(os.environ.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


def _int_env(name, fallback):
    try:
        return int(os.environ.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


def _patch_geolocation(_geo):
    import gevent

    watches = {}
    state = {
        'next_watch_id': 1000,
        'started_at': None,
        'lock_at': None,
    }
    config = {
        'delay_s': _float_env('PEBBLE_TRACKER_SIM_DELAY_S', 30.0),
        'interval_s': _float_env('PEBBLE_TRACKER_SIM_INTERVAL_S', 5.0),
        'loop_distance_m': _float_env('PEBBLE_TRACKER_SIM_LOOP_DISTANCE_M', 1000.0),
        'speed_mps': _float_env('PEBBLE_TRACKER_SIM_SPEED_MPS', 1.35),
        'jitter_m': _float_env('PEBBLE_TRACKER_SIM_JITTER_M', 6.0),
        'accuracy_m': _float_env('PEBBLE_TRACKER_SIM_ACCURACY_M', 10.0),
        'center_lat': _float_env('PEBBLE_TRACKER_SIM_CENTER_LAT', 51.5074),
        'center_lon': _float_env('PEBBLE_TRACKER_SIM_CENTER_LON', -0.1278),
        'altitude_m': _float_env('PEBBLE_TRACKER_SIM_ALTITUDE_M', 25.0),
        'seed': _int_env('PEBBLE_TRACKER_SIM_SEED', 1337),
    }

    def ensure_started():
        if state['started_at'] is None:
            state['started_at'] = time.time()
            state['lock_at'] = state['started_at'] + max(0.0, config['delay_s'])
        return state['started_at']

    def wait_for_lock():
        ensure_started()
        remaining_s = state['lock_at'] - time.time()
        if remaining_s > 0:
            gevent.sleep(remaining_s)

    def meters_to_lat_lon(north_m, east_m):
        meters_per_degree_lat = 111320.0
        lat = config['center_lat'] + (north_m / meters_per_degree_lat)
        lon_scale = meters_per_degree_lat * math.cos(math.radians(config['center_lat']))
        lon = config['center_lon'] + (east_m / lon_scale)
        return lat, lon

    def simulated_position():
        now = time.time()
        elapsed_s = max(0.0, now - state['lock_at'])
        interval_s = max(1.0, config['interval_s'])
        step = int(elapsed_s / interval_s)
        step_elapsed_s = step * interval_s
        radius_m = max(1.0, config['loop_distance_m'] / (2 * math.pi))
        angle = (step_elapsed_s * max(0.1, config['speed_mps'])) / radius_m

        rng = random.Random(config['seed'] + step)
        radial_jitter_m = rng.uniform(-config['jitter_m'], config['jitter_m'])
        tangent_jitter_m = rng.uniform(-config['jitter_m'], config['jitter_m'])
        accuracy_jitter_m = rng.uniform(-2.0, 2.0)

        radius_with_jitter_m = radius_m + radial_jitter_m
        north_m = math.cos(angle) * radius_with_jitter_m
        east_m = math.sin(angle) * radius_with_jitter_m

        # A small tangent offset makes the loop feel hand-recorded while still
        # staying bounded and repeatable.
        north_m += -math.sin(angle) * tangent_jitter_m
        east_m += math.cos(angle) * tangent_jitter_m

        lat, lon = meters_to_lat_lon(north_m, east_m)
        return {
            'latitude': lat,
            'longitude': lon,
            'accuracy': max(3.0, config['accuracy_m'] + accuracy_jitter_m),
            'altitude': config['altitude_m'] + rng.uniform(-1.5, 1.5),
        }

    def emit_position(self, success):
        if not callable(success):
            return

        point = simulated_position()
        coords = _geo.Coordinates(
            self.runtime,
            point['longitude'],
            point['latitude'],
            point['accuracy']
        )
        coords.altitude = point['altitude']
        position = _geo.Position(
            self.runtime,
            coords,
            round(time.time() * 1000)
        )
        self.runtime.enqueue(success, position)

    def single_position(self, success, failure=None, options=None):
        wait_for_lock()
        emit_position(self, success)

    def watch_loop(self, watch_id, success, failure=None, options=None):
        wait_for_lock()
        while watches.get(watch_id):
            emit_position(self, success)
            gevent.sleep(max(1.0, config['interval_s']))

    def getCurrentPosition(self, success, failure=None, options=None):
        self.runtime.group.spawn(single_position, self, success, failure, options)

    def watchPosition(self, success, failure=None, options=None):
        watch_id = state['next_watch_id']
        state['next_watch_id'] += 1
        watches[watch_id] = True
        self.runtime.group.spawn(watch_loop, self, watch_id, success, failure, options)
        return watch_id

    def clearWatch(self, watch_id):
        watches.pop(watch_id, None)

    _geo.Geolocation.getCurrentPosition = getCurrentPosition
    _geo.Geolocation.watchPosition = watchPosition
    _geo.Geolocation.clearWatch = clearWatch
    _geo.Geolocation._pebble_tracker_sim_patched = True


class _PatchLoader(importlib.abc.Loader):
    def __init__(self, wrapped_loader):
        self._wrapped_loader = wrapped_loader

    def create_module(self, spec):
        if hasattr(self._wrapped_loader, 'create_module'):
            return self._wrapped_loader.create_module(spec)
        return None

    def exec_module(self, module):
        self._wrapped_loader.exec_module(module)
        if not getattr(module.Geolocation, '_pebble_tracker_sim_patched', False):
            _patch_geolocation(module)


class _PatchFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname != TARGET_MODULE:
            return None

        try:
            sys.meta_path.remove(self)
            spec = importlib.util.find_spec(fullname)
        finally:
            sys.meta_path.insert(0, self)

        if spec is None or spec.loader is None:
            return spec

        spec.loader = _PatchLoader(spec.loader)
        return spec


if _enabled():
    if TARGET_MODULE in sys.modules:
        _patch_geolocation(sys.modules[TARGET_MODULE])
    else:
        sys.meta_path.insert(0, _PatchFinder())
