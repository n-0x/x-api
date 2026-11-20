// Comprueba la opcion (n0x.catalog.v1.operation) sobre la imagen de buf
// (`buf build -o image.json`). Solo usa modulos node:.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OPTION = '[n0x.catalog.v1.operation]';
const KINDS = ['READ', 'GOVERNED', 'EFFECT', 'PERSON_ONLY', 'EXCLUDED'];
const VISIBLE = ['READ', 'GOVERNED', 'EFFECT'];

// Servicios que ve el asistente. Exponer uno nuevo exige tocar esta lista.
export const EXPOSED_SERVICES = [
  'n0x.identities.v1.IdentitiesService',
  'n0x.permissions.v1.PermissionsService',
  'n0x.workloads.v1.WorkloadsService',
  'n0x.assignments.v1.AssignmentsService',
  'n0x.events.v1.EventsService',
  'n0x.metrics.v1.MetricsService',
  'n0x.alerts.v1.AlertService',
  'n0x.tasks.v1.TasksService',
  'n0x.authority.v1.ResourceService',
];

const SUMMARY_MAX = 160;
const SUMMARY_SHAPE = /^[A-Z][\x20-\x7E]*\.$/;
const PERMISSION_SHAPE = /^[a-z]+\.[a-z_]+$/;
const SECRET_FIELD = /secret|password|private_key|_pem$/;

// Indice `.<package>.<Message>` -> mensaje, incluidos los anidados.
function indexMessages(image) {
  const index = new Map();
  const add = (prefix, msg) => {
    const name = `${prefix}.${msg.name}`;
    index.set(name, msg);
    (msg.nestedType ?? []).forEach((nested) => add(name, nested));
  };
  for (const file of image.file ?? []) {
    (file.messageType ?? []).forEach((msg) => add(`.${file.package}`, msg));
  }
  return index;
}

// Errores de una operacion con tipo visible (READ, GOVERNED, EFFECT).
function checkVisible(op, request) {
  const errors = [];
  const summary = op.summary ?? '';
  if (summary === '') errors.push('summary is empty');
  else {
    if ([...summary].length > SUMMARY_MAX) errors.push(`summary is longer than ${SUMMARY_MAX} characters`);
    if (!SUMMARY_SHAPE.test(summary) || summary.includes('://')) {
      errors.push('summary must be one printable ASCII sentence ending in a period, without URLs');
    }
  }
  if (!PERMISSION_SHAPE.test(op.permission ?? '')) errors.push('permission is missing or malformed');
  const fields = (request?.field ?? []).map((f) => f.name);
  for (const name of fields.filter((n) => SECRET_FIELD.test(n))) {
    errors.push(`request field ${name} carries a secret`);
  }
  if (op.kind === 'OPERATION_KIND_GOVERNED' && !fields.includes('draft_revision_number')) {
    errors.push('GOVERNED request has no draft_revision_number');
  }
  return errors;
}

export function checkCatalog(image) {
  const errors = [];
  const totals = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const messages = indexMessages(image);
  const seen = new Set();

  for (const file of image.file ?? []) {
    for (const service of file.service ?? []) {
      const serviceName = `${file.package}.${service.name}`;
      const exposed = EXPOSED_SERVICES.includes(serviceName);
      if (exposed) seen.add(serviceName);
      for (const method of service.method ?? []) {
        const id = `${serviceName}.${method.name}`;
        const op = method.options?.[OPTION];
        const fail = (msg) => errors.push(`${id}: ${msg}`);
        if (!exposed) {
          if (op) fail('option on a service outside EXPOSED_SERVICES');
          continue;
        }
        if (!op) { fail('missing option'); continue; }
        const kind = (op.kind ?? 'OPERATION_KIND_UNSPECIFIED').replace('OPERATION_KIND_', '');
        if (!KINDS.includes(kind)) { fail('kind is UNSPECIFIED'); continue; }
        totals[kind] += 1;
        if (VISIBLE.includes(kind)) {
          checkVisible(op, messages.get(method.inputType)).forEach(fail);
        } else {
          if ((op.summary ?? '') !== '') fail('summary must be empty for PERSON_ONLY and EXCLUDED');
          if ((op.permission ?? '') !== '' && !PERMISSION_SHAPE.test(op.permission)) {
            fail('permission is missing or malformed');
          }
        }
      }
    }
  }
  for (const name of EXPOSED_SERVICES.filter((s) => !seen.has(s))) {
    errors.push(`${name}: exposed service not found`);
  }
  return { errors, totals };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/check-catalog.mjs <image.json>');
    process.exit(2);
  }
  const { errors, totals } = checkCatalog(JSON.parse(readFileSync(file, 'utf8')));
  for (const kind of KINDS) console.log(`${kind} ${totals[kind]}`);
  console.log(`TOTAL ${KINDS.reduce((sum, k) => sum + totals[k], 0)}`);
  errors.forEach((e) => console.error(e));
  process.exit(errors.length ? 1 : 0);
}
