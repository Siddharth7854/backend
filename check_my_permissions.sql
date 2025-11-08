-- Check current user permissions
-- Run this query in SSMS to see what permissions you have

-- 1. Check who you are logged in as
SELECT SYSTEM_USER AS 'Current Login', USER_NAME() AS 'Current User';
GO

-- 2. Check if you have admin rights
SELECT IS_SRVROLEMEMBER('sysadmin') AS 'Is SysAdmin',
       IS_MEMBER('db_owner') AS 'Is DB Owner';
GO

-- 3. Check what database roles you have
SELECT 
    dp.name AS DatabaseRole,
    USER_NAME() AS UserName
FROM sys.database_role_members drm
JOIN sys.database_principals dp ON drm.role_principal_id = dp.principal_id
WHERE USER_NAME(drm.member_principal_id) = USER_NAME();
GO

-- 4. Check specific permissions on tables
SELECT 
    OBJECT_NAME(major_id) AS ObjectName,
    permission_name AS Permission,
    state_desc AS State
FROM sys.database_permissions
WHERE grantee_principal_id = USER_PRINCIPAL_ID()
    AND class_desc = 'OBJECT_OR_COLUMN'
ORDER BY ObjectName, Permission;
GO
