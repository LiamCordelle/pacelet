#!/usr/bin/env python3
"""Render the actual watch_ui.c with PebbleOS fonts and graphics, without QEMU.

The sibling renderer is read-only. SDK/generated resources must exist (pebble
build); sources and object files are copied into a temporary project/cache.
"""
import argparse
import base64
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCREENS = ['choose','gps-search','gps-ready','gps-error','countdown','activity',
           'walking','cycling','split','kilometres','zones','heart-history','paused',
           'end-confirm','finished','upload','upload-exit','history','history-detail',
           'recovery','recovery-discard','measuring-hr','offline','long-values','first-km','low-battery','sync-paused','route','upload-failed','upload-unconfirmed',
           'controls-picker','controls-history','back-pause','controls-active']
MOTIONS = [('picker',0,'FxPick',240),('gps-lock',2,'FxLock',480),
           ('countdown',4,'FxCount',1000),('start',5,'FxStart',440),
           ('split',8,'FxSheet',280),('split-out',5,'FxSplitOut',240),
           ('page',9,'FxPush',240),('pause',12,'FxPause',200),
           ('confirm',13,'FxSheet',240),('saved',14,'FxSave',760),
           ('upload',15,'FxUpload',720),('zone',5,'FxZone',320),('hr',5,'FxHr',120)]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer',type=Path,default=ROOT.parent/'pebble-watchface-agent-skill/watchface-lab/renderer')
    parser.add_argument('--output',type=Path,default=ROOT/'screenshots')
    args=parser.parse_args()
    sys.path.insert(0,str(args.renderer/'hostgfx'))
    import build
    import screenshot
    from PIL import Image, ImageDraw, ImageFont
    fw=[args.renderer/'build/fw'/(s[:-2]+'.o') for s in build.FW_SOURCES]
    fw += [args.renderer/'build/fw/tinymt32.o',args.renderer/'build/fw/fw_host.o']
    if not all(p.exists() for p in fw):raise SystemExit('Sibling renderer firmware objects are missing.')
    frames=[('watch_'+name.replace('-','_'),i,'FxNone',1000) for i,name in enumerate(SCREENS)]
    clips=[]
    for name,index,effect,ms in MOTIONS:
        ids=[]
        for n in range(13):
            ids.append(len(frames));frames.append(('motion_'+name.replace('-','_')+'_'+str(n),index,effect,round(n*1000/12)))
        clips.append((name,index,ms,ids))
    # A complete orbit cycle at 30fps, so the exported GPS animation has the
    # same frame cadence as the watch, not repeated/coarsely stepped frames.
    orbit=[]
    for n in range(103):
        orbit.append(len(frames));frames.append(('orbit_'+str(n),1,'FxOrbit',round(n*1000/102)))
    with tempfile.TemporaryDirectory(prefix='pacelet-native-') as temp:
        project=Path(temp);src=project/'src/c';src.mkdir(parents=True)
        for p in (ROOT/'src/c').iterdir():
            if p.suffix in ('.h','.c') and p.name not in ('main.c','activity_controller.c','watch_services.c'):
                shutil.copy(p,src/p.name)
        # Include the exact shipping C sources in the fixture translation unit.
        (src/'pacelet_model.c').rename(src/'pacelet_model.inc')
        (src/'watch_ui.c').rename(src/'watch_ui.inc')
        fixture=(ROOT/'tools/watch_preview.c').read_text().replace('"pacelet_model.c"','"pacelet_model.inc"').replace('"watch_ui.c"','"watch_ui.inc"')
        (src/'watch_preview.c').write_text(fixture)
        shutil.copy(ROOT/'docs/design/pulse-aperture/preview/src/c/lab.h',src/'lab.h')
        (src/'lab_designs.h').write_text('#pragma once\n#define LAB_DESIGNS(X) '+' '.join('X('+f[0]+')' for f in frames)+'\n')
        (src/'watch_frames.h').write_text(''.join('WATCH_FRAME(%s,%d,%s,%d)\n'%f for f in frames))
        (project/'build/emery/src').mkdir(parents=True)
        (project/'build/include').mkdir(parents=True)
        shutil.copy(ROOT/'build/emery/src/resource_ids.auto.h',project/'build/emery/src/resource_ids.auto.h')
        shutil.copy(ROOT/'build/include/message_keys.auto.h',project/'build/include/message_keys.auto.h')
        shutil.copy(ROOT/'build/src/message_keys.auto.c',src/'message_keys.auto.c')
        build.APP_BUILD=str(project/'objects')
        executable=build.build_project(str(project),0,[str(p) for p in fw])
        raw=project/'frame.raw';images=[]
        for i in range(len(frames)):
            subprocess.run([executable,str(args.renderer/'fw'),str(ROOT/'build/emery/app_resources.pbpack'),str(i),str(raw)],check=True,capture_output=True)
            images.append(screenshot.framebuffer_to_image(raw.read_bytes()))
        args.output.mkdir(parents=True,exist_ok=True)
        for i,name in enumerate(SCREENS):
            images[i].resize((400,456),Image.Resampling.NEAREST).save(args.output/(name+'.png'))
            encoded=base64.b64encode((args.output/(name+'.png')).read_bytes()).decode()
            (args.output/(name+'.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="228" viewBox="0 0 200 228"><image width="200" height="228" href="data:image/png;base64,'+encoded+'"/></svg>')
        aliases={'choose-running':'choose','history-list':'history','running':'activity','split-running':'split'}
        for alias,target in aliases.items():
            for suffix in ('.png','.svg'):shutil.copy(args.output/(target+suffix),args.output/(alias+suffix))
        for name,index,ms,ids in clips:
            if images[ids[-1]].tobytes()!=images[index].tobytes():
                raise AssertionError(name+' final frame differs from static target')
            images[ids[0]].save(args.output/(name+'-motion.gif'),save_all=True,append_images=[images[i] for i in ids[1:]],duration=max(20,round(ms/12)),loop=0)
        images[orbit[0]].save(args.output/'gps-orbit.gif',save_all=True,append_images=[images[i] for i in orbit[1:-1]],duration=33,loop=0)
        cols=5;rows=(len(SCREENS)+cols-1)//cols
        sheet=Image.new('RGB',(cols*230+20,rows*282+20),'#f5f1e9');draw=ImageDraw.Draw(sheet)
        font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',15)
        for i,name in enumerate(SCREENS):
            x=20+i%cols*230;y=20+i//cols*282;sheet.paste(images[i],(x,y));draw.text((x,y+235),name.replace('-',' '),font=font,fill='#4a161b')
        sheet.save(args.output/'paceboard-overview.png')
        compact=Image.new('RGB',(648,496),'#f5f1e9')
        for i,name in enumerate(('choose','gps-search','activity','kilometres','zones','finished')):
            compact.paste(images[SCREENS.index(name)],(12+i%3*212,12+i//3*244))
        compact.save(args.output/'paceboard-release.png')
    print('Rendered %d shipping screens; %d motion endpoints match exactly.'%(len(SCREENS),len(clips)))

if __name__=='__main__':main()
