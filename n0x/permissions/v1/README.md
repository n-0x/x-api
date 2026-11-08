# Permissions: permisos y revisiones del tenant

`n0x.permissions.v1.PermissionsService` expresa «permitir a sujeto llegar a objeto por capa si condiciones»: identidad o grupo; nodo con puerto/rango/todos, carga con `host_user` para SSH, o acción de plataforma. Solo concede; sin permiso se deniega. Red requiere nodos con dirección de malla; aplicación deriva login HTTPS, credencial SSH corta o credencial corta de nodo/cuenta de servicio. MFA se exige al autenticar personas; `conditions.expires_at` caduca el permiso. La renovación por actividad pertenece a la sesión: no corta tráfico activo ni añade una condición al permiso. Publicar una carga permite cerrar el resto del host, por eso se recomienda aplicación frente a un puerto de nodo.

Todas las requests incluyen `account_id:"acct-demo", tenant_id:"tenant-demo"` (omitidos abajo). Las mutaciones añaden `request_id` único y `reason` obligatorio; con `draft_revision_number` acumulan cambios sin aplicarlos y sin él publican una revisión nueva. Los `uint64` son cadenas JSON. `UpdatePermission` reemplaza sujeto/objeto/capa/condiciones con `expected_version`; la protección se cambia con `SetPermissionProtection`. Un assignment no puede modificar, retirar ni desproteger un permiso protegido, aunque tenga `permissions.write`.

Las revisiones cubren permisos, cargas, grupos, identidades, configuración del tenant y assignments; cuarentena, bloqueos y conexiones son eventos. `Revision` contiene autor autenticado, motivo, `changes` con frases +/~ /− y valores anteriores, caducidades, `enforcement_points` y `applied_count/total_count`. Los dos nodos confirman reglas de red; proxy y plano de control confirman sus cambios. Estados: borrador → publicada → aplicada → superada, o revertida con `reverted_by_revision_number`. Los nodos desconectados quedan pendientes. Las conexiones que siguen permitidas continúan.

Flujo de revisión: `CreateDraft{request_id:"draft-1",reason:"Revisar acceso"}` → mutaciones con `draft_revision_number:"42"` → `GetRevision{revision_number:"42"}` → `PublishDraft{draft_revision_number:"42",request_id:"preview-1",reason:"Revisar avisos",validate_only:true}` → misma RPC con `validate_only:false` y otro `request_id`, o `DiscardDraft`. Los avisos informan de solapes, root/todos los puertos sin caducidad, carga sin nodo conectado, sujeto en cuarentena y miembros de grupo ignorados; no bloquean. `CreatePermission` y `PublishDraft` devuelven `warnings` y `layer_recommendations`. Un borrador con base obsoleta se rechaza. `Compare{from_revision_number:"40",to_revision_number:"42"}` muestra el diff neto; `Revert{revision_number:"42",request_id:"undo-1",reason:"Deshacer"}` invierte esa revisión, `Revert{change:{revision_number:"42",change_id:"change-1"},…}` invierte solo ese cambio, y `Revert{restore_revision_number:"40",…}` vuelve a esa instantánea. Siempre se crea una revisión nueva, respetando protección y sin borrar historia.

## Cuatro secuencias de RPC

1. **Portátil de Ana → postgres en db-paris:5432 (red).** `IdentitiesService.ListIdentities` resuelve `portatil-ana` y `db-paris` → `CheckAccess{identity_id:"portatil-ana",object:{node:{identity_id:"db-paris",port:5432}},layer:"ACCESS_LAYER_NETWORK"}` devuelve `allowed:false`, `missing:[{reason:"ACCESS_MISSING_REASON_NO_PERMISSION"}]` → `CreatePermission`:

   ```json
   {"permission":{"subject":{"identity_id":"portatil-ana"},"object":{"node":{"identity_id":"db-paris","port":5432}},"layer":"ACCESS_LAYER_NETWORK"},"request_id":"ana-db-1","reason":"Acceso de mantenimiento"}
   ```

   La respuesta aporta `permission.permission_id`, `revision_number:"43"` y `layer_recommendations` para publicar postgres como carga TCP → `GetRevision{revision_number:"43"}` muestra los dos nodos, su `status` y `confirmed_at` → `EventsService.Subscribe` observa publicación y aplicación.

