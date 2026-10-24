# Contratos Protobuf

La fuente de los contratos propios es `n0x/<dominio>/v1/*.proto`, con paquete
`n0x.<dominio>.v1`. Go se genera en `pkg/api/<dominio>/v1` y TypeScript en
`frontend/src/gen`; el dominio `internal` usa el directorio Go `internalapi` para
no activar la restricción de imports `internal` de Go. Ambos generados se versionan.

| Dominio | Contratos |
| --- | --- |
| `control` | Plano de control gRPC con mTLS SPIFFE |
| `manager`, `authority` | APIs de sesión, cuenta, recursos e IAM por Connect |
| `internal` | Catálogo, membresías, asignación, provisión y contraseña por Connect |
| `connectivity`, `mesh` | CZ, relay y frames de la malla; estado HTTP por Connect |
| `signed`, `auth` | Documentos firmados, assignment proof y human access |
| `files` | Configuración, bootstrap, trust y health entre procesos |

## Añadir o cambiar un contrato

1. Editar el `.proto` del dominio; no editar los generados ni añadir un struct
   Go/TS paralelo para el wire. Conservar números y nombres de campos compatibles.
2. Mantener los modelos de dominio y persistencia (incluidos tags BSON) como tipos
   Go internos. Convertir a proto en el borde: server, client o firma. Probar cada
   conversión con un control de campos sin mapear en ambas direcciones.
3. Ejecutar `make proto` (requiere Go, buf y npm) y versionar fuente y generados.
   `make proto` repetido debe dejar los generados sin cambios.
4. Ejecutar `make check`: formato buf, lint, deriva de generación y
   `buf breaking --against '.git#branch=dev,subdir=api'` cuando `dev` contiene el
   módulo buf. El gate es de compatibilidad wire/JSON (`WIRE_JSON`);
   `make check-full` añade la integración antes de deploy.

Las APIs HTTP propias usan Connect: `POST /api/<servicio>/<método>`, con nombre de
servicio completo, `Content-Type: application/json` y `Connect-Protocol-Version: 1`
para Python/shell sin codegen. El navegador usa connect-web y protobuf-es; el plano
de control conserva grpc-go. Sesiones, cookies, CSRF y mTLS conservan sus controles.

Los JWS v2 llevan payload proto binario y `cty: application/x-protobuf`.
Lo firmado o hasheado conserva sus bytes: `ConfigEnvelope.document` se hashea con
SHA-256 sin volver a serializar. Los hashes de idempotencia usan marshal proto
determinista. Los frames de malla llevan prefijo uvarint (`protodelim`).

Los ficheros `.json` propios se emiten con protojson y `UseProtoNames` y se leen
con `DiscardUnknown: false`. Para lectores Python/shell/JS, los `int64`/`uint64` salen
como cadenas decimales; los contadores/versiones también son cadenas. Los números
JSON se reservan a tipos acotados (por ejemplo `int32`) y los timestamps conservan
su representación declarada. No convertir una cadena de 64 bits a un Number de
JavaScript: perdería precisión por encima de 2^53−1.

## Excepciones

[ADR 0010](../docs/adr/0010-protobuf-contracts.md) conserva los formatos ajenos:
Stripe, Google OIDC, Cloudflare Access, Workload API de SPIRE y `spire-agent.conf`;
también `/downloads/*`, el tar de `POST /api/v1/enrollment/redeem` (su `client.json`
sí es protojson), IPv4 del overlay, frames de datos del relay y binding de 32 bytes,
stdout de overlayd y JSONL de privateevidence. Los redirects/callbacks de login y
el consentimiento HTML conservan HTTP. `pkg/strictjson` solo valida el JSON de
las excepciones, la CLI admin, Redis y evidencia; no canonicaliza ni define el wire.
