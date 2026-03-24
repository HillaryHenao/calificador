const { Client } = require('pg');

// Map DB operator ID → select score value + display label
const OR_MAP = {
  afinia:      { score: '1',   label: 'Afinia / ESSA / EPM' },
  essa:        { score: '1',   label: 'Afinia / ESSA / EPM' },
  epm:         { score: '1',   label: 'Afinia / ESSA / EPM' },
  enel:        { score: '0.9', label: 'ENEL' },
  cens:        { score: '0.8', label: 'CENS' },
  celsia:      { score: '0.7', label: 'CELSIA' },
  aire:        { score: '0.6', label: 'Aire / EBSA' },
  ebsa:        { score: '0.6', label: 'Aire / EBSA' },
  chec:        { score: '0.5', label: 'CHEC' },
  enelar:      { score: '0.3', label: 'ENELAR' },
  emsa:        { score: '0.2', label: 'EMSA' },
};

const TENSION_MAP = {
  '34.5 kv': { score: '1',   label: '34.5 kV' },
  '13.8 kv': { score: '0.7', label: '13.8 kV' },
  '0':       { score: '0',   label: 'Sin red (0 kV)' },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ error: 'Parámetro code requerido' });
  }

  const client = new Client({
    host:            process.env.DB_HOST,
    port:            parseInt(process.env.DB_PORT || '5432'),
    database:        process.env.DB_NAME,
    user:            process.env.DB_USER,
    password:        process.env.DB_PASS,
    ssl:             { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    query_timeout:           8000,
  });

  try {
    await client.connect();

    const { rows } = await client.query(`
      SELECT
        t.name                  AS codigo,
        t.radiation             AS produccion_especifica,
        p.road_distance         AS distancia_via,
        p.network_distance      AS distancia_red,
        p.grid_operator_id      AS operador_raw,
        gor.tension_level       AS tension_raw
      FROM termsheet_terrain t
      LEFT JOIN minifarm_project p
             ON p.terrain_id = t.id
      LEFT JOIN grid_operator_request_projectgridoperatorrequest pgr
             ON pgr.project_id = p.id
      LEFT JOIN grid_operator_request_gridoperatorrequest gor
             ON gor.id = pgr.request_id
      WHERE UPPER(t.name) = $1
      ORDER BY gor.id DESC NULLS LAST
      LIMIT 1
    `, [code]);

    if (rows.length === 0) {
      return res.status(404).json({ error: `Terreno "${code}" no encontrado` });
    }

    const row = rows[0];
    const orKey      = (row.operador_raw  || '').toLowerCase().trim();
    const tensionKey = (row.tension_raw   || '').toLowerCase().trim();

    return res.status(200).json({
      codigo:                row.codigo,
      produccion_especifica: row.produccion_especifica ?? null,
      distancia_via:         row.distancia_via         ?? null,
      distancia_red:         row.distancia_red         ?? null,
      operador: orKey ? (OR_MAP[orKey] || { score: '0.1', label: 'Otros' }) : null,
      tension:  tensionKey ? (TENSION_MAP[tensionKey] || null) : null,
    });

  } catch (err) {
    console.error('DB error:', err.message);
    return res.status(500).json({ error: 'Error de BD: ' + err.message });
  } finally {
    await client.end().catch(() => {});
  }
};
