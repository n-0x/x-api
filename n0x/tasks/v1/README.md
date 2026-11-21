# Tasks v1

Una task es una unidad de trabajo en segundo plano; un step es la parte que un worker reclama y
ejecuta. El motor no interpreta `origin`: guarda `adapter`, `ref` y `labels`, y filtra y agrega por
ellos. Quien encola no elige la identidad: `subject_identity_id` la resuelve el servidor.

Encolar, liberar un step en espera y cancelar son operaciones internas de resources; no están en
este contrato. `uint64`: cadenas JSON. `Record.text` es narrativa no confiable (puede venir del
modelo): nunca se ejecuta ni se usa como autoridad.

## Worker (`TaskWorkerService`, endpoint privado, mTLS de un worker de sistema)

1. `ClaimStep(programs=[{program_id,program_version}], wait="20s")`: solo mTLS. Sin `programs`,
   `InvalidArgument`. Sin trabajo, respuesta sin `claim`. Con trabajo: la task con todos sus steps
   (los anteriores traen `state` y `output_json`), `step_id`, `attempt`, `token`,
   `lease_expires_at` y `deadline`.
2. Las tres llamadas siguientes llevan `Authorization: Bearer <token>`; el token identifica step e
   intento, por eso las peticiones no repiten identificadores.
3. `AppendRecord(seq=1,kind="observation",text,data_json)`: repetir un `seq` ya escrito no duplica
   ni falla.
4. `RenewStep()` cada 20 s (lease de 60 s). `cancel_requested=true`: parar y completar con
   `ATTEMPT_OUTCOME_CANCELLED`. `FailedPrecondition`: el intento ya no es el vigente o pasó su
   `deadline`; dejar de escribir.
5. `CompleteStep(outcome,output_json,error)`: `output_json` de más de 1 MiB devuelve
   `ResourceExhausted` y deja el intento abierto. Si el adaptador rechaza la salida, el step queda
   `STEP_STATE_FAILED` con ese motivo.

Reintento automático solo por lease perdido (`ATTEMPT_OUTCOME_LEASE_LOST`), hasta `max_attempts`.
Un error del programa es terminal. Los intentos se añaden: uno nuevo no borra registros ni salida
del anterior.

## Lectura (`TasksService`, permiso `tasks.read` en el tenant)

`ListTasks(adapter="assignments",labels={instance_id:"…"})` → `GetTask(task_id)` (steps e
intentos, con `model_usage` por intento) → `ListRecords(task_id,step_id)` (último intento si
`attempt=0`) → `GetTaskMetrics(group_by=TASK_METRICS_GROUP_BY_LABEL,group_label="charter_id")`.
Ventana máxima de métricas: 30 días. Los promedios faltan cuando no hay muestras.

x-console debe aceptar `tasks.read` en su lista de permisos conocidos (`global/api.ts`,
`loadTenantPermissions`) antes de que el backend lo devuelva.

## Etiquetas del adaptador `assignments`

| Etiqueta | Valor |
| --- | --- |
El adaptador las escribe al disparar la run y reflejan el estado de ese momento.

| Etiqueta | Valor | Presente |
| --- | --- | --- |
| `instance_id` | Instancia del assignment | Siempre |
| `catalog_id`, `catalog_version` | Entrada del catálogo y su versión | Siempre |
| `charter_id`, `charter_version` | Charter que se disparó | Siempre |
| `trigger_type` | `manual` o `cron` | Siempre |
| `triggered_at` | Momento del disparo, RFC 3339 en UTC | Siempre |
| `observed_revision` | `revision_number` de la instancia al disparar, en decimal | Siempre |
| `trigger_identity_id` | Identidad que disparó la run | Solo `manual` |
| `cron_expression`, `time_zone` | Expresión cron y zona horaria del disparo | Solo `cron` |
| `change_limit` | `change_limit` de la instancia en ProtoJSON | Solo si la instancia tiene límite |

`origin.ref` es `<instance_id>:<charter_id>@<charter_version>:<trigger_type>`. El `run_id` de
`AssignmentRun` es el `task_id`.

## Límites

Salida de un step: 1 MiB. Lease: 60 s. Espera de `ClaimStep`: hasta 30 s. Tasks abiertas por
tenant: 32 (al superarlo, la task nace `TASK_RESULT_SKIPPED` con `reason=tenant_open_tasks_limit`,
salvo que el adaptador rechace antes el disparo). Registro: `text` + `data_json` hasta 64 KiB. Etiquetas: hasta 16 por task.
Retención: 180 días desde `finished_at`.
