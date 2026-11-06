#!/usr/bin/env python3
"""Compile the real watch controller/model against a small deterministic SDK fake."""
import json
from pathlib import Path
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='pacelet-watch-tests-') as temp:
    temp = Path(temp)
    keys = json.loads((ROOT/'package.json').read_text())['pebble']['messageKeys']
    (temp/'message_keys.h').write_text('enum {\n'+',\n'.join('MESSAGE_KEY_'+key+' = '+str(index+1) for index,key in enumerate(keys))+'\n};\n')
    for name in ('watch_controller', 'watch_transport'):
        binary = temp/name
        subprocess.run(['cc','-std=c99','-Wall','-Wextra','-Wno-unused-parameter','-I'+str(temp),'-I'+str(ROOT/'test/watch_stubs'),str(ROOT/('test/'+name+'.test.c')),'-o',str(binary)],check=True)
        subprocess.run([str(binary)],check=True)
