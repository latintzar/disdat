# Website demonstration

`point-and-talk-*.png` render the existing first-party scene in `website/public/research-vision.html`: `.herodemo > .hstagewrap > .vhero`. Its fictional Flux page, cursor, heat trail, narration and fonts come from that component. Live extension verification uses the separate [browser test](../../tests/browser_extension.py).

The images show the first pointing/recording beat, before the historical hosted-artifact and agent continuation. `capture.css` removes surrounding website and OS/browser furniture while preserving the authored scene. Native geometry is 1000 × 620; the phone view scales uniformly.

From the repository root:

```sh
python -m pip install playwright==1.58.0
python -m playwright install chromium
python docs/assets/render.py --source-public website/public
```

The renderer seeds the source script's random pointer input and advances its animation to 1350 ms. At DPR 2, outputs are 2000 × 1240 and 780 × 484 pixels. `proof.json` records source, CSS, renderer and image hashes, fonts, geometry and blocked requests. Rendering uses local source and its font hosts, with zero provider calls.
