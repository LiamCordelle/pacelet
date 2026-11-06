#!/usr/bin/env python3
"""Render the complete single-palette Paceboard proposal and native motion atlas.

Uses only the existing resource pack; no emulator or production build needed.
"""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

from paceboard_preview_spec import SCREENS, MOTIONS
ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'docs/design/pulse-aperture/preview'
OUT = ROOT / 'docs/design/paceboard'
SOURCE = PROJECT / 'src/c'
VIS = None  # Optional conversation preview destination; repository output is portable.

def write_changed(path, text):
    if not path.exists() or path.read_text() != text:
        path.write_text(text)

def write_player(data):
    template=OUT/'player.fragment.html'
    if not template.exists():return
    fragment=template.read_text().replace('__PACEBOARD_DATA__',json.dumps(data,separators=(',',':')))
    if len(fragment.encode())>=1000000:raise RuntimeError('Inline preview exceeds 1 MB')
    if VIS is not None:
        VIS.mkdir(parents=True,exist_ok=True)
        (VIS/'paceboard-full-redesign.html').write_text(fragment)
    (OUT/'player.html').write_text(fragment)
    print('Interactive preview: '+str(OUT/'index.html'))

def catalog():
    frames=[]
    static={}
    for key,label,scene in SCREENS:
        symbol='pb_static_'+key.replace('-','_')
        static[key]=len(frames)
        frames.append((symbol,scene,'FX_NONE',1000))
    scene_for={key:scene for key,label,scene in SCREENS}
    clips={}
    for key,target,effect,ms in MOTIONS:
        count=math.ceil(ms/(1000/30 if effect == 'FX_ORBIT' else 40))+1
        indices=[]
        for n in range(count):
            indices.append(len(frames))
            frames.append(('pb_anim_'+key.replace('-','_')+'_'+str(n),scene_for[target],effect,round(n*1000/(count-1))))
        clips[key]={'target':target,'ms':ms,'frames':indices}
    write_changed(SOURCE/'paceboard_frames.h','// Generated from tools/paceboard_preview_spec.py.\n'+''.join('PB_FRAME(%s,%s,%s,%d)\n'%f for f in frames))
    write_changed(SOURCE/'paceboard_catalog.h','#pragma once\n#define PACEBOARD_DESIGNS(X) '+' '.join('X('+f[0]+')' for f in frames)+'\n')
    return frames,static,clips

