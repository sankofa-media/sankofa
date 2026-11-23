# Sankofa

*Go back and fetch what you left behind.* Sankofa is an Adinkra symbol of the
Akan people of Ghana: a bird that turns its head back to take an egg from its
own back.

Sankofa is a Kubernetes distribution that remembers, and a museum of seven
centuries of Black culture that ships inside it: from the libraries of
Timbuktu to the starships of Sun Ra. Every card in it is short, surprising and
sourced; every fact is checked by two independent agents against two
independent authoritative sources each.

Русская версия: [README.ru.md](README.ru.md).

## What it does for a cluster

| Feature | What it gives you | Inspired by |
|---|---|---|
| **Griot**, the memory | The life of every object, including after deletion: `sankofa tell deployment/web`, `kubectl get timelines`. Status and secret values are never stored; reading the memory follows RBAC. | The griot, keeper of oral history in West Africa |
| **Sankofa fetch** | Restore one object or a whole namespace as it was at any moment, and diff two moments: `sankofa fetch deployment/web --at 2h`, `sankofa fetch namespace/shop --at 2h`, `sankofa diff namespace/shop --from 2h`. Griot also runs alone ([docs/griot.md](docs/griot.md), `charts/griot`). | The Sankofa bird |
| **Kgotla** | Objects labelled `sankofa.kuberoot.dev/kgotla=protected` are deleted only after a council: every named voice has spoken, the chief spoke last. Names come from authentication. | The Tswana kgotla |
| **Polyrhythm** | Write `H` in a CronJob minute (`H 3 * * *`) and jobs take free beats instead of all starting at once. | West African 12/8 ensembles |
| **Credits** | `sankofa credits pod/x` walks an image's declared lineage; a webhook warns or refuses images that hide their base, source or licence. | "Hound Dog" was Big Mama Thornton's before it was Elvis's |
| **Story** | `sankofa story deployment/web` tells an incident in three books (events, changes, heirs) and points out where they disagree. | Pavić's *Dictionary of the Khazars* |
| **Pulse** | The cluster's heartbeat as a live stream; the museum plays it as a polyrhythm. | Call and response |

## What it gives a person

- `sankofa dict`: an endless dictionary in the terminal, in the manner of
  Pavić; links are marked with the book they lead to (❝ voices, ▤ archives,
  ✶ heirs); every installation holds a male or a female copy.
- `sankofa atlas`: a braille world map with a timeline; zoom is a level of
  generalisation, from five centuries of the Atlantic down to one document.
- `sankofa genre why|rdeps|audit hip-hop`: music as a dependency graph.
- `sankofa quest`: real dilemmas (no right answer: you learn what a real person
  chose and what it cost), quizzes and walks through the dictionary.
- `sankofa wait -- <command>`: a surprising line while a long command runs.
- The web museum: a scrollytelling special project with an atlas, a timeline
  and every card; every terminal link opens at the same point.

## The distribution

Sankofa is also a full [kuberoot](https://github.com/kuberoot-dev/kuberoot) distribution:
Griot runs as a node service, nodes boot signed images and upgrade A/B, and
the installed distribution passes upstream Kubernetes conformance **462/462**
(v1.37.2). How to build, boot and test it: [docs/kuberoot.md](docs/kuberoot.md).

## Install as add-ons

```bash
kubectl apply -f deploy/crds/
kubectl apply -f deploy/griot.yaml      # replace the image reference first
kubectl apply -f deploy/webhooks.yaml
go install ./cmd/sankofa                # or: kubectl sankofa
```

## Run your own museum

From the repository root, build and serve at <http://localhost:8080>:

```sh
docker build -f web/Dockerfile --build-arg SITE_URL=http://localhost:8080 -t sankofa-museum . && docker run --rm -p 8080:8080 sankofa-museum
```

Set `SITE_URL` to your public origin for a mirror (default: `https://sankofa.black`).
For Kubernetes, push the image to your registry, substitute `MUSEUM_IMAGE`,
`MUSEUM_HOST` and optional `PUBLIC_HOST` in `deploy/museum.yaml`, then apply
with plain `kubectl`. See [the self-hosting guide](docs/self-host.md) for the
copyable substitution command, optional second Ingress and TLS setup.
No stand scripts or access to our cluster are needed.

Angel's shared words and pulse need the optional service in `deploy/angel.yaml`,
an Anthropic key for automatic moderation and Whisper for voice transcription.
The museum and Angel story work without it. The distribution's optional
read-only visitor access is in `deploy/visitor.yaml`.

## Owner review mode

The owner can leave notes on any element of the museum and its special
projects, typed or dictated, from a phone or a desktop. The notes live in the
angel service (`pkg/angel/review.go`) and need `ANGEL_ADMIN_TOKEN` from the
`angel-anthropic` secret (see `deploy/angel.yaml`).

- Turn it on: open `https://sankofa.black/#review=<ANGEL_ADMIN_TOKEN>` once on
  the device. The token leaves the link at once and stays in that browser.
  `#review=off` (or "Sign out" in the notes list) forgets it.
- Use it: "Comment", then tap the element (or select text first, then
  "Comment"); "Wider" takes the enclosing block; "Dictate" fills the note by
  voice (or records audio where the browser cannot recognise speech).
  Markers show open notes; "Notes" lists them; "Off" folds the bar.
- Read and close them (the token goes only in the header):

```bash
T=...   # ANGEL_ADMIN_TOKEN
curl -sH "Authorization: Bearer $T" https://sankofa.black/api/angel/review/export            # open notes, JSON
curl -sH "Authorization: Bearer $T" 'https://sankofa.black/api/angel/review/export?format=md' # the same as Markdown
curl -sH "Authorization: Bearer $T" -o note-12.webm https://sankofa.black/api/angel/review/12/audio
curl -sX PATCH -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"status":"done"}' https://sankofa.black/api/angel/review/12
```

`?status=done|all` widens the export; `DELETE /api/angel/review/<id>` removes
a note with its voice.

## Content

Cards live in `content/cards` ([format](docs/card-format.md)), chapters in
`content/chapters`, quests in `content/quests`. `sankofa content lint content/cards`
checks sources, links, coordinates and length.

## Tests

```bash
go test ./...
hack/e2e/addons.sh      # on a cluster: cards, memory, fetch, RBAC, Kgotla, Polyrhythm, Credits, visitor, museum
cd web && npm test && npm run e2e
```

## Licence

Code: Apache-2.0. Cards and chapters: CC BY 4.0. Media keep their own public
domain or open licences, credited on every card.
