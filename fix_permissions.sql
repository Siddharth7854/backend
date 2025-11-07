-- GoDaddy SQL Server Database Permissions Fix
-- Run this in SQL Server Management Studio or Plesk SQL Query tool

USE surveyapp_new;
GO

-- Grant SELECT permissions on Citizens table
GRANT SELECT ON surveyapp_new.dbo.Citizens TO surveyapp_new;
GRANT INSERT ON surveyapp_new.dbo.Citizens TO surveyapp_new;
GRANT UPDATE ON surveyapp_new.dbo.Citizens TO surveyapp_new;
GO

-- Grant permissions on Surveys table
GRANT SELECT ON surveyapp_new.dbo.Surveys TO surveyapp_new;
GRANT INSERT ON surveyapp_new.dbo.Surveys TO surveyapp_new;
GRANT UPDATE ON surveyapp_new.dbo.Surveys TO surveyapp_new;
GRANT DELETE ON surveyapp_new.dbo.Surveys TO surveyapp_new;
GO

-- Verify permissions
SELECT 
    dp.name AS UserName,
    o.name AS ObjectName,
    p.permission_name,
    p.state_desc
FROM sys.database_permissions p
JOIN sys.database_principals dp ON p.grantee_principal_id = dp.principal_id
JOIN sys.objects o ON p.major_id = o.object_id
WHERE dp.name = 'surveyapp_new'
ORDER BY o.name;
GO
