-- Run once by the Postgres image, when it initialises an empty data directory, connected to the
-- database the container is told to create (POSTGRES_DB). It records on that database that it is
-- the one this data volume was initialised for. The start sequence asks every database it is about
-- to migrate for this mark and refuses one without it (scripts/start/platform-start.mjs): which
-- database a volume was created for is knowable at this moment only.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnipost.initial_database = %L', current_database(), 'on');
END
$$;
