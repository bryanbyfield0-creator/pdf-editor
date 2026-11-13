#!/usr/bin/env python3
"""Build a 3-page sample PDF for end-to-end tests."""
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

out = Path(__file__).parent / "sample.pdf"
c = canvas.Canvas(str(out), pagesize=letter)
width, height = letter

def page(title, body):
    c.setFillColorRGB(0.95, 0.97, 0.96)
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColorRGB(0.06, 0.46, 0.43)
    c.rect(0, height - 72, width, 72, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(54, height - 48, title)
    c.setFillColorRGB(0.08, 0.2, 0.23)
    c.setFont("Helvetica", 16)
    text = c.beginText(54, height - 130)
    for line in body:
        text.textLine(line)
    c.drawText(text)
    c.setFont("Helvetica", 11)
    c.setFillColorRGB(0.4, 0.45, 0.46)
    c.drawString(54, 36, "Sample document for the in-browser PDF editor test.")
    c.showPage()

page("PAGE ONE", ["This is the first page of the sample file.", "Use it to add text, a drawing, and a highlight."])
page("PAGE TWO", ["This is the second page.", "The editor test deletes this page before downloading."])
page("PAGE THREE", ["This is the third page.", "It should remain in the downloaded PDF."])
c.save()
print(f"wrote {out} ({out.stat().st_size} bytes)")
