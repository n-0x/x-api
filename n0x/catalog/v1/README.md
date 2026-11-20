# Catalogo v1

Clasifica cada RPC de los servicios expuestos al asistente con la opcion de metodo
`(n0x.catalog.v1.operation)`, que vive junto al RPC en su `.proto`. No hay artefacto de
catalogo aparte: los descriptores generados de x-api-go y x-api-ts la llevan.

| Tipo | Que hace `call` |
| --- | --- |
| `OPERATION_KIND_READ` | Ejecuta con el token delegado del usuario. No cambia estado. |
| `OPERATION_KIND_GOVERNED` | Anota el cambio en la propuesta de la conversacion; nunca lo ejecuta. La peticion acepta `draft_revision_number`. |
| `OPERATION_KIND_EFFECT` | Anota una tarjeta pendiente de confirmar; nunca la ejecuta. Cambia estado sin borrador. |
| `OPERATION_KIND_PERSON_ONLY` | No aparece en `search`; `call` la rechaza. Solo una persona, desde la consola. |
| `OPERATION_KIND_EXCLUDED` | No aparece en `search`; `call` la rechaza. Fuera del asistente. |

## Leer la opcion

- Go: `proto.HasExtension(md.Options(), catalogv1.E_Operation)` y
  `proto.GetExtension(md.Options(), catalogv1.E_Operation).(*catalogv1.Operation)`.
- TS: `hasOption(method, operation)` y `getOption(method, operation)` de `@bufbuild/protobuf`;
  `operation` y `OperationKind` salen de `n0x/catalog/v1/catalog_pb.js`.

## Ausencia

Un metodo sin la opcion, o con `kind` UNSPECIFIED, es EXCLUDED. Nunca se trata como READ y
nunca se infiere el tipo por el nombre del metodo. En TS, `getOption` sin opcion devuelve
`kind` 0 sin error: comprobar antes con `hasOption`.

## Descriptores sin comentarios

Los descriptores generados no llevan los comentarios del `.proto`. Para `search`, el
`summary` y los nombres de campo son lo unico disponible: `summary` debe bastar para
entender la operacion.

## Servicios expuestos

La lista es la constante de `scripts/check-catalog.mjs`. Exponer un servicio nuevo exige
anadirlo ahi y anotar todos sus RPC; CI falla si falta una opcion o si un servicio fuera de
la lista la lleva.

Las reglas sobre `summary`, `permission` y los campos secretos estan en los comentarios de
[`catalog.proto`](catalog.proto).
