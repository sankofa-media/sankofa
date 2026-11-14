# Roots

Roots trace how an artist's style stands on Black traditions. Influence is
style: rhythm, harmony and form, melody and vocal manner, sound and
instruments, performance, attitude and image. It is evidenced by who
listened to whom: the artist's own words, what critics and musicologists
heard, and analysis of the music. A borrowed riff, a cover, a sample, a
producer or a childhood anecdote is never the basis of a route; at most it
is a small optional `example`.

One file per artist or band: `<id>.yaml`. For people, `years` contains
birth and, where applicable, death years; for bands, the year of formation.
`place` is birthplace for people and formation city for bands. Use Cyrillic
aliases for Russian search and follow [`TRANSLATION-RU.md`](../TRANSLATION-RU.md)
and [`GLOSSARY-RU.md`](../GLOSSARY-RU.md). `story` / `storyRu` retell the
artist's own links in two or three sentences and add nothing else.

## Links

Each link leads to another artist (`root:<id>`), a style (`style:<id>`) or a
museum card (`card:<id>`):

| Field | Meaning |
| --- | --- |
| `kind` | `influence` (listened to and drew on), `style` (works in that style or genre), `scene`, `teacher` |
| `scope` | `career` (the formation of the style) or `period`, with `period` naming the period or album |
| `how` / `howRu` | what of the style passed on, in traits |
| `carries` | musical elements from [`elements.yaml`](elements.yaml) |
| `dimensions` | sides of the style the link documents: `rhythm`, `harmony-form`, `melody-vocal`, `sound`, `performance`, `image`; the others are shown as not documented |
| `evidence` | typed items: `testimony`, `listening`, `critics`, `analysis`, each with `dimensions`, `text` / `textRu` and a source with a verbatim `quote` |
| `example` | optional: one song, one sentence, one quoted source |

A link needs at least two evidence items from two different websites, and
every listed dimension needs an evidence item tagged with it. A link belongs
to the artist themselves (for bands, the core creative members), never to a
producer, engineer, label or hired musician. Someone who shaped one period of
the sound goes into the artist's `notes` (`period`, `who`, `role`, `what`,
source), which are never route steps. Every artist must reach a museum card
through `career` links only; a period-only influence is shown, but never as
the main route. Routes have no cycles.

Where an artist's main bond with Black music runs the other way — their
music passed on into a Black tradition rather than growing from one — a
`legacy` note says so (`text` / `textRu`, the museum `cards` it reached and
quoted sources from at least two websites). It is labelled as the other
direction and is never a route step.

## Styles

[`styles.yaml`](styles.yaml) holds the styles artists work in that are not
museum cards: British beat, blues rock, soul, grunge, K-pop and others. Each
has 3–5 traits backed by at least two quoted sources, and `from` steps to the
styles or cards it grew out of, written like links. Every style reaches a
card. In the museum, a style is a station of the route, drawn as a diamond.

## Musical elements, genre steps and lines

[`elements.yaml`](elements.yaml) defines the elements that travelled from
Black traditions into later music (blue notes, the twelve-bar blues, call and
response, the backbeat, swing, improvisation, the riff, slide guitar, gospel
singing, the groove, polyrhythm, the reggae offbeat, dub, the break,
sampling, rap flow), each with its origin cards and at least two quoted
sources. [`card-links.yaml`](card-links.yaml) explains each step between a
card and one of its `roots` by the elements it carried, resting on card facts
or quoted sources. [`lines.yaml`](lines.yaml) gives short overviews of the
main lines: blues, gospel, dance and electronic, hip-hop, Caribbean.

[`roots-style.yaml`](../ledger/roots-style.yaml) records the style edition:
every link and style step with its quoted evidence, the links removed or
demoted (anecdotes, covers, single riffs, producers, proxies, period-only
influences), and the verdicts of an independent second check that reopened
every source.
[`roots-krautrock.yaml`](../ledger/roots-krautrock.yaml) records the
krautrock style, Kraftwerk's career link to it and its legacy note in the
same way, with the independent check that reopened every source.

## Earlier editions

The ledgers below describe the earlier, link-by-link edition, whose routes
partly rested on covers and anecdotes. They remain historical evidence; their
hashes and link counts do not describe the style edition.

[`roots-deep-new.yaml`](../ledger/roots-deep-new.yaml) is the exact inventory
of added edges, generated against baseline commit
`c82dc083797c141e16b5c403e43a09d77ee5cf4f`. It includes the requested artist,
target, kind, claim and sources, plus translations and borrowing descriptions.

The four `roots-deep-{rock,pop,modern,jazz}-research.json` ledgers document
first checks. Matching `-review.json` ledgers record independent checks of
both sources. Their whole-link SHA-256 values bind the accepted kind,
descriptions, English/Russian claims and sources. Canonical encoding is UTF-8
JSON with sorted keys, unescaped Unicode and no separator whitespace. A
changed link needs renewed review. The validation report records current
artist-file hashes as well.

Earlier `roots-{rock,pop,modern,extra}.json`, matching review files and
[`roots-check.yaml`](../ledger/roots-check.yaml) remain historical evidence
for the original claims. Their old whole-file hashes apply to the baseline,
not to the expanded files. Original claims and sources are compared with
that baseline; new annotations and stories receive a separate review.

[`roots-deep-unresolved.yaml`](../ledger/roots-deep-unresolved.yaml) records
the unresolved `Paradise Circus` / Nina Simone lead. It is not an accepted
edge: community attributions and silence in a credits booklet cannot
establish or disprove the sample. Do not invent a replacement attribution.

[`roots-deep-check.yaml`](../ledger/roots-deep-check.yaml) is the second
independent check of every edge in the inventory: a verdict (confirmed,
corrected, refuted, unverified, trivia) with two sources the second checker
opened. Corrected links were fixed in place; unverified links and trivia (a
single cover that shows no formation) were removed, together with the four
intermediate artists they left unreachable. The inventory and the review
hashes above describe the edition before this check.

## Validation

```sh
go run ./cmd/sankofa content lint content/cards
go test ./...
go run ./cmd/sankofa roots --check --content content/cards
go run ./cmd/sankofa roots "Television" --content content/cards
go run ./cmd/sankofa roots "Мумий Тролль" --lang ru --content content/cards
go run ./cmd/sankofa content export content/cards -o /tmp/sankofa-content.json
```

`--content content/cards` selects local content instead of a cluster.
[`roots-deep-validation.json`](../ledger/roots-deep-validation.json) records
the final graph, baseline preservation, review-hash, export and bilingual
CLI checks. The earlier `roots-validation.json` describes only the original
50-artist edition.
