const { Client } = require('pg');

const OR_MAP = {
  afinia:         { score: '1',   label: 'Afinia / ESSA / EPM' },
  essa:           { score: '1',   label: 'Afinia / ESSA / EPM' },
  epm:            { score: '1',   label: 'Afinia / ESSA / EPM' },
  enel:           { score: '0.9', label: 'ENEL' },
  cens:           { score: '0.8', label: 'CENS' },
  celsia:         { score: '0.7', label: 'CELSIA' },
  aire:           { score: '0.6', label: 'Aire / EBSA' },
  ebsa:           { score: '0.6', label: 'Aire / EBSA' },
  chec:           { score: '0.5', label: 'CHEC' },
  edeq:           { score: '0.5', label: 'EDEQ' },
  emcali:         { score: '0.4', label: 'EMCALI' },
  enelar:         { score: '0.3', label: 'ENELAR' },
  cedenar:        { score: '0.3', label: 'CEDENAR' },
  enerca:         { score: '0.3', label: 'ENERCA' },
  electrohuila:   { score: '0.2', label: 'Electrohuila' },
  emsa:           { score: '0.2', label: 'EMSA' },
  energuaviare:   { score: '0.2', label: 'Energuaviare' },
  eep:            { score: '0.2', label: 'EEP' },
  cetsa:          { score: '0.1', label: 'CETSA' },
};

const ADECUACION_MAP = {
  'Óptimo':    '1',
  'Muy bueno': '0.8',
  'Aceptable': '0.6',
  'Deficiente':'0.3',
  'Crítico':   '0',
};

const INUNDACION_MAP = {
  'Bajo':    '1',
  'Moderado':'0.6',
  'Alto':    '0.3',
  'Crítico': '0',
};

const CAUCE_MAP = {
  'No Requiere': '1',
  'Requiere':    '0',
};

const OFFTAKER_MAP = {
  epm:          { score: '1',   label: 'EPM / ISA' },
  isa:          { score: '1',   label: 'EPM / ISA' },
  enel:         { score: '0.9', label: 'CELSIA / ENEL' },
  celsia:       { score: '0.9', label: 'CELSIA / ENEL' },
  essa:         { score: '0.8', label: 'ESSA' },
  cens:         { score: '0.7', label: 'CENS / CHEC' },
  chec:         { score: '0.7', label: 'CENS / CHEC' },
  afinia:       { score: '0.6', label: 'AFINIA / EBSA' },
  ebsa:         { score: '0.6', label: 'AFINIA / EBSA' },
  cedenar:      { score: '0.5', label: 'CEDENAR / EMSA' },
  emsa:         { score: '0.5', label: 'CEDENAR / EMSA' },
  emcali:       { score: '0.4', label: 'DISPAC / EMCALI' },
  dispac:       { score: '0.4', label: 'DISPAC / EMCALI' },
  aire:         { score: '0.3', label: 'AIRE' },
};

const SERVIDUMBRE_MAP = {
  'Propia':         '1',
  'Pública':        '0.5',
  'Ajena':          '0.2',
  'Pública y ajena':'0',
};

const CAR_MAP = {
  // Score 0.9
  'CORPOCESAR':  '0.9', 'CORTOLIMA': '0.9', 'CORPAMAG':  '0.9',
  'CARDIQUE':    '0.9', 'CAR':       '0.9', 'Carder':    '0.9', 'CARDER': '0.9',
  // Score 0.8
  'Corpoboyaca': '0.8', 'CORPOBOYACA': '0.8',
  // Score 0.6
  'CAS': '0.6', 'CSB': '0.6', 'CVS': '0.6', 'CAM': '0.6',
};

const ESTRUCTURA_MAP = {
  '1P':         '1',
  '2P':         '1',
  'Mesa fija':  '0',
};

function mapTension(raw) {
  if (!raw) return null;
  const kv = parseFloat(raw);
  if (isNaN(kv)) return null;
  if (kv >= 34) return { score: '1',   label: `${raw} kV` };
  if (kv >= 10) return { score: '0.7', label: `${raw} kV` };
  return null;
}

