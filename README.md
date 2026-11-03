# x-api: contratos Protobuf

`n-0x/x-api` es la única fuente de los contratos propios. Los `.proto` viven en
`n0x/<dominio>/v1/`, con paquete `n0x.<dominio>.v1`. Los consumidores no generan
código: usan tags de [x-api-go](https://github.com/n-0x/x-api-go) o
[x-api-ts](https://github.com/n-0x/x-api-ts).

Go usa `github.com/n-0x/x-api-go/<dominio>/v1`; el dominio `internal` conserva
`internalapi/v1` para permitir imports desde otros módulos. JavaScript y sus
declaraciones TypeScript se generan bajo `n0x/` con `target=js+dts,import_extension=js` (imports ESM explícitos).

## Cambiar y comprobar contratos

1. Editar los `.proto`, conservando números de campo, paquetes y rutas de servicio.
2. Ejecutar `scripts/gen.sh go /tmp/x-api-go` y `scripts/gen.sh ts /tmp/x-api-ts`.
   Se necesitan Go 1.26 o posterior, Node.js y npm. Los plugins Go se verifican por
   metadatos de compilación en `.tools/` (`N0X_PROTO_TOOLS` permite otro caché);
   npm instala el árbol bloqueado en `package-lock.json` con `npm ci`.
3. CI ejecuta `buf lint` (`STANDARD`), generación, compilación Go y `tsc --noEmit`.
   `buf breaking` usa `WIRE_JSON` contra el último tag `vX.Y.Z`; solo se omite
   cuando todavía no hay tags de release.

Pins: buf v1.70.0, protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.5.1,
protoc-gen-connect-go (`connect/v2`) v2.0.2 y protoc-gen-es 2.16.0.
`buf.gen.yaml` describe ambos destinos; `gen.sh` selecciona uno y resuelve sus
rutas. La generación conserva otros archivos del directorio de salida; los
workflows de sync retiran los generados anteriores antes de regenerar.

## Publicar una release

Tras integrar los contratos en `main`, crear y publicar el tag `vX.Y.Z` en esa
rama. Los repos generados consultan el último tag cada 15 minutos; también se
puede solicitar la generación inmediata:

```sh
git switch main
git tag vX.Y.Z
git push origin vX.Y.Z
gh workflow run sync.yml -R n-0x/x-api-go -f tag=vX.Y.Z
gh workflow run sync.yml -R n-0x/x-api-ts -f tag=vX.Y.Z
```

Cada workflow lee el tag público de `x-api` sin token, compila su salida y
publica un commit y el mismo tag con el `GITHUB_TOKEN` de su propio repo.
No necesita deploy keys ni permisos de escritura en `x-api`. Si el tag ya
existe en el repo generado, termina sin cambios. Los consumidores suben de
versión mediante su propio PR; para un RPC nuevo, desplegar primero el backend
o tratar `Unimplemented` como no disponible.

## Semántica de los contratos

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
