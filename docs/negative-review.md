# Negative review

The feature is available at `/features/negative/` and `/ru/features/negative/`.
It uses the existing Kit, scroll engine, dictionary drawer, media derivatives and
sound coordinator. Scene copy comes from the supplied storyboard; English is a
natural translation. The original PNGs are copied only when referenced by a scene.

## Editorial decisions and remaining work

- Reader notes are intentionally disabled. Scene 12 contains its supplied text,
  illustration and `notes.enabled: false`; no submission or storage exists.
- TODO: supply the local Markov facsimile. Scene 7 retains the full citation and
  a link to the public-domain source page beside the painting.
- The explicit task requires verbatim storyboard copy, including attributed
  quotations. The supplied FACTS file separately excludes single-source speech.
  The task's explicit copy requirement is followed; this conflict was surfaced
  to the owner. No additional historical assertions were introduced.
- The requested glossary terms have no dedicated cards in this checkout. They
  remain plain text. The existing Gannibal mention links to its dictionary card.
- Source CONTACT.md reports unfinished contour/fill separation in 17 sets and
  missing explicit sRGB profiles on inherited glare layers. Assets are preserved
  without image editing. Disabled version layers 3–7 are neither copied nor shown.

## Media

- `negative-adzyubzha.jpg`: REM 3338-7, via Wikimedia Commons, public domain;
  https://commons.wikimedia.org/wiki/File:Afro-Abkhazians.jpg . Original 556×378.
- `negative-sukhum.jpg`: Prokudin-Gorsky, Library of Congress, LCCN 2018679763;
  https://www.loc.gov/item/2018679763/ . Catalogue rights advisory: no known
  restrictions on publication. Digital colour rendering, 1024×865. Regional context.
- Both local originals are in `content/features/negative/media/`; SHA-256 and
  rights are in the shared ledger. The feature builder validates and copies them
  without a second original in `content/media/`.
- Melodiya MEL CD 3001643: https://melody.su/catalog/folklore/769/ . Track 21 uses
  the official distributor YouTube upload `6OmxlX_dg-4` in the museum player.
  Tracks 4, 12 and 9 use Apple Music's native player, linked from Melodiya's album,
  with IDs 1691528666, 1691528866 and 1691528682 respectively. These IDs were
  checked against the album's track numbers on 2026-11-21. The native player may
  offer previews or require an account; a label-page fallback is always visible.
- Samarin's film uses director upload `-C9ksZ0Z9T4` in the museum player. No film
  frames, sound recordings or third-party portraits are downloaded.

## Privacy and accessibility

The form is handled locally, immediately cleared on submission, and never put in
storage or a request. Camera access only follows the reflection button. It asks
for front-facing video with audio disabled, uses `srcObject`, and stops tracks on
scene exit, hidden document, manual off or disposal. A late permission result is
stopped if the reader has already left. There is no recorder, canvas capture or
upload. Permission denial leaves the glass glint.

Development advances through registered contour, fills, ground and full stages,
with 2.4-second fades and a queued stage per scroll threshold. Calm mode and the
system reduced-motion setting show completed stills immediately. Controls work
with keyboard and touch; the caliper also has a keyboard attempt button. Players
are created only by gesture and share the museum's one-sound coordinator.

## Verification

Run the commands requested in the task from `web/`. The Negative Playwright suite
writes review images for every scene to `/Users/tym83/projects/negative-shots/`
at 1440×900 and 390×844. External players are blocked in deterministic tests;
those tests prove player selection and lifecycle, not territorial playback.

Verified on 2026-11-21: data build and Vite build passed; 454 unit tests passed;
TypeScript passed; all 22 requested browser checks passed (desktop and mobile).
All 14 Russian scene bodies were also compared against the supplied storyboard.
There are 28 scene review PNGs, 14 at each requested viewport size.
