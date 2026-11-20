import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalog, EXPOSED_SERVICES } from './check-catalog.mjs';

const OPT = '[n0x.catalog.v1.operation]';
const read = { kind: 'OPERATION_KIND_READ', permission: 'nodes.read', summary: 'Get one thing.' };

// Imagen minima: cada servicio expuesto con un metodo Get valido.
function image(edit = () => {}) {
  const file = EXPOSED_SERVICES.map((full) => {
    const pkg = full.slice(0, full.lastIndexOf('.'));
    return {
      name: `${pkg.replaceAll('.', '/')}/x.proto`, package: pkg,
      messageType: [
        { name: 'GetRequest', field: [{ name: 'account_id' }] },
        { name: 'ChangeRequest', field: [{ name: 'draft_revision_number' }] },
      ],
      service: [{ name: full.slice(pkg.length + 1), method: [
        { name: 'Get', inputType: `.${pkg}.GetRequest`, options: { [OPT]: { ...read } } },
      ] }],
    };
  });
  edit(file);
  return { file };
}
const get = (file) => file[0].service[0].method[0];
const ID = 'n0x.identities.v1.IdentitiesService.Get';

test('imagen valida: sin errores y totales por tipo', () => {
  const r = checkCatalog(image());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.totals, { READ: 9, GOVERNED: 0, EFFECT: 0, PERSON_ONLY: 0, EXCLUDED: 0 });
});
test('metodo sin opcion', () => {
  const r = checkCatalog(image((f) => { delete get(f).options; }));
  assert.ok(r.errors.includes(`${ID}: missing option`));
});
test('kind ausente cuenta como UNSPECIFIED', () => {
  const r = checkCatalog(image((f) => { get(f).options[OPT] = { permission: 'nodes.read' }; }));
  assert.ok(r.errors.includes(`${ID}: kind is UNSPECIFIED`));
});
test('summary vacio o de mas de 160 caracteres', () => {
  assert.ok(checkCatalog(image((f) => { get(f).options[OPT].summary = ''; })).errors.includes(`${ID}: summary is empty`));
  const ok = 'A' + 'a'.repeat(158) + '.';
  assert.deepEqual(checkCatalog(image((f) => { get(f).options[OPT].summary = ok; })).errors, []);
  assert.ok(checkCatalog(image((f) => { get(f).options[OPT].summary = 'A' + ok; })).errors
    .includes(`${ID}: summary is longer than 160 characters`));
});
test('summary con URL o salto de linea', () => {
  const msg = `${ID}: summary must be one printable ASCII sentence ending in a period, without URLs`;
  for (const s of ['Get it from https://x.example.', 'Get it.\nThen act.', 'get one thing.', 'Get one thing'])
    assert.ok(checkCatalog(image((f) => { get(f).options[OPT].summary = s; })).errors.includes(msg), s);
});
test('permiso ausente o mal formado en operacion visible', () => {
  for (const p of ['', 'nodes', 'Nodes.Read'])
    assert.ok(checkCatalog(image((f) => { get(f).options[OPT].permission = p; })).errors
      .includes(`${ID}: permission is missing or malformed`), p);
});
test('GOVERNED exige draft_revision_number en la peticion', () => {
  const gov = { kind: 'OPERATION_KIND_GOVERNED', permission: 'iam.write', summary: 'Change one thing.' };
  assert.ok(checkCatalog(image((f) => { get(f).options[OPT] = gov; })).errors
    .includes(`${ID}: GOVERNED request has no draft_revision_number`));
  assert.deepEqual(checkCatalog(image((f) => {
    get(f).options[OPT] = gov; get(f).inputType = '.n0x.identities.v1.ChangeRequest';
  })).errors, []);
});
test('PERSON_ONLY y EXCLUDED sin summary', () => {
  assert.deepEqual(checkCatalog(image((f) => { get(f).options[OPT] = { kind: 'OPERATION_KIND_PERSON_ONLY' }; })).errors, []);
  assert.ok(checkCatalog(image((f) => { get(f).options[OPT] = { kind: 'OPERATION_KIND_EXCLUDED', summary: 'Do it.' }; })).errors
    .includes(`${ID}: summary must be empty for PERSON_ONLY and EXCLUDED`));
});
test('campo de secreto en operacion visible', () => {
  const r = checkCatalog(image((f) => { f[0].messageType[0].field.push({ name: 'bootstrap_secret' }); }));
  assert.ok(r.errors.includes(`${ID}: request field bootstrap_secret carries a secret`));
  assert.deepEqual(checkCatalog(image((f) => {
    f[0].messageType[0].field.push({ name: 'certificate_signing_request_pem' });
    get(f).options[OPT] = { kind: 'OPERATION_KIND_EXCLUDED' };
  })).errors, []);
});
test('opcion fuera de la lista', () => {
  const r = checkCatalog(image((f) => {
    f.push({ name: 'n0x/tasks/v1/w.proto', package: 'n0x.tasks.v1', messageType: [], service: [{ name: 'TaskWorkerService',
      method: [{ name: 'ClaimStep', inputType: '.n0x.tasks.v1.X', options: { [OPT]: { ...read } } }] }] });
  }));
  assert.ok(r.errors.includes('n0x.tasks.v1.TaskWorkerService.ClaimStep: option on a service outside EXPOSED_SERVICES'));
});
test('servicio expuesto ausente de la imagen', () => {
  const r = checkCatalog(image((f) => { f.shift(); }));
  assert.ok(r.errors.includes('n0x.identities.v1.IdentitiesService: exposed service not found'));
});
test('permiso mal formado en PERSON_ONLY y EXCLUDED', () => {
  for (const kind of ['OPERATION_KIND_PERSON_ONLY', 'OPERATION_KIND_EXCLUDED']) {
    const bad = checkCatalog(image((f) => { get(f).options[OPT] = { kind, permission: 'Not A Permission' }; }));
    assert.ok(bad.errors.includes(`${ID}: permission is missing or malformed`), kind);
    const empty = checkCatalog(image((f) => { get(f).options[OPT] = { kind }; }));
    assert.deepEqual(empty.errors, [], kind);
  }
});
