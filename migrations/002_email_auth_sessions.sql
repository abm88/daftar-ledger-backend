-- Email-first auth (prototype v14 flow): accounts are identified by email,
-- phone becomes optional profile data collected later in Settings.
-- Email remains nullable at the DB level so pre-existing phone-only rows
-- survive; the application requires it for every new registration.

ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- Server-side sessions back the new explicit sign-out. Each issued JWT
-- carries a session id (sid claim); sign-out revokes the row, which kills
-- the token even though the JWT itself is still unexpired.
CREATE TABLE user_sessions (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
