"""Tile PNG/JPG shots into one sheet: python3 sheet.py out.jpg cols w img1 img2 ..."""
import sys
from PIL import Image
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
ims = [im.resize((w, int(im.height * w / im.width))) for im in ims]
h = max(im.height for im in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * h), (30, 30, 30))
for i, im in enumerate(ims):
    S.paste(im, ((i % cols) * w, (i // cols) * h))
S.save(out, quality=88)
