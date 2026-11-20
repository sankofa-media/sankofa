"""Rebuild first-screen faces: pip install fonttools==4.68.0 brotli==1.2.1.
Full variable faces remain available when reading beyond the cover.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1] / 'src/fonts'
for source, target, axes in [
    ('fraunces-latin-full-normal', 'fraunces-cover', {'wght': 400, 'opsz': 144, 'SOFT': 100, 'WONK': 1}),
    ('fraunces-latin-full-italic', 'fraunces-cover-italic', {'wght': 350, 'opsz': 144, 'SOFT': 100, 'WONK': 1}),
    ('literata-cyrillic-opsz-italic', 'literata-cover-italic', {'wght': 350, 'opsz': 18}),
    ('literata-cyrillic-opsz-normal', 'literata-cover', {'wght': 400, 'opsz': 18}),
    ('inter-cyrillic-standard-normal', 'inter-cyrillic-cover', {'wght': 400, 'opsz': 14}),
    ('inter-latin-standard-normal', 'inter-cover', {'wght': 400, 'opsz': 14}),
]:
    font = TTFont(root / (source + '.woff2'), recalcTimestamp=False)
    available = {a.axisTag for a in font['fvar'].axes}
    font = instantiateVariableFont(font, {k: v for k, v in axes.items() if k in available}, inplace=True)
    slimmer = subset.Subsetter()
    slimmer.populate(unicodes=font.getBestCmap())
    slimmer.subset(font)
    font.save(root / (target + '.woff2'))
