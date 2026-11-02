from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Highlight
from pypdf.generic import ArrayObject, FloatObject


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "pressbox"


def add_highlights(source, target, highlights):
    reader = PdfReader(source)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    with pdfplumber.open(source) as document:
        for page_number, phrase in highlights:
            page = document.pages[page_number - 1]
            matches = page.search(phrase)
            if not matches:
                raise ValueError(f"Text not found on page {page_number}: {phrase}")
            for match in matches:
                x0 = match["x0"] - 1.5
                x1 = match["x1"] + 1.5
                y0 = page.height - match["bottom"] - 1.5
                y1 = page.height - match["top"] + 1.5
                quad_points = ArrayObject([
                    FloatObject(x0), FloatObject(y1),
                    FloatObject(x1), FloatObject(y1),
                    FloatObject(x0), FloatObject(y0),
                    FloatObject(x1), FloatObject(y0),
                ])
                writer.add_annotation(
                    page_number=page_number - 1,
                    annotation=Highlight(
                        rect=(x0, y0, x1, y1),
                        quad_points=quad_points,
                        highlight_color="ffe45e",
                        printing=True,
                    ),
                )

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as stream:
        writer.write(stream)


add_highlights(
    Path("/tmp/det-2026-09-01.pdf"),
    OUTPUT / "det-2026-09-01-highlighted.pdf",
    [
        (1, "dropped 13 of their last 16 games"),
        (1, "average of 2.8 runs per game"),
        (1, "with a -35 run differential"),
        (1, "Troy Melton has a 2.07 ERA"),
        (1, "lowest ERA by any big league pitcher in their first 20 starts"),
    ],
)

add_highlights(
    Path("/tmp/min-2026-09-01.pdf"),
    OUTPUT / "min-2026-09-01-highlighted.pdf",
    [
        (1, "celebrating his 25th birthday"),
        (1, "first to make a start since José Berríos"),
        (1, "Luke Keaschall"),
        (1, "1.028"),
    ],
)
