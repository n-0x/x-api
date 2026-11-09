# Cargas v1

Publica cargas HTTPS/SSH/TCP y observa sesiones; publicar no concede acceso.
`Workload` y `CreateWorkloadRequest` incluyen `byte_limit` (cadena JSON) y `window`
(Duration), por carga y nodo. Ausentes conservan los valores del servicio;
cero bytes no concede tráfico. El alta desde host usa la ruta mTLS de nodo
`NodeControlService.RegisterWorkloadFromHost` en [control.proto](../../control/v1/control.proto).
Publicación, renovación y seguridad agente/proxy: [connectivity.proto](../../connectivity/v1/connectivity.proto).

Toda llamada lleva `account_id`, `tenant_id`; listas: `page_token`, `page_size`, `next_page_token`.
Mutaciones: `request_id`; `reason` obligatorio en cambios gobernados y cuarentenas.
Gobernadas: `draft_revision_number` opcional (acumula sin aplicar; ausente publica),
devuelven `revision_number`. `uint64`: cadenas JSON.
Cuarentena y conexiones no crean revisión. Ámbito e idempotencia se omiten abajo; IDs ficticios.

1. **Portátil de ana → db-paris:5432 (red).** `IdentitiesService.ListIdentities` →
   `PermissionsService.CheckAccess(identity_id="portatil-ana",object.node={identity_id:"db-paris",port:5432},layer=ACCESS_LAYER_NETWORK)` (denegado) →
   `PermissionsService.CreatePermission(permission={subject:{identity_id:"portatil-ana"},object:{node:{identity_id:"db-paris",port:5432}},layer:ACCESS_LAYER_NETWORK})`
   (recomienda publicar postgres como carga TCP) → `PermissionsService.GetRevision(revision_number)`
   (confirman ambos nodos) → `EventsService.Subscribe(filter.types=[EVENT_TYPE_CHANGE])`.
2. **Adrián → jira-produccion (MFA).** `WorkloadsService.CreateWorkload(name="jira-produccion",type=WORKLOAD_TYPE_HTTPS,existing_node={identity_id:"jira-paris",local_port:8080})` →
   `PermissionsService.CreatePermission(permission={subject:{identity_id:"adrian"},object:{workload:{workload_id}},layer:ACCESS_LAYER_APPLICATION,conditions:{require_mfa:true}})` →
   login n-0x.com: `MfaService.BeginPasskeyAssertion(identity_id,session_id)` →
   `MfaService.FinishPasskeyAssertion(identity_id,session_id,challenge_id,credential_json)` →
   `WorkloadsService.ListSessions(workload_id,identity_id="adrian")` → `EventsService.ListEvents` (apertura/renovación por actividad).
3. **api-madrid → postgres (red).** `IdentitiesService.ListIdentities` →
   `PermissionsService.CreatePermission` (como 1, `permission.subject.identity_id="api-madrid"`) →
   `PermissionsService.GetRevision(revision_number)` → `PermissionsService.CheckAccess`
   (como 1, `identity_id="api-madrid"`; devuelve `allowed=true`, `permission`, `layer`, `mechanism`) →
   `EventsService.Subscribe`. Inactividad de nodo desactivada por defecto; credenciales renovadas automáticamente.
4. **Assignment → acciones (recorrido objetivo).** `AssignmentsService.ListCatalogEntries` →
   `AssignmentsService.ActivateAssignment(catalog_id,catalog_version)` → `IdentitiesService.GetIdentity(identity_id)` (cuenta creada) →
   `AssignmentsService.GetAssignmentMetrics(instance_id)` → `PermissionsService.CreatePermission`
   (`permission.subject.identity_id` de esa cuenta; `permission.object.platform_action="proxy.block_ip"`/`"identities.quarantine"`, sin capa) →
   `AssignmentsService.TriggerAssignmentRun(instance_id)` → runtime: `AssignmentsService.StartAssignmentRun(run_id)` →
   `AssignmentsService.AppendAssignmentStep(run_id,step.step_id)` → `PermissionsService.CheckAccess(identity_id,object.platform_action)` →
   `AssignmentsService.RecordAssignmentChange(run_id,change.step_id)` si permitida/ejecutable, o `AssignmentsService.RecordAssignmentRecommendation(run_id,recommendation.step_id)` →
   `AssignmentsService.FinishAssignmentRun(run_id,result)` → responsable: `AssignmentsService.GetAssignmentRun(run_id)` →
   `AssignmentsService.RevertAssignmentChange(run_id,change_id,reason)` (cuarentena: `IdentitiesService.ReleaseIdentityQuarantine(identity_id,reason)`) → `EventsService.ListEvents`.

`publish_command.command` y secreto de arranque: solo una vez, nunca en lecturas/logs.
Publicación desde host o destino directo y sesiones: [workloads.proto](workloads.proto).
En 1/3/4 solo observa; identidades, permisos, MFA y runtime son externos.

Otros servicios: [identities](../../identities/v1/README.md), [permissions](../../permissions/v1/README.md), [assignments](../../assignments/v1/README.md), [events](../../events/v1/README.md).

**Primera versión:** assignments observa/recomienda; quedan fuera cambios automáticos, bloqueo IP,
permisos de acciones para assignments, métricas, rollback, topes, protección y disparadores webhook/alerta.
El contrato anticipa esos pasos; no incluye implementaciones de servidores/clientes.
