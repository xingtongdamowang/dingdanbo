INSERT IGNORE INTO records
  (code, ticket_type, source, amount, multiple_count, stake, status, result, prize, note, created_at)
VALUES
  ('JC-0613-01', '3 串 1', '手动录入', 20, 2, 40, 'pending', '待赛果', 0, '周末串关，等全部赛果后核验', '2026-06-13 10:00:00'),
  ('JC-0612-04', '2 串 1', 'AI 识别', 30, 2, 60, 'win', '横滨 2:1；鹿岛 1:0', 126, '赛后已补凭证', '2026-06-12 22:00:00'),
  ('JC-0611-02', '单关', '手动录入', 15, 2, 30, 'lost', '0:1', 0, '临场赔率变化较大', '2026-06-11 21:30:00'),
  ('JC-0610-03', '2 串 1', '手动录入', 10, 5, 50, 'pending', '待赛果', 0, '截图保存在相册', '2026-06-10 20:00:00');

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 1, '中超', '青岛海牛 vs 成都蓉城', '胜平负', '客胜'
FROM records r
WHERE r.code = 'JC-0613-01'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 1);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 2, '日职', '横滨水手 vs 神户胜利船', '总进球', '3 球'
FROM records r
WHERE r.code = 'JC-0613-01'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 2);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 3, '欧冠', '多特蒙德 vs 国际米兰', '让球胜平负', '让平'
FROM records r
WHERE r.code = 'JC-0613-01'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 3);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 1, '日职', '横滨水手 vs 神户胜利船', '总进球', '3 球'
FROM records r
WHERE r.code = 'JC-0612-04'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 1);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 2, '日职', '鹿岛鹿角 vs 柏太阳神', '胜平负', '主胜'
FROM records r
WHERE r.code = 'JC-0612-04'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 2);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 1, '西甲', '西班牙人 vs 巴列卡诺', '让球胜平负', '让胜'
FROM records r
WHERE r.code = 'JC-0611-02'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 1);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 1, '中超', '山东泰山 vs 河南队', '比分', '2:0'
FROM records r
WHERE r.code = 'JC-0610-03'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 1);

INSERT INTO record_legs (ticket_id, sort_order, league, match_name, play, pick)
SELECT r.id, 2, '中超', '武汉三镇 vs 天津津门虎', '胜平负', '平'
FROM records r
WHERE r.code = 'JC-0610-03'
  AND NOT EXISTS (SELECT 1 FROM record_legs l WHERE l.ticket_id = r.id AND l.sort_order = 2);
