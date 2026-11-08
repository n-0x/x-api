# Assignments v1

Contrato de `n0x.assignments.v1.AssignmentsService` (ADR 0023, bloque 5).
Catálogo `catalog_id@catalog_version` → instancia del tenant → ejecución con versión
congelada. `identity_id` es la cuenta de servicio; `responsible_identity_id`, una
persona. Activar crea ambas entidades, asigna al humano autenticado como responsable
y deja la instancia en lectura/recomendación, sin conceder acciones. Los permisos
sobre acciones se otorgan por separado en `PermissionsService`.

Todas las llamadas llevan `account_id="acme", tenant_id="produccion"`; las mutaciones,
`request_id` único. Activar/configurar/desactivar llevan `reason` y admiten
`draft_revision_number`: presente acumula en borrador; ausente publica y devuelve
`revision_number`. Un borrador no activa nada hasta `PublishDraft`. Los identificadores
y las revisiones de los ejemplos son ficticios; `uint64` se representa como cadena
en ProtoJSON. Las referencias cruzadas son IDs, sin imports entre paquetes nuevos.

## Cuatro recorridos de RPC

1. **Portátil de Ana → db-paris:5432, red.** `IdentitiesService.ListIdentities`
   (portátil y servidor) → `PermissionsService.CheckAccess` (falta permiso) →
   `CreatePermission` (nodo portátil → nodo db-paris, TCP 5432, red; aviso de publicar
   postgres como carga TCP) → `GetRevision` (ambos nodos) → `EventsService.Subscribe`
   con `filter.types=[EVENT_TYPE_CHANGE]`. Assignments no interviene; véase
   [Events](../../events/v1/README.md).
2. **Adrián → jira-produccion, aplicación y MFA.** `WorkloadsService.CreateWorkload`
   (HTTPS) → `PermissionsService.CreatePermission` (persona → carga, MFA) → login
   con `MfaService.BeginPasskeyAssertion`/`FinishPasskeyAssertion` →
   `WorkloadsService.ListSessions` → `EventsService.ListEvents` con
   `filter.types=[EVENT_TYPE_CONNECTION]`. Assignments no interviene.
3. **api-madrid → postgres, red.** `IdentitiesService.ListIdentities` →
   `PermissionsService.CreatePermission` (nodo api-madrid → db-paris:5432) →
   `CheckAccess` (sí; permiso, capa y mecanismo) → `GetRevision` →
   `EventsService.ListEvents` con `filter.author.identity_id="node-api-madrid"`.
   El plazo de inactividad humano no corta al nodo. Assignments no interviene.
4. **Revisión de tráfico → recomendaciones y acciones.** Cada llamada sin prefijo
   es de `AssignmentsService`; recorrido objetivo, con límites de versión abajo:
   - `ListCatalogEntries(page_size=20)` → `GetCatalogEntry(catalog_id="traffic-review",
     catalog_version="1")` → `ActivateAssignment(catalog_id="traffic-review",
     catalog_version="1", active_triggers=[{type:ASSIGNMENT_TRIGGER_TYPE_MANUAL}],
     reason="Revisar tráfico", request_id="activate-1")` devuelve
     `instance.instance_id="review-1", instance.identity_id="sa-review-1"` y revisión;
     `IdentitiesService.GetIdentity` consulta esa cuenta. El catálogo es ilustrativo:
     la primera versión ofrece un único assignment de revisión del tenant.
   - `ConfigureAssignmentInstance(instance_id="review-1", responsible_identity_id="person-ana",
     active_triggers=[{type:ASSIGNMENT_TRIGGER_TYPE_MANUAL},{type:ASSIGNMENT_TRIGGER_TYPE_CRON,
     cron_expression:"0 3 * * *",time_zone:"Europe/Madrid"}], reason="Revisión diaria",
     request_id="configure-1")` sustituye toda la configuración; admite
     `change_limit.max_changes_per_run=12` o un tope por periodo.
   - `GetAssignmentMetrics(instance_id="review-1")` devuelve `global.sample_count`,
     `global.accuracy_ratio` y `by_traffic_type`. Después, `PermissionsService.CreatePermission`
     concede a `sa-review-1` las acciones `proxy.block_ip` o `identities.quarantine`.
   - Un admin llama `TriggerAssignmentRun(instance_id="review-1",request_id="trigger-1")`
     y recibe `run.run_id="run-1"`; cron lo despacha desde el plano de control.
     Runtime: `StartAssignmentRun(run_id="run-1",request_id="start-1")` →
     `AppendAssignmentStep(run_id="run-1",step={step_id:"step-1",occurred_at:"2026-11-08T03:00:00Z",
     observed_resources:[{resource_type:"workload",resource_id:"jira-produccion"}],
     observation:"Tráfico observado",decision:"Recomendar revisión"},request_id="step-1")` →
     `RecordAssignmentFinding(run_id="run-1",finding={step_id:"step-1",kind:"traffic",
     fingerprint:"jira-traffic-1",evidence:[{resource:{resource_type:"workload",
     resource_id:"jira-produccion"}}]},request_id="finding-1")`.
   - `PermissionsService.CheckAccess` por acción: permitida → API del recurso →
     `RecordAssignmentChange(run_id="run-1",change={step_id:"step-1",action:{platform_action:
     "identities.quarantine"},effect:{effect_type:"identity_quarantine",effect_id:"quarantine-1",
     resource:{resource_type:"identity",resource_id:"person-ana"}}},request_id="change-1")`;
     no permitida o tope alcanzado → `RecordAssignmentRecommendation` con
     `recommendation.step_id`, `action.platform_action`, `action.rpc_method` y
     `action.request_json` (campos reales del RPC, sin credenciales ni ámbito).
     `FinishAssignmentRun(run_id="run-1",result=ASSIGNMENT_RUN_RESULT_COMPLETED,
     request_id="finish-1")`; al alcanzar el tope usa
     `ASSIGNMENT_RUN_RESULT_CHANGE_LIMIT_REACHED`.
   - Responsable: `GetAssignmentRun(run_id="run-1")` → `AcceptRecommendation(run_id="run-1",
     recommendation_id="rec-1",reason="Preparar permiso",request_id="accept-1")`
     abre `draft_revision_number` con `author_identity_id` humano y origen run/paso;
     revisa en el creador y publica con `PermissionsService.PublishDraft`.
     Para un cambio individual, `RevertAssignmentChange(run_id="run-1",change_id="change-1",
     reason="Falso positivo",request_id="revert-1")` crea una revisión inversa o
     levanta el efecto: cuarentena usa `IdentitiesService.ReleaseIdentityQuarantine`.
     `EventsService.ListEvents` filtra el run/paso, sin borrar historia.

**Primera versión:** manual/cron, pasos, hallazgos, recomendaciones, borrador humano y
eventos. Quedan fuera cambios automáticos, permisos sobre acciones de assignments,
rollback, métricas, topes y protección; webhook/alerta son valores futuros de enum,
rechazados al configurar. `proxy.block_ip` está nombrada pero no tiene RPC ejecutor.
El runtime `/system/assignments` escribe únicamente por x-api con mTLS y token corto
de instancia ligado a su SVID. Solo admins disparan manualmente. La narrativa es
texto no confiable; x-api valida evidencias, propuestas, permisos y objetos protegidos.
D7 cuenta cambios aplicados: no revertidos = aciertos, revertidos = errores; las
recomendaciones ignoradas no cuentan, cero muestras deja el ratio ausente.