function makeClient(dbName) {
  return new Client({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: dbName,
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
    ssl:      { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    query_timeout:           8000,
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Parámetro code requerido' });

  const main = makeClient(process.env.DB_NAME);

  try {
    await main.connect();

    const { rows } = await main.query(`
      SELECT
        t.id               AS terrain_id,
        t.name             AS codigo,
        t.radiation        AS produccion_especifica,
        p.id               AS project_id,
        p.road_distance    AS distancia_via,
        p.network_distance AS distancia_red,
        p.grid_operator_id AS operador_raw
      FROM termsheet_terrain t
      LEFT JOIN minifarm_project p ON p.terrain_id = t.id
      WHERE UPPER(t.name) = $1
      ORDER BY p.id DESC NULLS LAST
      LIMIT 1
    `, [code]);

    if (rows.length === 0) {
      return res.status(404).json({ error: `Terreno "${code}" no encontrado` });
    }

    const row = rows[0];
    const orKey = (row.operador_raw || '').toLowerCase().trim();

    // Campos civiles desde validation_field
    let adecuacion = null, inundacion = null, cauce = null, servidumbre = null, estructura = null, forestal = null, demanda = null;
    if (row.terrain_id) {
      const { rows: civiles } = await main.query(`
        SELECT DISTINCT ON (name) name, value, status
        FROM validation_field
        WHERE (
          project_id IN (SELECT id FROM minifarm_project WHERE terrain_id = $1)
          OR terrain_id = $1
        )
          AND name IN ('Adecuación del terreno', 'Riesgo de inundación', 'Ocupación de cauce',
                       'Servidumbre', 'Tipo de arreglo', 'Número de árboles', 'CAR')
          AND (
            (value IS NOT NULL AND value != 'Pendiente')
            OR (name = 'Ocupación de cauce' AND status = 'exonerated')
          )
        ORDER BY name,
          CASE status WHEN 'approved' THEN 1 WHEN 'exonerated' THEN 1 WHEN 'preapproved' THEN 2 ELSE 3 END,
          id DESC
      `, [row.terrain_id]);

      const fieldMap = Object.fromEntries(civiles.map(c => {
        if (c.name === 'Ocupación de cauce' && c.value == null && c.status === 'exonerated')
          return [c.name, 'No Requiere'];
        return [c.name, c.value];
      }));

      // Detectar campos con registros en BD pero sin valor válido → pending
      const CIVIL_FIELD_NAMES = [
        'Adecuación del terreno', 'Riesgo de inundación', 'Ocupación de cauce',
        'Servidumbre', 'Tipo de arreglo', 'Número de árboles',
      ];
      const missingFields = CIVIL_FIELD_NAMES.filter(f => fieldMap[f] == null);
      const pendingFields = new Set();
      if (missingFields.length > 0) {
        const { rows: pRows } = await main.query(`
          SELECT DISTINCT name FROM validation_field
          WHERE (project_id IN (SELECT id FROM minifarm_project WHERE terrain_id = $1) OR terrain_id = $1)
            AND name = ANY($2)
        `, [row.terrain_id, missingFields]);
        pRows.forEach(r => pendingFields.add(r.name));
      }

      if (fieldMap['Adecuación del terreno'] && ADECUACION_MAP[fieldMap['Adecuación del terreno']] != null)
        adecuacion = { score: ADECUACION_MAP[fieldMap['Adecuación del terreno']], label: fieldMap['Adecuación del terreno'] };
      else if (pendingFields.has('Adecuación del terreno'))
        adecuacion = { pending: true };

      if (fieldMap['Riesgo de inundación'] && INUNDACION_MAP[fieldMap['Riesgo de inundación']] != null)
        inundacion = { score: INUNDACION_MAP[fieldMap['Riesgo de inundación']], label: fieldMap['Riesgo de inundación'] };
      else if (pendingFields.has('Riesgo de inundación'))
        inundacion = { pending: true };

      if (fieldMap['Ocupación de cauce'] && CAUCE_MAP[fieldMap['Ocupación de cauce']] != null)
        cauce = { score: CAUCE_MAP[fieldMap['Ocupación de cauce']], label: fieldMap['Ocupación de cauce'] };
      else if (pendingFields.has('Ocupación de cauce'))
        cauce = { pending: true };

      if (fieldMap['Servidumbre'] && SERVIDUMBRE_MAP[fieldMap['Servidumbre']] != null)
        servidumbre = { score: SERVIDUMBRE_MAP[fieldMap['Servidumbre']], label: fieldMap['Servidumbre'] };
      else if (pendingFields.has('Servidumbre'))
        servidumbre = { pending: true };

      if (fieldMap['Tipo de arreglo'] && ESTRUCTURA_MAP[fieldMap['Tipo de arreglo']] != null)
        estructura = { score: ESTRUCTURA_MAP[fieldMap['Tipo de arreglo']], label: fieldMap['Tipo de arreglo'] };
      else if (pendingFields.has('Tipo de arreglo'))
        estructura = { pending: true };

      // Forestal: 0 árboles → Exonerado (1), con árboles → score según CAR
      // Capacidad de red (demanda) — puede tener valor o estar pendiente
      const { rows: demandaRows } = await main.query(`
        SELECT value FROM validation_field
        WHERE (project_id IN (SELECT id FROM minifarm_project WHERE terrain_id = $1) OR terrain_id = $1)
          AND name = 'Capacidad de red'
        ORDER BY CASE WHEN value IS NOT NULL THEN 0 ELSE 1 END, id DESC
        LIMIT 1
      `, [row.terrain_id]);
      demanda = demandaRows.length === 0
        ? null
        : demandaRows[0].value != null
          ? { value: parseFloat(demandaRows[0].value) }
          : { value: null, pending: true };

      const arboles = fieldMap['Número de árboles'];
      if (arboles != null) {
        if (parseFloat(arboles) === 0) {
          forestal = { score: '1', label: 'Exonerado' };
        } else {
          const carVal = (fieldMap['CAR'] || '').trim();
          const carScore = CAR_MAP[carVal] || '0.1';
          const carLabel = carVal || 'Otras corporaciones';
          forestal = { score: carScore, label: carLabel };
        }
      } else if (pendingFields.has('Número de árboles')) {
        forestal = { pending: true };
      }
    }

    // Tensión y coexistencias desde requestsdb
    let tension = null, coexistencias = null;
    if (row.terrain_id && process.env.DB2_NAME) {
      const reqs = makeClient(process.env.DB2_NAME);
      try {
        await reqs.connect();

        // Todos los project_ids del terreno para buscar en requestsdb
        const { rows: allProjects } = await main.query(
          `SELECT id FROM minifarm_project WHERE terrain_id = $1`, [row.terrain_id]
        );
        const projectIds = allProjects.map(p => String(p.id));

        // Tensión
        if (row.project_id) {
          const { rows: tRows } = await reqs.query(`
            SELECT tension_level FROM supplies_supplyrequest
            WHERE project = $1 AND tension_level IS NOT NULL
            ORDER BY id DESC LIMIT 1
          `, [row.project_id]);
          if (tRows.length > 0) tension = mapTension(tRows[0].tension_level);
        }

        // Coexistencias
        if (projectIds.length) {
          const { rows: cRows } = await reqs.query(`
            SELECT id FROM entities_coexistence
            WHERE project_id = ANY($1)
            LIMIT 1
          `, [projectIds]);
          coexistencias = cRows.length === 0
            ? { score: '1', label: 'No tiene' }
            : { has: true }; // tiene coexistencias — usuario elige buena/mala empresa
        }

      } catch (_) {
        // requestsdb no disponible — continúa sin estos datos
      } finally {
        await reqs.end().catch(() => {});
      }
    }

    return res.status(200).json({
      codigo:                row.codigo,
      produccion_especifica: row.produccion_especifica ?? null,
      distancia_via:         row.distancia_via         ?? null,
      distancia_red:         row.distancia_red         ?? null,
      operador:   orKey ? (OR_MAP[orKey]      || { score: '0.1', label: orKey.toUpperCase() }) : null,
      offtaker:   orKey ? (OFFTAKER_MAP[orKey] || { score: '0.2', label: 'Otro' })            : null,
      tension,
      adecuacion,
      inundacion,
      cauce,
      coexistencias,
      servidumbre,
      estructura,
      forestal,
      demanda,
    });

  } catch (err) {
    console.error('DB error:', err.message);
    return res.status(500).json({ error: 'Error de BD: ' + err.message });
  } finally {
    await main.end().catch(() => {});
  }
};
