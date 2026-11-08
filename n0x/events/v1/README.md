# Events v1

`n0x.events.v1.EventsService` ofrece un flujo por tenant: conexiones, denegaciones,
cambios, identidades, cargas, assignments, alertas y bloqueos. `Event` incluye
`event_id`, `account_id`, `tenant_id`, `occurred_at`, `type`, `actor`, `object`,
`summary`, `link` y `related_objects`. El autor distingue persona, nodo, cuenta de
servicio, assignment y plataforma; los cuatro primeros llevan `identity_id`.
Un assignment añade `instance_id`. El objeto enlaza un tipo con `object_id`,
`revision_number` o `assignment_run={run_id,step_id}`; los enlaces relacionados
permiten saltar, por ejemplo, de sesión a permiso o de alerta a ejecución.

Todas las peticiones siguientes llevan `account_id="acme",tenant_id="produccion"`.
IDs ficticios, sin secretos; las revisiones `uint64` son cadenas en ProtoJSON.
`EventFilter` combina tipos con OR y autor/objeto/intervalo con AND; el intervalo es
`[occurred_from,occurred_before)`. Una referencia de objeto también busca en
`related_objects`. Los textos son datos de presentación no confiables.

## Cuatro recorridos de RPC

1. **Portátil de Ana → db-paris:5432, red.** `IdentitiesService.ListIdentities`
   (ambos nodos) → `PermissionsService.CheckAccess` (falta permiso) →
   `CreatePermission` (portátil → db-paris, TCP 5432; aviso de publicar postgres como
   carga TCP) → `GetRevision` (aplicación en ambos nodos) →
   `EventsService.Subscribe(filter={types:[EVENT_TYPE_CHANGE],object:{type:
   EVENT_OBJECT_TYPE_REVISION,revision_number:"42"}},cursor="")`.
   Cada publicación/aplicación llega con `event.object.revision_number="42"`;
   `GetEvent(event_id="event-42-applied")` recupera el detalle. Para hechos ya
   publicados, consultar primero `ListEvents` y continuar desde su cursor.
2. **Adrián → jira-produccion, aplicación y MFA.** `WorkloadsService.CreateWorkload`
   (HTTPS) → `PermissionsService.CreatePermission` (persona → carga, condición MFA) →
   login con `MfaService.BeginPasskeyAssertion`/`FinishPasskeyAssertion` →
   `WorkloadsService.ListSessions` → `EventsService.ListEvents(filter={types:
   [EVENT_TYPE_CONNECTION],author:{type:EVENT_ACTOR_TYPE_PERSON,identity_id:
   "person-adrian"},object:{type:EVENT_OBJECT_TYPE_SESSION,object_id:"session-jira-1"}},
   page_size=100)`: apertura y renovaciones por actividad, con carga/permiso
   en `related_objects`. Ningún RPC de Events abre o corta sesiones.
3. **api-madrid → postgres, red.** `IdentitiesService.ListIdentities` →
   `PermissionsService.CreatePermission` (nodo api-madrid → db-paris:5432) →
   `CheckAccess` (sí; permiso, capa y mecanismo) → `GetRevision` →
   `EventsService.ListEvents(filter={types:[EVENT_TYPE_CONNECTION,EVENT_TYPE_DENIAL],
   author:{type:EVENT_ACTOR_TYPE_NODE,identity_id:"node-api-madrid"},occurred_from:
   "2026-11-08T00:00:00Z",occurred_before:"2026-11-09T00:00:00Z"},page_size=100)`.
   El plazo de inactividad humano no corta al nodo; una denegación enlaza al probador.
4. **Assignment de tráfico → acciones.** `AssignmentsService.ListCatalogEntries` →
   `ActivateAssignment` → `IdentitiesService.GetIdentity` → `GetAssignmentMetrics` →
   `PermissionsService.CreatePermission` (cuenta de servicio → acción) →
   `TriggerAssignmentRun` → runtime `StartAssignmentRun`, `AppendAssignmentStep`,
   `CheckAccess`, `RecordAssignmentChange` o `RecordAssignmentRecommendation`,
   `FinishAssignmentRun` → responsable `GetAssignmentRun`, `RevertAssignmentChange`
   (cuarentena: `IdentitiesService.ReleaseIdentityQuarantine`) →
   `EventsService.ListEvents(filter={types:[EVENT_TYPE_ASSIGNMENT],object:{type:
   EVENT_OBJECT_TYPE_ASSIGNMENT_RUN,assignment_run:{run_id:"run-1"}}},page_size=100)`.
   Para un paso: `object={type:EVENT_OBJECT_TYPE_ASSIGNMENT_STEP,assignment_run:
   {run_id:"run-1",step_id:"step-1"}}`; `actor={type:EVENT_ACTOR_TYPE_ASSIGNMENT,
   identity_id:"sa-review-1",instance_id:"review-1"}`. Recorrido y campos de escritura
   detallados en [Assignments](../../assignments/v1/README.md); este servicio observa.

## Historial y reanudación

`ListEvents(filter=F,page_size=100)` → repetir con `page_token=next_page_token` y
el mismo filtro hasta agotarlo → `Subscribe(filter=F,cursor=cursor)` de la última
página. Guardar cada `SubscribeResponse.cursor`; reconectar con ese cursor y el
mismo filtro, deduplicando por `event_id`. Una respuesta sin evento es un checkpoint.
Cursor vacío empieza en vivo; filtro/ámbito distinto produce `INVALID_ARGUMENT`,
cursor caducado `OUT_OF_RANGE`: recargar historial explícitamente, sin ocultar huecos.
El orden es por hora con desempate estable por `event_id`; cursor y page_token son
opacos y diferentes. **Primera versión:** no hay bloqueos de IP ni eventos de cambios
automáticos de assignments; los tipos del contrato anticipan el modelo completo.
