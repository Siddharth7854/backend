# Node.js Backend for Property Survey System

## Setup
1. Edit `db.js` and set your SQL Server username, password, and database name.
2. In SQL Server, create a table:

```
CREATE TABLE Citizens (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(100),
  email NVARCHAR(100) UNIQUE,
  password NVARCHAR(100),
  ward NVARCHAR(50)
);
```

3. In this backend folder, run:
   npm install
   npm start

## API Endpoints
- POST `/api/signup`  { name, email, password, ward }
- POST `/api/login`   { email, password }

## Notes
- This is a basic example. For production, hash passwords and add validation.
- The backend runs on http://localhost:4000
