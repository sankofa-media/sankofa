{{- define "griot.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "griot.labels" -}}
app.kubernetes.io/name: griot
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: griot-{{ .Chart.Version }}
{{- end -}}
{{- define "griot.selector" -}}
app.kubernetes.io/name: griot
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "griot.image" -}}
{{- if .Values.image.digest -}}{{ .Values.image.repository }}@{{ .Values.image.digest }}
{{- else -}}{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}{{- end -}}
{{- end -}}
{{- define "griot.validate" -}}
{{- if and (eq .Values.store.type "sqlite") (gt (int .Values.replicas) 1) -}}
{{- fail "store.type=sqlite allows one replica: SQLite has one writer on a ReadWriteOnce volume. Use store.type=postgres for several replicas." -}}
{{- end -}}
{{- if not (has .Values.store.type (list "sqlite" "postgres")) -}}
{{- fail "store.type must be sqlite or postgres" -}}
{{- end -}}
{{- if and (eq .Values.store.type "postgres") (not .Values.store.postgres.existingSecret) -}}
{{- fail "store.type=postgres needs store.postgres.existingSecret with the connection string" -}}
{{- end -}}
{{- end -}}
