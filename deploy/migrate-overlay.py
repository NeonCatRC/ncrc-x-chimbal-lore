#!/usr/bin/env python3
"""One-off migration: move the mutable edit layer out of the :ro content tree.

  data/articles/<id>_<slug>/annotations.json  ->  overlay/annotations/<id>.json
  data/reviews.json                           ->  overlay/reviews.json

Run once against your full archive before switching to the volume layout.
Usage:  python migrate-overlay.py [CONTENT_DIR] [OVERLAY_DIR]
        (defaults: ./data  ./overlay)
"""
import os
import shutil
import sys
import glob

content = sys.argv[1] if len(sys.argv) > 1 else "data"
overlay = sys.argv[2] if len(sys.argv) > 2 else "overlay"

os.makedirs(os.path.join(overlay, "annotations"), exist_ok=True)

moved = 0
for src in glob.glob(os.path.join(content, "articles", "*", "annotations.json")):
    folder = os.path.basename(os.path.dirname(src))
    aid = folder.split("_", 1)[0]            # <id>_<slug> -> id
    if not aid.isdigit():
        print("skip (no numeric id):", src)
        continue
    shutil.move(src, os.path.join(overlay, "annotations", aid + ".json"))
    moved += 1

rev = os.path.join(content, "reviews.json")
if os.path.exists(rev):
    shutil.move(rev, os.path.join(overlay, "reviews.json"))
    print("moved reviews.json -> overlay/")

print(f"moved {moved} annotations.json -> {overlay}/annotations/")
