const { query, transaction } = require('../db');
const HttpError = require('../httpError');

const VALID_STATUS = new Set(['pending', 'win', 'lost']);
const VALID_SETTLE_STATUS = new Set(['win', 'lost']);

function asText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function asPositiveNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} 必须大于 0`);
  }
  return parsed;
}

function asPositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} 必须是正整数`);
  }
  return parsed;
}

function mapRecord(row, legs = []) {
  return {
    dbId: row.id,
    id: row.code || `#${row.id}`,
    ticketType: row.ticket_type,
    source: row.source,
    amount: Number(row.amount),
    multiple: Number(row.multiple_count),
    stake: Number(row.stake),
    status: row.status,
    result: row.result,
    prize: Number(row.prize),
    note: row.note || '',
    imagePath: row.image_path || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legs
  };
}

async function execute(db, sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function loadLegs(recordIds, db) {
  if (!recordIds.length) return new Map();
  const placeholders = recordIds.map(() => '?').join(',');
  const sql = `
    SELECT ticket_id, league, match_name, play, pick, sort_order
    FROM record_legs
    WHERE ticket_id IN (${placeholders})
    ORDER BY ticket_id ASC, sort_order ASC, id ASC
  `;
  const rows = db ? await execute(db, sql, recordIds) : await query(sql, recordIds);
  return rows.reduce((map, row) => {
    if (!map.has(row.ticket_id)) map.set(row.ticket_id, []);
    map.get(row.ticket_id).push({
      league: row.league,
      match: row.match_name,
      play: row.play,
      pick: row.pick
    });
    return map;
  }, new Map());
}

async function findRecord(identifier, db) {
  const idNumber = Number(identifier);
  const rows = await execute(
    db,
    `SELECT * FROM records WHERE code = ? OR id = ? LIMIT 1`,
    [String(identifier), Number.isInteger(idNumber) ? idNumber : 0]
  );
  if (!rows.length) return null;
  const legsByRecord = await loadLegs([rows[0].id], db);
  return mapRecord(rows[0], legsByRecord.get(rows[0].id) || []);
}

async function listRecords(status = 'all') {
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    if (!VALID_STATUS.has(status)) throw new HttpError(400, '未知记录状态');
    where = 'WHERE status = ?';
    params.push(status);
  }

  const rows = await query(
    `SELECT * FROM records ${where} ORDER BY created_at DESC, id DESC`,
    params
  );
  const legsByRecord = await loadLegs(rows.map(row => row.id));
  return rows.map(row => mapRecord(row, legsByRecord.get(row.id) || []));
}

async function createRecord(payload) {
  const legs = Array.isArray(payload.legs) ? payload.legs : [];
  if (!legs.length) throw new HttpError(400, '请至少加入 1 场赛事');

  const normalizedLegs = legs.map((leg, index) => {
    const match = asText(leg.match);
    const pick = asText(leg.pick);
    if (!match || !pick) throw new HttpError(400, `第 ${index + 1} 场缺少赛事或投注选项`);
    return {
      league: asText(leg.league, '未分类赛事'),
      match,
      play: asText(leg.play, '胜平负'),
      pick
    };
  });

  const amount = asPositiveNumber(payload.amount, '单注金额');
  const multiple = asPositiveInteger(payload.multiple, '倍数');
  const stake = amount * multiple;
  const ticketType =
    asText(payload.ticketType, normalizedLegs.length > 1 ? `${normalizedLegs.length} 串 1` : '单关') ||
    '单关';
  const source = asText(payload.source) || (payload.imagePath ? 'AI 图片识别' : '手动录入');
  const note = asText(payload.note);
  const imagePath = asText(payload.imagePath);

  return transaction(async connection => {
    const [result] = await connection.execute(
      `
        INSERT INTO records
          (ticket_type, source, amount, multiple_count, stake, status, result, prize, note, image_path)
        VALUES (?, ?, ?, ?, ?, 'pending', '待赛果', 0, ?, ?)
      `,
      [ticketType, source, amount, multiple, stake, note, imagePath || null]
    );

    const now = new Date();
    const code = `JC-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(result.insertId).padStart(4, '0')}`;
    await connection.execute(`UPDATE records SET code = ? WHERE id = ?`, [code, result.insertId]);

    for (const [index, leg] of normalizedLegs.entries()) {
      await connection.execute(
        `
          INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [result.insertId, index + 1, leg.league, leg.match, leg.play, leg.pick]
      );
    }

    return findRecord(result.insertId, connection);
  });
}

async function settleRecord(identifier, payload) {
  const status = asText(payload.status);
  if (!VALID_SETTLE_STATUS.has(status)) throw new HttpError(400, '核验状态只能是 win 或 lost');

  return transaction(async connection => {
    const current = await findRecord(identifier, connection);
    if (!current) throw new HttpError(404, '记录不存在');

    const parsedPrize = Number(payload.prize || 0);
    if (status === 'win' && !Number.isFinite(parsedPrize)) {
      throw new HttpError(400, '奖金必须是数字');
    }

    const prize = status === 'win' ? Math.max(0, parsedPrize) : 0;
    const defaultResult = status === 'win' ? '整单中奖' : '未中奖';
    const result = asText(payload.result) || defaultResult;
    const note = asText(payload.note) || current.note;

    await connection.execute(
      `
        UPDATE records
        SET status = ?, result = ?, prize = ?, note = ?
        WHERE id = ?
      `,
      [status, result, prize, note, current.dbId]
    );

    return findRecord(current.dbId, connection);
  });
}

async function stats(range = 'recent') {
  const summaryRows = await query(`
    SELECT
      COALESCE(SUM(stake), 0) AS totalStake,
      COALESCE(SUM(prize), 0) AS settledPrize,
      COALESCE(SUM(prize - stake), 0) AS netProfit,
      COALESCE(SUM(status = 'pending'), 0) AS pending,
      COALESCE(SUM(status = 'win'), 0) AS wins,
      COALESCE(SUM(status = 'lost'), 0) AS losses,
      COUNT(*) AS total
    FROM records
  `);
  const summary = summaryRows[0] || {};

  let trendRows;
  if (range === 'month') {
    trendRows = await query(`
      SELECT code, created_at, prize - stake AS profit
      FROM records
      WHERE created_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
      ORDER BY created_at ASC, id ASC
    `);
  } else if (range === 'all') {
    trendRows = await query(`
      SELECT code, created_at, prize - stake AS profit
      FROM records
      ORDER BY created_at ASC, id ASC
    `);
  } else {
    const rows = await query(`
      SELECT code, created_at, prize - stake AS profit
      FROM records
      ORDER BY created_at DESC, id DESC
      LIMIT 7
    `);
    trendRows = rows.reverse();
    range = 'recent';
  }

  return {
    stats: {
      totalStake: Number(summary.totalStake || 0),
      settledPrize: Number(summary.settledPrize || 0),
      netProfit: Number(summary.netProfit || 0),
      pending: Number(summary.pending || 0),
      wins: Number(summary.wins || 0),
      losses: Number(summary.losses || 0),
      total: Number(summary.total || 0)
    },
    trend: {
      range,
      values: trendRows.map(row => Number(row.profit || 0))
    }
  };
}

module.exports = {
  listRecords,
  createRecord,
  settleRecord,
  stats
};
