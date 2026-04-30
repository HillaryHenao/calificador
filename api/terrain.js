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

// tension_level viene como número string sin unidad (ej: '13.8', '34.5')
function mapTension(raw) {
  if (!raw) return null;
  const kv = parseFloat(raw);
  if (isNaN(kv)) return null;
  if (kv >= 34)  return { score: '1',   label: `${raw} kV` };
  if (kv >= 10)  return { score: '0.7', label: `${raw} kV` };
  return null;
}

function dbConfig(name) {
  return {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: name,
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
    ssl:      { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    query_timeout:           8000,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Parámetro code requerido' });

  const main = new Client(dbConfig(process.env.DB_NAME));
  const reqs = new Client(dbConfig(process.env.DB2_NAME));

  try {
    await main.connect();

    // Datos del terreno y su proyecto más reciente
    const { rows } = await main.query(`
      SELECT
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

    // Tensión desde requestsdb usando el project_id
    let tension = null;
    if (row.project_id) {
      try {
        await reqs.connect();
        const { rows: tRows } = await reqs.query(`
          SELECT tension_level FROM supplies_supplyrequest
          WHERE project = $1 AND tension_level IS NOT NULL
          ORDER BY id DESC LIMIT 1
        `, [row.project_id]);
        if (tRows.length > 0) tension = mapTension(tRows[0].tension_level);
      } catch (_) {
        // requestsdb no disponible — continúa sin tensión
      }
    }

    return res.status(200).json({
      codigo:                row.codigo,
      produccion_especifica: row.produccion_especifica ?? null,
      distancia_via:         row.distancia_via         ?? null,
      distancia_red:         row.distancia_red         ?? null,
      operador: orKey ? (OR_MAP[orKey] || { score: '0.1', label: orKey.toUpperCase() }) : null,
      tension,
    });

  } catch (err) {
    console.error('DB error:', err.message);
    return res.status(500).json({ error: 'Error de BD: ' + err.message });
  } finally {
    await main.end().catch(() => {});
    await reqs.end().catch(() => {});
  }
};