2. **Adrián → jira-produccion (aplicación, MFA).** `WorkloadsService.CreateWorkload` publica HTTPS → `CreatePermission` con el `workload_id` devuelto:

   ```json
   {"permission":{"subject":{"identity_id":"adrian"},"object":{"workload":{"workload_id":"jira-produccion"}},"layer":"ACCESS_LAYER_APPLICATION","conditions":{"require_mfa":true}},"request_id":"jira-1","reason":"Acceso de Adrian con MFA"}
   ```

   → login en n-0x.com con `MfaService.BeginPasskeyAssertion`/`FinishPasskeyAssertion` → `CheckAccess{identity_id:"adrian",object:{workload:{workload_id:"jira-produccion"}},layer:"ACCESS_LAYER_APPLICATION",mfa_satisfied:true}` devuelve `allowed:true`, el permiso y `mechanism:"ACCESS_MECHANISM_PERSON_HTTPS_LOGIN"` → `WorkloadsService.ListSessions` y `EventsService.ListEvents` muestran apertura y renovación por actividad. `mfa_satisfied` solo simula el contexto; no autentica.

3. **api-madrid → postgres (red).** `IdentitiesService.ListIdentities` → `CheckAccess` con `identity_id:"api-madrid"` y el objeto del caso 1 → `CreatePermission` con ese sujeto:

   ```json
   {"permission":{"subject":{"identity_id":"api-madrid"},"object":{"node":{"identity_id":"db-paris","port":5432}},"layer":"ACCESS_LAYER_NETWORK"},"request_id":"api-db-1","reason":"Conexion de la API a postgres"}
   ```

   → `GetRevision` confirma ambos nodos → `CheckAccess` devuelve `allowed:true`, `permission.permission_id`, `layer:"ACCESS_LAYER_NETWORK"`, `mechanism:"ACCESS_MECHANISM_IDENTITY_FIREWALL"` y `last_denial` si hubo una denegación real (con `event_id`, `occurred_at`, `missing`) → `EventsService.Subscribe`. El plazo de inactividad humano no corta al nodo; sus credenciales se renuevan solas. Las negativas distinguen grupo ausente, permiso caducado, cuarentena y falta de permiso, entre otras causas.

4. **Assignment de tráfico → acciones.** `AssignmentsService.ListCatalogEntries` → `ActivateAssignment` → `IdentitiesService.GetIdentity` identifica su cuenta de servicio → `GetAssignmentMetrics` → `ListPlatformActions` enumera `proxy.block_ip` (reservada, sin RPC ejecutora), `identities.quarantine`, `permissions.write` y `workloads.publish` (disponibles para personas autorizadas). El responsable concede por separado cada acción mediante `CreatePermission`:

   ```json
   {"permission":{"subject":{"identity_id":"traffic-review-sa"},"object":{"platform_action":"identities.quarantine"}},"request_id":"traffic-grant-1","reason":"Autoridad concedida tras revisar metricas"}
   ```

   Para `proxy.block_ip` se cambia `object.platform_action`; se omite `layer`, pues no es tráfico. `TriggerAssignmentRun` → runtime `StartAssignmentRun`/`AppendAssignmentStep` → `CheckAccess{identity_id:"traffic-review-sa",object:{platform_action:"identities.quarantine"}}` explica la autoridad → `RecordAssignmentChange` si es ejecutable y permitida, o `RecordAssignmentRecommendation` si no → `FinishAssignmentRun` → responsable `GetAssignmentRun`/`RevertAssignmentChange` → `EventsService.ListEvents`. **En primera versión el assignment solo observa y recomienda:** los cambios automáticos, cuarentenas automáticas y bloqueo de IP no se ejecutan. En el modelo posterior, la cuarentena se revierte con `IdentitiesService.ReleaseIdentityQuarantine`, sin revisión; un cambio gobernado usa `Revert.change`. `AcceptRecommendation` abre un borrador cuyo `origin:{run_id,step_id,recommendation_id}` enlaza al proponente y cuyo autor sigue siendo la persona que acepta.

Los pasos externos se describen en los README de [Identities](../../identities/v1/README.md), [Workloads](../../workloads/v1/README.md), [Assignments](../../assignments/v1/README.md) y [Events](../../events/v1/README.md); Permissions no registra nodos, autentica personas, abre sesiones ni ejecuta acciones.
