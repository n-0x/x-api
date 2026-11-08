# Workloads v1

Contrato de cargas HTTPS, SSH y TCP y sesiones observadas (bloques 4 y 6,
ADR 0024). Toda llamada lleva `account_id` y `tenant_id`; las listas usan
`page_token`, `page_size` y `next_page_token`. Las mutaciones llevan `request_id`,
`reason` obligatorio y `draft_revision_number` opcional, y devuelven
`revision_number`: sin borrador publican; con borrador esperan `PublishDraft`.
Los `uint64`, incluidos tráfico y revisiones, son cadenas decimales en JSON.

**Publicación.** `CreateWorkload(name, type, public_address, existing_node:
{identity_id, local_port, local_address})` devuelve `workload` y
`publish_command.command` de una línea para ese nodo. Con `expose_only:
{local_port, local_address}`, el comando instala el agente sin TUN ni malla;
su secreto de arranque, si lo contiene, es de un uso y solo aparece en esta
respuesta. El comando llama a `RegisterWorkloadFromHost(identity_id, workload_id,
type, local_port, reason)`. Desde un host también se puede invocar con `name`
en lugar de `workload_id`: crea la carga si no existe; otro host con su propia
identidad se suma a la misma carga. La identidad debe coincidir con el nodo
autenticado; registrar el mismo nodo sin cambios conserva la revisión.
Con `direct_destination: {hostname, port}` (o `ipv4`/`ipv6`),
`CreateWorkload` publica sin nodo ni comando. `public_address` vacío pide una
dirección del dominio del tenant. `ListListeningPorts(identity_id)` es ayuda,
no requisito. `workloads.publish` autoriza publicar; publicar no concede acceso.

`GetWorkload(workload_id)` muestra `serving_nodes.nodes`, cada uno con
`identity_id`, `local_port`, `state` y `state_changed_at`, o `direct_destination`.
`state=PUBLISHED` incluye destinos directos; `connected_node_count` cuenta nodos.
`PUBLISHED_NO_CONNECTED_NODES` solo aplica a cargas con nodos; `RETIRED` conserva
historial. `RemoveWorkloadNode(workload_id, identity_id)`, `RetireWorkload(workload_id)`
y `SetWorkloadProtection(workload_id, protected)` siguen las reglas de revisión.
Los cambios de conexión y las sesiones son observaciones, no revisiones.

**Cuatro casos comunes.** Se omiten los dos IDs de ámbito y la idempotencia:

1. **Portátil de ana → db-paris:5432, red.**
   `IdentitiesService.ListIdentities` → `PermissionsService.CheckAccess` (no) →
   `CreatePermission` (portátil-ana, db-paris:5432, red; recomienda carga TCP) →
   `GetRevision` (ambos nodos) → `EventsService.Subscribe` (publicada/aplicada).
   Workloads no publica en este recorrido; observa con
   `ListSessions(identity_id="portatil-ana", destination_identity_id="db-paris",
   layer=NETWORK)` → `GetSession(session_id)`: `node.port=5432`, `permission_id`,
   `mechanism=IDENTITY_FIREWALL`. Véanse los README de identities y permissions.
2. **Adrián → jira-produccion, aplicación con MFA.**
   `CreateWorkload(name="jira-produccion", type=HTTPS, existing_node:
   {identity_id:"jira-paris", local_port:8080}, reason="Publicar Jira")` →
   ejecutar `publish_command.command` → `RegisterWorkloadFromHost(workload_id,
   identity_id="jira-paris", type=HTTPS, local_port=8080, reason="Servir Jira")` →
   `PermissionsService.CreatePermission` (persona adrián, carga `workload.workload_id`,
   MFA) → login con `MfaService.BeginPasskeyAssertion`/`FinishPasskeyAssertion` →
   `ListSessions(workload_id, identity_id="adrian", active_only=true)` →
   `GetSession(session_id)` y `EventsService.ListEvents`: autenticación,
   renovaciones por actividad y cierre en `timeline`; `last_activity_at`,
   `bytes_sent` y `bytes_received`. La consola no abre ni corta sesiones.
3. **api-madrid → postgres, red.**
   `IdentitiesService.ListIdentities` → `PermissionsService.CreatePermission`
   (api-madrid, db-paris:5432, red) → `GetRevision` → `CheckAccess` (sí, permiso,
   capa y mecanismo) → `EventsService.Subscribe` →
   `ListSessions(identity_id="api-madrid", destination_identity_id="db-paris",
   layer=NETWORK)`. Workloads solo observa; las credenciales del nodo se renuevan
   y el plazo de inactividad no corta su tráfico. Véase permissions.
4. **Assignment de tráfico → acciones.**
   `AssignmentsService.ListCatalogEntries` → `ActivateAssignment` →
   `IdentitiesService.GetIdentity` → `GetAssignmentMetrics` →
   `PermissionsService.CreatePermission` (cuenta de servicio, `proxy.block_ip` /
   `identities.quarantine`) → `TriggerAssignmentRun` → `StartAssignmentRun` →
   `AppendAssignmentStep` → `CheckAccess` por acción → `RecordAssignmentChange`
   o `RecordAssignmentRecommendation` → `FinishAssignmentRun` → `GetAssignmentRun`
   → `RevertAssignmentChange` (cuarentena: `ReleaseIdentityQuarantine`) →
   `EventsService.ListEvents`. Esqueleto contractual: bloqueo de IP y cambios
   automáticos quedan fuera de la primera versión. Workloads no ejecuta acciones;
   `ListSessions(identity_id)` permite observar las conexiones de esa cuenta.
   Véanse assignments, identities, permissions y events.

**Conectividad.** En `connectivity/v1`, `ProxyControlService.PublishProxyTable`
entrega la tabla completa compilada (revisión, generación, cargas, permisos y
cuarentena), sustituyendo TargetStore. `AdmissionService.AdmitWorkloadOffer` →
`WorkloadOfferHello` → `ClaimWorkloadOffer` → `WorkloadOfferReady` establece la
pata saliente; `WorkloadStreamOpen` identifica sesión y permiso. El agente usa
`RenewWorkloadOffer` al llegar `renew_after` y envía `WorkloadOfferRenewal`
sin cortar los flujos permitidos; el proxy usa `RefillWorkloadOffer`
y `CloseWorkloadOffer` para el ledger. Son RPC internos nuevos exigidos por
D1/D7, sin cambiar la admisión anterior: cuotas por carga/nodo, mTLS y tickets
de oferta. Los destinos directos validan y fijan DNS, IPv4 e IPv6 y bloquean
infraestructura. No se implementan servidores ni clientes en este paquete.
