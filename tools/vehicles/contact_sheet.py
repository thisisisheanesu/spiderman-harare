"""Labelled contact sheet of preview images.

    python3 tools/vehicles/contact_sheet.py OUT.jpg COLS img1 [img2 ...]
Each image is scaled to 480 px wide and labelled with its file name."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def main():
    out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
    W = 480
    tiles = []
    for f in files:
        im = Image.open(f).convert('RGB')
        im = im.resize((W, int(im.height * W / im.width)))
        d = ImageDraw.Draw(im)
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
        except OSError:
            font = ImageFont.load_default()
        label = os.path.splitext(os.path.basename(f))[0]
        d.rectangle((0, 0, 8 + 9 * len(label), 22), fill=(20, 20, 20))
        d.text((5, 3), label, font=font, fill=(240, 240, 240))
        tiles.append(im)
    H = max(t.height for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (W * cols, H * rows), (40, 40, 40))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * W, (i // cols) * H))
    sheet.save(out, quality=82)


if __name__ == '__main__':
    main()
