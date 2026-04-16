ALTER TABLE "sessions" ADD COLUMN "tracked_seconds" integer;

-- Backfill: for completed/stopped sessions that have confirmed screenshots,
-- compute from screenshots. For those without screenshots (cleaned up),
-- use totalActiveSeconds as best approximation.
UPDATE sessions SET tracked_seconds = COALESCE(
  (SELECT GREATEST(0, (count(distinct s.minute_bucket) - 1) * 60)
   FROM screenshots s
   WHERE s.session_id = sessions.id AND s.confirmed = true
   HAVING count(distinct s.minute_bucket) > 0),
  total_active_seconds
)
WHERE status IN ('stopped', 'compiling', 'complete', 'failed')
  AND tracked_seconds IS NULL;
