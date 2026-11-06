#!/usr/bin/env python3
"""Render the Pulse/Aperture comparison using the sibling PebbleOS renderer.

Only reads the sibling repository; app object files and images stay here/in tmp.
Run pebble build in docs/design/pulse-aperture/preview once after resource changes.
"""
import argparse
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'docs/design/pulse-aperture/preview'
OUT = PROJECT.parent

def render_explorations(args, executable, screenshot):
    """A fresh comparison, retaining earlier rounds as a design record."""
    from PIL import Image, ImageDraw, ImageFont
    out = OUT / 'round-three'
    out.mkdir(exist_ok=True)
    names = [design + '-' + state for state in ('light', 'dark', 'stress')
             for design in ('splitline', 'paceboard', 'sidecar')]
    images = []
    with tempfile.TemporaryDirectory() as temp:
        raw = Path(temp) / 'frame.raw'
        for index, name in enumerate(names, start=30):
            subprocess.run([executable, str(args.renderer / 'fw'),
                            str(PROJECT / 'build/emery/app_resources.pbpack'),
                            str(index), str(raw)], check=True, capture_output=True)
            img = screenshot.framebuffer_to_image(raw.read_bytes())
            img.save(out / (name + '.png'))
            images.append(img)
    titles = ['A — Splitline', 'B — Paceboard', 'C — Sidecar']
    descriptions = ['Last KM beside pace; wide HR history',
                    'Largest pace; dedicated split row',
                    'HR column; split anchored at the bottom']
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
    small = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
    sheet = Image.new('RGB', (1356, 3 * 530 + 72), '#ecece8')
    draw = ImageDraw.Draw(sheet)
    for col in range(3):
        draw.text((20 + col * 452, 12), titles[col], fill='#111111', font=font)
        draw.text((20 + col * 452, 42), descriptions[col], fill='#444444', font=small)
    for row, state in enumerate(('Light', 'Dark', 'Long values')):
        y = 82 + row * 530
        for col in range(3):
            sheet.paste(images[row * 3 + col].resize((400, 456), Image.Resampling.NEAREST),
                        (20 + col * 452, y))
        draw.text((20, y + 467), state + ' · identical activity data across all three',
                  fill='#444444', font=small)
    sheet.save(out / 'all-states.png')
    sheet.crop((0, 0, 1356, 585)).save(out / 'concepts.png')
    cards = ''.join('<figure><img src="%s.png" alt="%s"><figcaption>%s</figcaption></figure>' %
                    (name, name.replace('-', ' '), name.replace('-', ' ')) for name in names)
    (out / 'index.html').write_text('''<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width"><title>Pacelet · Three fresh layouts</title>
<style>body{font:17px system-ui;background:#ecece8;color:#171717;max-width:1400px;margin:40px auto;padding:0 24px}p{line-height:1.6;max-width:80ch}.sheet{width:100%;max-width:1356px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}figure{margin:0;padding:16px;background:white}figure img{width:200px;height:228px;image-rendering:pixelated}figcaption{margin-top:12px}</style>
<h1>Three fresh layouts.</h1><p>Round 3 · Pace leads. Last KM stays visible. Distance, elapsed and HR each appear once. These are native 200 × 228 PebbleOS font/layout previews, with LCD colour correction and illustrative data.</p>
<p><strong>A — Splitline:</strong> Last KM occupies the upper-right pocket beside pace; HR and its history fill the bottom. <strong>B — Paceboard:</strong> the biggest pace figure, a separate last-split row, and a compact HR scale. <strong>C — Sidecar:</strong> a continuous HR column on the right, with the last split anchored at the bottom left.</p>
<img class="sheet" src="all-states.png" alt="Three distinct Pacelet designs in light, dark and long-value states">
<p>The HR traces are illustrative ten-minute histories. Zone labels and the precise marker complement colour; no decorative kilometre progress or duplicate HR headings are used. These layouts remain separate from the production app.</p>
<div class="cards">''' + cards + '</div>')
    print('Rendered 9 round-three native frames: %s' % (out / 'concepts.png'))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer', type=Path, default=ROOT.parent / 'pebble-watchface-agent-skill/watchface-lab/renderer')
    parser.add_argument('--round-three', action='store_true', help='Render three fresh pace-first layouts.')
    args = parser.parse_args()
    host = args.renderer.resolve() / 'hostgfx'
    sys.path.insert(0, str(host))
    import build
    import screenshot
    from PIL import Image, ImageDraw, ImageFont
    # Firmware objects are immutable shared inputs. Compile only app objects in
    # a task-local cache, avoiding writes or locks in the sibling repository.
    fw_objects = [args.renderer / 'build/fw' / (s[:-2] + '.o') for s in build.FW_SOURCES]
    fw_objects += [args.renderer / 'build/fw/tinymt32.o', args.renderer / 'build/fw/fw_host.o']
    if not all(p.exists() for p in fw_objects):
        raise SystemExit('Renderer firmware objects missing. Set up the sibling renderer first.')
    build.APP_BUILD = str(Path(tempfile.gettempdir()) / 'pacelet-native-study')
    executable = build.build_project(str(PROJECT), 0, [str(p) for p in fw_objects])
    if args.round_three:
        render_explorations(args, executable, screenshot)
        return
    names = ['pulse-live','aperture-live','pulse-dark','aperture-dark','pulse-long','aperture-long',
             'pulse-walk','aperture-walk','pulse-stale','aperture-stale','pulse-split','aperture-split',
             'pulse-paused','aperture-paused','countdown','saved','upload','split-iris1','split-iris2','split-iris3','workout-main','workout-dark','workout-long','workout-walk','workout-stale','workout-split','workout-paused','workout-metrics','workout-zones','workout-heart']
    images = []
    with tempfile.TemporaryDirectory() as temp:
        raw = Path(temp) / 'frame.raw'
        for index, name in enumerate(names):
            subprocess.run([executable, str(args.renderer / 'fw'), str(PROJECT / 'build/emery/app_resources.pbpack'), str(index), str(raw)], check=True, capture_output=True)
            img = screenshot.framebuffer_to_image(raw.read_bytes())
            img.save(OUT / (name + '.png'))
            images.append(img)
    sheet = Image.new('RGB', (1356, 7 * 506 + 70), '#ecece8')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 20)
    draw.text((20,15),'A — Pulse / full HR trace',fill='#111111',font=font)
    draw.text((472,15),'B — Aperture / last split',fill='#111111',font=font)
    draw.text((924,15),'C — Workout / focused pages',fill='#111111',font=font)
    labels = ['Running · matching data','Dark cycling · matching data','Long run · 128.74 km','Long walk · 123456 steps','Measuring HR · phone offline','Kilometre split · -9s vs previous','Paused · live HR / frozen trace']
    for row,label in enumerate(labels):
        y = 60 + row * 506
        for col in range(3):
            sheet.paste(images[20+row if col==2 else row*2+col].resize((400,456),Image.Resampling.NEAREST),(20+452*col,y))
        draw.text((20,y+463),label,fill='#333333',font=font)
    sheet.save(OUT / 'comparison.png')
    hero=Image.new('RGB',(1356,520),'#ecece8');hero.paste(sheet.crop((0,0,1356,520))); hero.save(OUT/'first-look.png')
    hero.save(OUT/'pace-first.png')
    cards = ''.join('<figure><img src="%s.png"><figcaption>%s</figcaption></figure>' % (name,name.replace('-',' ')) for name in names)
    (OUT/'index.html').write_text('''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pacelet · Pulse / Aperture</title>
<style>body{background:#efefeb;color:#151515;font:17px system-ui;max-width:1400px;margin:40px auto;padding:0 24px}h1{font-size:42px}p{max-width:75ch;line-height:1.6}.comparison{width:100%;max-width:1356px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}figure{margin:0;padding:20px;background:white}figure img{width:200px;height:228px;image-rendering:pixelated}figcaption{margin-top:12px}button{padding:12px;margin:10px 6px 20px 0}#motion{width:400px;image-rendering:pixelated}</style>
<h1>Pace first.</h1><p>Round 2 · Native 200 × 228 Emery graphics and system fonts, with LCD colour correction. Running puts pace first, with distance and elapsed time below. Cycling leads with speed; walking retains elapsed time and steps. Every option keeps the last completed kilometre result visible. Heart icons and zone badges identify HR without another heading or footer. A keeps Pulse’s full-width effort field and rolling HR trace. B pairs a compact HR tile with the most recent completed split. C borrows the hierarchy and focused pages from <a href="https://github.com/coredevices/PebbleOS/commit/c3ee3803515aa97994a8c214470ef9a8a5a8d157">PebbleOS Workout’s redesign</a>, with an exact HR marker. Its extra pages use only metrics Pacelet can record; they remain proposals.</p>
<img class="comparison" src="comparison.png" alt="Seven matching Pulse, Aperture and Workout-inspired screen sets, with pace leading the running dashboard">
<h2>Split motion study</h2><p>The split opens from the effort field. Chrome stays fixed; the values show recorded data. This is a timed sequence of native frames, not measured device frame pacing.</p><button onclick="play()">Replay aperture reveal</button><button onclick="stop()">Stop</button><br><img id="motion" src="pulse-split.png" alt="Native split transition study">
<h2>Shared states and individual frames</h2><div class="cards">'''+cards+'''</div><script>let timer;function stop(){clearTimeout(timer)}function play(){stop();const frames=['split-iris1','split-iris2','split-iris3','pulse-split'];let i=0;function tick(){document.getElementById('motion').src=frames[i++]+'.png';if(i<frames.length)timer=setTimeout(tick,160)}tick()} </script>''')
    print('Rendered %d native frames: %s' % (len(names), OUT/'comparison.png'))

if __name__ == '__main__':
    main()
