DELETE FROM records
WHERE code IN ('JC-0613-01', 'JC-0612-04', 'JC-0611-02', 'JC-0610-03')
   OR note IN (
     '周末串关，等全部赛果后核验',
     '赛后已补凭证',
     '临场赔率变化较大',
     '截图保存在相册'
   );
