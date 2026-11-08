# Identidades, MFA y ajustes del tenant

Contrato R1 de `n0x.identities.v1.IdentitiesService`, con enmiendas aditivas en
`n0x.auth.v1.MfaService` y `n0x.authority.v1.TenantService` (bloque 2, bloque 5 y
ADR 0025). Son contratos, sin servidores ni clientes.

Toda request nueva empieza por `account_id`, `tenant_id`. Las listas usan
`page_token`, `page_size` y devuelven `next_page_token`. Las mutaciones gobernadas
llevan `request_id`, `reason` obligatorio y `draft_revision_number` opcional:
presente acumula sin aplicar; ausente publica. Devuelven `revision_number` del
tenant, gestionado por `PermissionsService`; en JSON los `uint64` son cadenas.

`Identity` contiene `identity_id`, `type` (persona, nodo, cuenta de servicio o
grupo), `state` (activa, caducada, en cuarentena, dada de baja), nombre,
descripción y último `revision_number` gobernado. Persona: `person.login` de
n-0x. Nodo: `node.incarnation_id` opcional enlaza al inventario actual y
`address_v4/v6` son de salida; no hay vínculo persona–portátil. Cuenta de
servicio: `responsible_identity_id` debe identificar una persona del tenant;
`expires_at` es opcional y `expiration_notice` configura el aviso, cuyo instante
sale como `expiration_warning_at`. `UpdateIdentity` cambia responsable y
caducidad; `clear_expiration=true` la elimina. `Group` contiene `identity`,
`group_id` (igual a `identity.identity_id`) y `member_identity_ids` mezclados,
sin anidamiento. `CreateGroup`/`AddGroupMembers`/`RemoveGroupMembers`/`DeleteGroup`
son revisión; en red solo participan nodos. La baja conserva historial y es
terminal. Offline es conectividad, no un estado de identidad.

`SetIdentityProtection.protection` reemplaza las marcas `against_blocking` y
`against_deletion`, que ningún assignment puede saltarse. `QuarantineIdentity`
requiere la acción `identities.quarantine` y `reason`; registra
`quarantine.author_identity_id` del llamante autenticado y `quarantined_at`.
`ReleaseIdentityQuarantine` solo admite humanos y recupera el estado efectivo,
incluida la caducidad. Ninguna de las dos crea revisión ni acepta borrador; el
plano de aplicación propaga el corte de conexiones. Para grupos se usa su
`group_id` como `identity_id`; se suspende su concesión colectiva, sin cambiar
el estado ni los permisos independientes de cada miembro.

Alta: `CreatePerson`; o `CreateServiceAccount`/`CreateNodeEnrollment` →
`ExchangeBootstrapSecret(identity_id, bootstrap_secret, certificate_signing_request_pem)`.
Ambas altas devuelven `bootstrap_secret` una sola vez, nunca en lecturas ni
reintentos; solo se guarda su hash. En borrador no sirve hasta publicar y se
invalida al descartar. El canje consume el secreto y devuelve
`IdentityCredentials` con cadena X.509, bundle, `spiffe_id`, `expires_at` y
`renew_after`; la clave privada queda en el cliente. El RPC adicional
`RenewIdentityCredentials` cumple ADR 0025 D6/D7: mTLS vigente más CSR permiten
rotar sin agente SPIRE separado, sin secreto reutilizable y sin cortar tráfico.
Al volver offline con SVID vencido, el nodo debe reatestarse automáticamente
con SPIRE usando su estado de enrollment persistido, obtener SVID vigente y
renovar sin intervención ni repetir el secreto (D6); la reatestación del emisor
queda fuera de este servicio. Si ese estado se pierde o resulta inutilizable,
un admin humano con MFA reciente usa `ReissueBootstrapSecret(identity_id, reason)` →
`ExchangeBootstrapSecret` con CSR nuevo (D6/D10); invalida secretos pendientes,
conserva identidad y permisos y no es revisión. Es también la recuperación
administrativa de una cuenta de servicio. No elude cuarentena, baja ni
caducidad programada de la cuenta: esta última requiere antes `UpdateIdentity`.

