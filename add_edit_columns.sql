-- Add edit tracking columns to Surveys table
USE surveyapp_new;
GO

-- Check if columns exist before adding
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Surveys]') AND name = 'isEdited')
BEGIN
    ALTER TABLE Surveys ADD isEdited BIT DEFAULT 0 NOT NULL;
    PRINT 'Added isEdited column';
END
ELSE
BEGIN
    PRINT 'isEdited column already exists';
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Surveys]') AND name = 'editedAt')
BEGIN
    ALTER TABLE Surveys ADD editedAt DATETIME NULL;
    PRINT 'Added editedAt column';
END
ELSE
BEGIN
    PRINT 'editedAt column already exists';
END
GO

-- Update existing records to have isEdited = 0 if NULL (only if column exists)
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Surveys]') AND name = 'isEdited')
BEGIN
    UPDATE Surveys SET isEdited = 0 WHERE isEdited IS NULL;
    PRINT 'Updated existing records';
END
GO

PRINT 'Edit tracking columns migration complete!';
GO
