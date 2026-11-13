#!/usr/bin/env python3
"""Build a photo-heavy PDF to test compression."""
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image
import io
import random

rnd = random.Random(42)
img = Image.new("RGB", (1600, 1200))
pix = img.load()
for y in range(1200):
    for x in range(1600):
        pix[x, y] = (
            (x * 3 + rnd.randint(0, 80)) % 256,
            (y * 2 + rnd.randint(0, 80)) % 256,
            (x + y + rnd.randint(0, 80)) % 256,
        )
buf = io.BytesIO()
img.save(buf, format="JPEG", quality=95)
buf.seek(0)

out = Path(__file__).parent / "photo-sample.pdf"
c = canvas.Canvas(str(out), pagesize=letter)
w, h = letter
c.setFont("Helvetica-Bold", 22)
c.drawString(54, h - 48, "PHOTO SAMPLE")
c.drawImage(ImageReader(buf), 54, 200, width=504, height=378)
c.setFont("Helvetica", 12)
c.drawString(54, 160, "A large embedded photo used to test Smaller file.")
c.save()
print(f"wrote {out} ({out.stat().st_size} bytes)")
