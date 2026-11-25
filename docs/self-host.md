# Run your own museum

Run these commands from the repository root. No workshop access, Sankofa
cluster, or stand scripts are needed. The image contains the museum's content
and static site; it does not install the Kubernetes distribution.

## Docker

With Docker installed, build and serve at <http://localhost:8080>:

```sh
docker build -f web/Dockerfile --build-arg SITE_URL=http://localhost:8080 -t sankofa-museum . && docker run --rm -p 8080:8080 sankofa-museum
```

For a public mirror, replace `http://localhost:8080` with your public origin,
for example `https://museum.example.org`. `SITE_URL` defaults to
`https://sankofa.black`. It is a **build setting**, used for canonical links,
sitemaps, robots.txt, llms.txt, social metadata and JSON-LD; rebuild the image
when the origin changes. Serve at the host root, not under a path prefix.
Changing a runtime environment variable does not change the generated site.

The multi-stage build compiles the CLI, runs `sh scripts/build-data.sh &&
npx vite build`, and serves the result with unprivileged nginx on port 8080.
The data script accepts `SANKOFA_BIN` as an executable path and otherwise uses
`go run ./cmd/sankofa`. Linux image variants use libvips and libwebp, installed
in the build stage. No Go, Node, or image tools are needed on the host.

## Kubernetes with kubectl

Use your own cluster and a registry its nodes can pull from. Build for the
nodes' architecture (use Docker's `--platform` if your computer differs):

```sh
docker build -f web/Dockerfile --build-arg SITE_URL=https://museum.example.org -t registry.example.org/you/sankofa-museum:v1 .
docker push registry.example.org/you/sankofa-museum:v1
```

Substitute the three placeholders in [deploy/museum.yaml](../deploy/museum.yaml):

| Placeholder | Your value |
| --- | --- |
| `MUSEUM_IMAGE` | Image reference accessible to your nodes; configure an image pull secret for a private registry. |
| `MUSEUM_HOST` | Primary hostname, without scheme or path, such as `museum.example.org`. |
| `PUBLIC_HOST` | Optional second hostname, without scheme or path; used only by the `museum-domain` Ingress (including its `www` alias). |

This one-liner substitutes all three and removes the optional second-domain
Ingress. Replace the example values with yours before running it:

```sh
sed -e 's#MUSEUM_IMAGE#registry.example.org/you/sankofa-museum:v1#g' -e 's#MUSEUM_HOST#museum.example.org#g' -e 's#PUBLIC_HOST#collection.example.org#g' -e '/^# OPTIONAL:/,/^---$/d' deploy/museum.yaml > /tmp/sankofa-museum.yaml
kubectl apply -f /tmp/sankofa-museum.yaml
kubectl -n sankofa-museum rollout status deployment/museum
```

For the second domain, omit the last `sed -e` expression. Both names serve the
same build, with `SITE_URL` remaining the canonical origin. The namespace is
`sankofa-museum`; choose an unused namespace or adjust every namespace field.

The Ingress assumes an `nginx` ingress class. Point your DNS to your ingress
controller. TLS issuance assumes cert-manager with a ClusterIssuer named
`letsencrypt`; use your own issuer or remove that annotation and supply the
TLS secret yourself. Adapt `ingressClassName`, annotations and TLS to your
cluster. Without an ingress controller, remove the Ingress documents or leave
them inactive and open the site locally using:

```sh
kubectl -n sankofa-museum port-forward service/museum 8080:80
```

Then visit <http://localhost:8080>. For a local-only installation, build with
`SITE_URL=http://localhost:8080` instead.

## Optional live services

The museum, including the Angel story, works without `/api`. Angel's shared
words and pulse need the optional service in
[deploy/angel.yaml](../deploy/angel.yaml). That manifest also includes Whisper
for voice transcription; an Anthropic API key enables automatic moderation
(without it, words wait for owner review). Use the published `ghcr.io/sankofa-media/sankofa/angel` image (or your own with `cmd/angel` and ffmpeg), supply `ANGEL_IMAGE` and
`WHISPER_IMAGE` (a whisper.cpp server image), substitute
your hostnames, and adapt its Ingress, storage and TLS to your cluster. Store
keys in Kubernetes Secrets, never in the site image or repository. This is a
separate deployment, not a requirement for viewing the museum.

The listening room's live cluster heartbeat is separate from Angel. It needs
Griot and the optional nginx configuration in `web/nginx-pulse.conf`: put it
in a ConfigMap named `museum-nginx` (key `pulse.conf`), which
`deploy/museum.yaml` mounts at `/etc/nginx/museum` when it exists. The stand
does this in `hack/stand/museum.sh`; the standalone image does not
require cluster DNS or Griot. A static installation has no live cluster pulse
or visitor kubeconfig.

### Social preview images

The production build renders ten localized JPEG previews at 1200 × 630 under
`dist/social/{en,ru}/`: the museum, special-project list and each feature.
Titles come from the feature data, with the museum's bundled serif fonts.
The build fails if a cover is missing or a title cannot fit into two lines at
56 px or larger. Rendering uses local assets only.

For a local source build, run `cd web && npm ci && npx playwright install chromium`
once before `sh scripts/build-data.sh && npm run build`. The museum Dockerfile
installs Chromium itself; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a
system Chromium when building on another platform.