Tenant: `CreateTenantRequest.addressing_v4` admite CIDR privado, por defecto
`10.2.0.0/16`; `addressing_v6` admite ULA, por defecto `/48` generado por tenant.
`cidr` conserva número y significado como alias v4: valores contradictorios se
rechazan y las respuestas igualan ambos campos; tenants existentes conservan su
rango. `inactivity_timeouts.person/node/service_account` son `Duration`:
por defecto 30 minutos/0/0; cero desactiva caducidad por inactividad.
`UpdateTenantSettings` cambia campos presentes, con motivo, borrador opcional
y revisión devuelta. `CreateTenant` conserva su request legado y añade `reason`
opcional; la revisión inicial se lee en `tenant.revision_number`.

Los cuatro casos comunes, siempre en el mismo ámbito cuenta/tenant:

1. **Portátil de ana → postgres en db-paris:5432.**
   `ListIdentities(type=NODE)` → `PermissionsService.CheckAccess` (falta permiso)
   → `CreatePermission` (sujeto `identity_id` portátil, objeto `identity_id`
   db-paris, TCP/5432, red; aviso para publicar postgres como carga TCP) →
   `GetRevision` (ambos nodos) → `EventsService.Subscribe` (publicada/aplicada).
2. **Adrián → jira-produccion con MFA.**
   `WorkloadsService.CreateWorkload` (HTTPS) → `PermissionsService.CreatePermission`
   (persona, carga, condición MFA) → login n-0x.com →
   `MfaService.BeginPasskeyAssertion(identity_id, session_id)` →
   `FinishPasskeyAssertion(challenge_id, credential_json)` →
   `WorkloadsService.ListSessions` → `EventsService.ListEvents`.
   El alta de passkey usa `BeginPasskeyRegistration`/`FinishPasskeyRegistration`;
   los options y la respuesta WebAuthn son JSON UTF-8 en campos `bytes`.
   Respaldo: `EnrollTotp` (URI una vez) → `ConfirmTotp(code)` → `VerifyTotp(code)`;
   `ListAuthenticators` solo muestra metadatos; `RemoveAuthenticator` exige motivo.
   La verificación devuelve `SlidingSession.mfa_at`. `SessionActivity` y
   `SessionRenewal` expresan renovación por actividad observada por el servidor:
   `last_activity_at + inactivity_timeout = idle_expires_at`, sin máximo absoluto
   corto. Renovar no refresca `mfa_at` ni revive sesiones caducadas.
3. **api-madrid → postgres.**
   `ListIdentities(type=NODE)` → `PermissionsService.CreatePermission` como en 1
   → `CheckAccess` (sí, permiso, capa, mecanismo) → `GetRevision` →
   `EventsService.Subscribe`. `Tenant.inactivity_timeouts.node=0` no corta al
   nodo; la renovación de certificados tampoco interrumpe conexiones activas.
4. **Assignment de tráfico → acciones.**
   `AssignmentsService.ListCatalogEntries` → `ActivateAssignment` →
   `GetIdentity(identity_id de su cuenta de servicio)` verifica responsable →
   `GetAssignmentMetrics` → `PermissionsService.CreatePermission` (cuenta,
   `proxy.block_ip`/`identities.quarantine`) → `TriggerAssignmentRun` → runtime
   `StartAssignmentRun` → `AppendAssignmentStep` → `CheckAccess` por acción →
   `RecordAssignmentChange` si permitida o `RecordAssignmentRecommendation` si no
   → `FinishAssignmentRun` → responsable `GetAssignmentRun` →
   `RevertAssignmentChange` → `ReleaseIdentityQuarantine(identity_id, reason)`
   → `EventsService.ListEvents`. Es el recorrido objetivo: R1 reserva bloqueo
   de IP y cambios automáticos; la primera versión observa y recomienda.

Permisos/revisiones, cargas/sesiones y assignments/eventos pertenecen a sus
respectivos README de `permissions/v1`, `workloads/v1`, `assignments/v1` y
`events/v1`; este servicio aporta sujetos y ciclo de vida, sin imports cruzados.
