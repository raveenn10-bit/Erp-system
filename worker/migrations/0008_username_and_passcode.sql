-- Migration 0008: Add username and 4-digit passcode support to users
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN passcode_hash TEXT;

-- Update admin credentials to username: Admin, password: Admin2026, 4-digit passcode: 2026
UPDATE users 
SET username = 'Admin',
    password_hash = 'pbkdf2$100000$c0b4d81c07ea408dce66542264420290$cbbb7319a84e9e44a6d0f63c30d9d613c2bea998d2a3983d0441aca10db3c916',
    passcode_hash = 'pbkdf2$100000$4b398e835462466ea173452d3ca49b8f$48ce08783e862c07ebc2e83dee21c0c8e12a48e30a5b00c7b83646d7269fb371'
WHERE id = 'u1' OR role_id = 'admin';

-- Set default username for any other users
UPDATE users 
SET username = LOWER(REPLACE(REPLACE(name, ' ', ''), '.', ''))
WHERE username IS NULL;

-- Create unique index on username
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
