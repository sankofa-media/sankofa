# Documents on the desk

One file per primary document. The museum lays the scan on a desk and, as the
reader scrolls, outlines each listed line on the page and explains it.

- `card`: the card the document belongs to; every `note` is drawn from that card.
- `pages[].file`: a derivative in `content/media/` (long edge at most 1600 px),
  recorded with its rights in `content/ledger/media-documents.yaml`.
- `lines[].boxes`: where the line sits on the page, as fractions of the page
  width and height: `[x, y, w, h]`, one box per printed line it covers.
- `lines[].text`: the transcription exactly as printed (long s kept as ſ);
  `ru`: a Russian translation; `note`: one sentence of context from the card.
