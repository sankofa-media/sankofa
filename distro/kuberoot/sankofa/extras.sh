# Built in the tenant builder by hack/kuberoot.sh, beside kuberoot's binaries.
for b in griot sankofa; do
  install -m 0755 "$OUT/sankofa/$b" "$r/usr/bin/$b"
done
mkdir -p "$r/var/lib/griot"
# Patched control plane (patches/kubernetes, built by `hack/kuberoot.sh kube`):
# the binaries and the feature gates they carry are installed together, so a
# stock binary never receives a gate it does not know.
k="$OUT/sankofa/kubernetes"
if [ -x "$k/kube-apiserver" ] && [ -x "$k/kube-controller-manager" ]; then
  install -m 0755 "$k/kube-apiserver" "$k/kube-controller-manager" "$r/usr/bin/"
  p="$r/usr/share/kuberoot/profile.yaml"
  for c in kube-apiserver kube-controller-manager; do
    grep -q "^        - /usr/bin/$c\$" "$p"
    sed -i "s|^        - /usr/bin/$c\$|&\n        - --feature-gates=CronJobScheduleSpread=true|" "$p"
  done
  [ "$(grep -c -- '--feature-gates=CronJobScheduleSpread=true' "$p")" = 2 ]
fi
