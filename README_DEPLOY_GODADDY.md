Deploy notes for GoDaddy Node.js hosting

Steps to deploy this backend to GoDaddy (cPanel or Managed Node hosting):

1. Prepare environment
   - Copy `.env.example` to `.env` and fill values (DB credentials, JWT_SECRET, PORT if needed).
   - Make sure the database server allows remote connections from the GoDaddy host or use the hosted DB details.

2. Upload code
   - Zip the backend folder and upload via cPanel File Manager or use SFTP.
   - Place the project in an appropriate directory (e.g., `~/nodeapps/property-backend`).

3. Install dependencies
   - SSH into the server (or use cPanel's Terminal) and run:
     ```bash
     cd ~/nodeapps/property-backend
     npm install --production
     ```

4. Start the app
   - If using cPanel's Node.js app manager, configure the application root and the startup file `index.js`.
   - Otherwise, use a process manager like `pm2`:
     ```bash
     npm install -g pm2
     pm2 start index.js --name property-survey-backend
     pm2 save
     ```

5. Configure ports / reverse proxy
   - GoDaddy managed nodes may require the app to listen on the assigned port. Use environment variable `PORT`.
   - If running behind Apache/Nginx on cPanel, configure a reverse proxy to forward requests to the Node app port.

6. Files and uploads
   - The `uploads/` folder is used to store uploaded images and is included in `.gitignore`. Ensure it's writable by the app user.

7. Security
   - Use a strong `JWT_SECRET` in production set in `.env`.
   - Ensure DB credentials are secure and not committed to git.

8. Logging and monitoring
   - Use `pm2 logs property-survey-backend` to view logs.

If you want, I can: add a `start:prod` script, add PM2 ecosystem file, or prepare a one-command deploy script. Tell me which and I’ll add it.