def main():
    global VIS
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer',type=Path,default=ROOT.parent/'pebble-watchface-agent-skill/watchface-lab/renderer')
    parser.add_argument('--player-only',action='store_true',help='Refresh the interactive player from existing native frames.')
    parser.add_argument('--visualization-dir',type=Path,help='Optionally copy the inline player to a conversation artifact directory.')
    args=parser.parse_args()
    VIS=args.visualization_dir
    if args.player_only:
        write_player(json.loads((OUT/'preview-data.json').read_text()))
        return
    sys.path.insert(0,str(args.renderer/'hostgfx'))
    import build
    import screenshot
    from PIL import Image,ImageDraw,ImageFont
    OUT.mkdir(exist_ok=True)
    frames,static,clips=catalog()
    objects=[args.renderer/'build/fw'/(s[:-2]+'.o') for s in build.FW_SOURCES]
    objects += [args.renderer/'build/fw/tinymt32.o',args.renderer/'build/fw/fw_host.o']
    if not all(p.exists() for p in objects):raise SystemExit('Set up the sibling renderer first.')
    build.APP_BUILD=str(Path(tempfile.gettempdir())/'pacelet-native-study')
    exe=build.build_project(str(PROJECT),0,[str(p) for p in objects])
    # Existing three rounds stay in the same resource-only preview project.
    base=39
    images=[]
    with tempfile.TemporaryDirectory() as temp:
        raw=Path(temp)/'frame.raw'
        for i,frame in enumerate(frames):
            result=subprocess.run([exe,str(args.renderer/'fw'),str(PROJECT/'build/emery/app_resources.pbpack'),str(base+i),str(raw)],capture_output=True,check=True)
            if frame[0] not in result.stdout.decode():raise RuntimeError('Native design index mismatch: '+result.stdout.decode())
            images.append(screenshot.framebuffer_to_image(raw.read_bytes()))
    from PIL import ImageChops
    for key,item in clips.items():
        delta=ImageChops.difference(images[item['frames'][-1]].convert('RGB'),images[static[item['target']]].convert('RGB'))
        if delta.getbbox():raise RuntimeError('Motion does not settle exactly: '+key)
    for key,label,scene in SCREENS:images[static[key]].save(OUT/(key+'.png'))
    cols=10
    atlas=Image.new('RGBA',(200*cols,228*math.ceil(len(images)/cols)))
    for i,img in enumerate(images):atlas.paste(img,(i%cols*200,i//cols*228))
    atlas.convert('RGB').convert('P',palette=Image.Palette.ADAPTIVE,colors=64).save(OUT/'atlas.png',optimize=True)
    font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',19)
    small=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',16)
    # The full overview includes all main and exceptional states at 2x pixels.
    keys=['choose-run','gps','ready','three','run','walk','ride','split','laps','zones','heart','paused','confirm','saved','upload','exit','history','detail','recovery','discard','first','offline','no-hr','long']
    labels={key:label for key,label,scene in SCREENS}
    sheet=Image.new('RGB',(4*428,6*504+58),'#e6eded');draw=ImageDraw.Draw(sheet)
    draw.text((18,15),'Paceboard · one palette · complete screen flow',font=font,fill='#24514f')
    for i,key in enumerate(keys):
        x=i%4*428+14;y=i//4*504+56
        sheet.paste(images[static[key]].resize((400,456),Image.Resampling.NEAREST),(x,y))
        draw.text((x,y+465),labels[key],font=small,fill='#24514f')
    sheet.save(OUT/'overview.png')
    hero=Image.new('RGB',(1284,520),'#e6eded');hdraw=ImageDraw.Draw(hero)
    for i,key in enumerate(('choose-run','run','saved')):
        x=i*428+14;hdraw.text((x,12),labels[key],font=font,fill='#24514f')
        hero.paste(images[static[key]].resize((400,456),Image.Resampling.NEAREST),(x,46))
    hero.save(OUT/'paceboard.png')
    # A silent, finite walkthrough for review outside the interactive player.
    sequence=[];durations=[]
    def hold(key,ms):sequence.append(images[static[key]]);durations.append(ms)
    def clip(key):
        item=clips[key];step=round(item['ms']/(len(item['frames'])-1))
        for i in item['frames']:sequence.append(images[i]);durations.append(step)
    hold('choose-run',900);clip('open-gps');clip('gps-orbit');clip('gps-fix');clip('gps-orbit-close');clip('gps-lock');hold('ready',600)
    for key in ('three','two','one'):clip('beat-'+key);hold(key,720)
    clip('start');hold('run',1600);clip('split-in');hold('split',1400);clip('split-out');hold('after-split',900)
    clip('page-laps');hold('laps',800);clip('page-zones');hold('zones',800);clip('page-heart');hold('heart',800)
    clip('pause');hold('paused',700);clip('finish-sheet');hold('confirm',700);clip('saved');hold('saved',1600)
    sequence=[im.resize((400,456),Image.Resampling.NEAREST) for im in sequence]
    sequence[0].save(OUT/'walkthrough.gif',save_all=True,append_images=sequence[1:],duration=durations,optimize=True,disposal=2)
    gps_frames=[];gps_durations=[]
    for key in ('gps-orbit','gps-fix','gps-orbit-close','gps-lock'):
        item=clips[key];step=round(item['ms']/(len(item['frames'])-1))
        for index in item['frames']:
            gps_frames.append(images[index].resize((400,456),Image.Resampling.NEAREST));gps_durations.append(step)
    gps_frames.append(images[static['ready']].resize((400,456),Image.Resampling.NEAREST));gps_durations.append(1200)
    gps_frames[0].save(OUT/'gps-lock.gif',save_all=True,append_images=gps_frames[1:],duration=gps_durations,optimize=True,disposal=2)
    data={'cols':cols,'width':200,'height':228,'screens':[{'key':key,'label':label,'frame':static[key]} for key,label,scene in SCREENS], 'static':static,'clips':clips,'atlas':'data:image/png;base64,'+base64.b64encode((OUT/'atlas.png').read_bytes()).decode()}
    (OUT/'preview-data.json').write_text(json.dumps(data,separators=(',',':')))
    (OUT/'render-manifest.json').write_text(json.dumps({'screens':len(static),'frames':len(frames),'source_sha256':hashlib.sha256((SOURCE/'paceboard_full.c').read_bytes()).hexdigest(),'palette':'single light sea-glass','size':[200,228]},indent=2)+'\n')
    print('Rendered %d screens and %d motion frames; atlas %d KB'%(len(static),len(frames)-len(static),(OUT/'atlas.png').stat().st_size//1024))
    write_player(data)

if __name__=='__main__':main()
