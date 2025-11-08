-- Run this to check your current permissions
SELECT 
    USER_NAME() AS CurrentUser,
    HAS_PERMS_BY_NAME(NULL, NULL, 'CONTROL SERVER') AS HasControlServer,
    IS_SRVROLEMEMBER('sysadmin') AS IsSysAdmin;
GO

-- Check your database roles
SELECT 
    dp.name AS DatabaseRole
FROM sys.database_role_members drm
JOIN sys.database_principals dp ON drm.role_principal_id = dp.principal_id
WHERE drm.member_principal_id = USER_ID();
GO

-- If you have another admin account, use that and run this:
USE surveyapp_new;
GO

-- Add user to db_owner role
ALTER ROLE db_owner ADD MEMBER surveyapp_new;
GO

-- Or grant specific permissions at database level
GRANT CONTROL ON DATABASE::surveyapp_new TO surveyapp_new;
GO

-- Verify
SELECT 
    dp.name AS UserName,
    dp2.name AS RoleName
FROM sys.database_role_members drm
JOIN sys.database_principals dp ON drm.member_principal_id = dp.principal_id
JOIN sys.database_principals dp2 ON drm.role_principal_id = dp2.principal_id
WHERE dp.name = 'surveyapp_new';
GO
