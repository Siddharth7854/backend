Creating a dedicated SQL login and updating `db.js`

1) In SSMS (as an admin) run these commands to create a login and DB user:

-- Replace StrongP@ssw0rd! with a secure password you choose
CREATE LOGIN appuser WITH PASSWORD = 'StrongP@ssw0rd!';
USE survey;
CREATE USER appuser FOR LOGIN appuser;
ALTER ROLE db_datareader ADD MEMBER appuser;
ALTER ROLE db_datawriter ADD MEMBER appuser;

2) Update backend `db.js` or set environment variables before starting the server:

# PowerShell (temporary for the session)
$Env:DB_USER='appuser';
$Env:DB_PASSWORD='StrongP@ssw0rd!';
$Env:DB_SERVER='127.0.0.1';
$Env:DB_NAME='survey';
$Env:DB_INSTANCE='SQLEXPRESS';

# Start server
npm start

3) Test debug endpoint (PowerShell):
Invoke-WebRequest -UseBasicParsing 'http://localhost:4000/api/debug-admin-status' | Select-Object -Expand Content

4) Test admin login (PowerShell):
$body = @{ email='admin@survey.com'; password='admin2026'; role='Admin' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Body $body -ContentType 'application/json' 'http://localhost:4000/api/login'

Security notes:
- Don't use 'sa' in production. Use a dedicated login or Windows auth.
- In production move credentials to secure secrets store and don't keep plaintext in code.
- Hash user passwords in the Citizens table instead of storing plain text.
