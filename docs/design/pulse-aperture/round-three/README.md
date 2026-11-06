# Three fresh layouts — round 3

Preview only, 2026-11-06. [Open the gallery](index.html),
[compare the three main screens](concepts.png), or
[inspect dark mode and long values](all-states.png).

All three lead with pace, retain the last completed kilometre, and show
distance, elapsed time and HR once each. No kilometre progress indicators or
extra HR headings. The former empty bottom strip now carries data in every
layout. The fixtures are identical across designs.

| Design | Composition | Use of the available area |
| --- | --- | --- |
| A — Splitline | Pace and last kilometre share the upper band; distance/time sit below | The upper-right pocket shows the last split and its change from the previous split. A full-width HR reading and history fill the bottom. |
| B — Paceboard | Oversized inverted pace panel, metric pair, last-split row | The pace figure uses the whole upper width. The lower edge becomes a compact HR reading, exact zone marker and zone number. |
| C — Sidecar | Pace, distance and time down the left; HR down the right | A continuous HR/history column occupies the upper-right area. Last KM anchors the bottom of the main column. |

The small delta belongs to the last completed kilometre and compares it with
the previous completed kilometre. The traces are illustrative ten-minute HR
histories. These are layout choices, not new recording features or production
screens.

Nine native PebbleOS renders were inspected: light, dark and long values for
each design. The watch frame is 200×228, with native fonts and LCD colour
correction. Long checks include `99:59`, `128.74`, `12:59:59`, `188` and
`+12:34`. No emulator or production build is required for this iteration.

Regenerate using the existing preview resource pack:

```sh
npm run design:render -- --round-three
```

Source: [native layout code](../preview/src/c/design.c),
[renderer wrapper](../../../../tools/render_native_study.py).
