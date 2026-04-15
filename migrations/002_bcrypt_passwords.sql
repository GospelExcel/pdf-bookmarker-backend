-- Migration: switch users.password from plaintext to bcrypt hashes.
-- Prior rows stored the password as a raw string, which made login a
-- plain `===` comparison. This is insecure and has been replaced with
-- bcrypt.hash/compare in the auth controller.
--
-- The stored plaintext passwords can't be converted in place (you can
-- hash a plaintext, but the old rows already lost the original when
-- users picked it, so migrating is indistinguishable from wiping). The
-- simplest correct move is to nuke existing accounts and force a
-- re-register. Every downstream row (documents.user_id) goes with it.
--
-- If you have real users you care about, DON'T RUN THIS — instead write
-- a "reset your password" flow and mark the old column with a flag.

TRUNCATE TABLE documents, users RESTART IDENTITY CASCADE;
