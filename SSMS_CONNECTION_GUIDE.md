# GoDaddy SQL Server Database - SSMS Connection Guide

## Step 1: Open SQL Server Management Studio (SSMS)

## Step 2: Connection Details

```
Server type: Database Engine
Server name: A2NWPLSK14SQL-v04.shr.prod.iad2.secureserver.net,1433
Authentication: SQL Server Authentication
Login: surveyapp_new
Password: Sid@91221
```

**Important:** Add `,1433` at the end of server name to specify the port

## Step 3: Advanced Connection Settings (if needed)

Click "Options" button, then:
- **Connection Properties Tab:**
  - Database: surveyapp_new
  - Network protocol: TCP/IP
  - Connection timeout: 30 seconds

- **Additional Connection Parameters Tab:**
  - Add: `Encrypt=True;TrustServerCertificate=True`

## Step 4: Connect

Click "Connect" button

---

## Granting Permissions (After Connection)

### Method 1: Using GUI

1. Expand **Databases** → **surveyapp_new**
2. Expand **Security** → **Users**
3. Right-click on user **surveyapp_new** → **Properties**
4. Go to **Securables** tab
5. Click **Search** → Select **All objects of the types...**
6. Check **Tables** → OK
7. In the list, select tables: **Citizens**, **Surveys**
8. In "Permissions" section, Grant:
   - ☑ SELECT
   - ☑ INSERT
   - ☑ UPDATE
   - ☑ DELETE
9. Click **OK**

### Method 2: Using SQL Query (Easier)

1. Click **New Query** button (top toolbar)
2. Copy and paste this SQL:

```sql
-- Switch to the database
USE surveyapp_new;
GO

-- Grant permissions on Citizens table
GRANT SELECT, INSERT, UPDATE ON dbo.Citizens TO surveyapp_new;
GO

-- Grant permissions on Surveys table  
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Surveys TO surveyapp_new;
GO

-- Verify permissions
SELECT 
    dp.name AS UserName,
    o.name AS TableName,
    p.permission_name AS Permission,
    p.state_desc AS State
FROM sys.database_permissions p
JOIN sys.database_principals dp ON p.grantee_principal_id = dp.principal_id
JOIN sys.objects o ON p.major_id = o.object_id
WHERE dp.name = 'surveyapp_new'
    AND o.type = 'U'  -- User tables only
ORDER BY o.name, p.permission_name;
GO
```

3. Click **Execute** button (or press F5)
4. Check "Messages" tab for success confirmation
5. Last query will show all granted permissions

---

## Troubleshooting

### Error: "Login failed for user"
- Check username/password are correct
- Verify port `,1433` is added to server name
- Check if IP is whitelisted in GoDaddy (may need to contact support)

### Error: "Cannot open database"
- Ensure database name "surveyapp_new" is spelled correctly
- Check if database exists in GoDaddy control panel

### Error: "Connection timeout"
- GoDaddy may have firewall restrictions
- Contact GoDaddy support to whitelist your IP address
- Try from different network/VPN

### Can't find user in Security → Users
- You may not have admin rights
- Contact GoDaddy support to grant permissions
- They can run the SQL commands for you

---

## Alternative: Contact GoDaddy Support

If you cannot connect or grant permissions yourself:

**Contact GoDaddy Support and say:**

> "I need to grant SELECT, INSERT, UPDATE, DELETE permissions to user 'surveyapp_new' 
> on tables 'Citizens' and 'Surveys' in database 'surveyapp_new'.
> 
> Server: A2NWPLSK14SQL-v04.shr.prod.iad2.secureserver.net
> Database: surveyapp_new
> User: surveyapp_new"

They can execute the permissions for you remotely.

---

## After Granting Permissions

1. **Remove hardcoded login bypass** from backend code
2. **Re-enable ensureIsAdminColumn** function
3. **Test login** with database credentials
4. **Restart Render deployment** if needed
