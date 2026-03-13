const { google } = require('googleapis');
require('dotenv').config();
const fs = require('fs');

async function debugDrive() {
    try {
        console.log('--- Debugging Google Drive Access ---');
        console.log('Credentials file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
        
        const keyFileContent = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
        console.log('Service Account Email:', keyFileContent.client_email);
        console.log('Folder ID:', process.env.GOOGLE_DRIVE_FOLDER_ID);

        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/drive'],
        });

        const drive = google.drive({ version: 'v3', auth });

        console.log('\nListing ALL files/folders the service account can see...');
        try {
            const listAll = await drive.files.list({
                pageSize: 10,
                fields: 'files(id, name, mimeType)',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
            });
            console.log(`Found ${listAll.data.files.length} items total.`);
            listAll.data.files.forEach(f => {
                console.log(` - [${f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'FILE'}] ${f.name} (ID: ${f.id})`);
            });
        } catch (err) {
            console.error('FAILED to list all files:', err.message);
        }

        console.log('\nTrying to list files in folder...');
        try {
            const list = await drive.files.list({
                q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID.trim()}' in parents and trashed = false`,
                fields: 'files(id, name)',
            });
            console.log(`Found ${list.data.files.length} files in folder.`);
        } catch (err) {
            console.error('FAILED to list files:', err.message);
        }

        console.log('\nTrying to CREATE a small test file...');
        try {
            const res = await drive.files.create({
                requestBody: {
                    name: 'test_upload.txt',
                    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID.trim()],
                },
                media: {
                    mimeType: 'text/plain',
                    body: 'Hello from Antigravity!',
                },
                fields: 'id',
            });
            console.log('SUCCESSfully created test file! ID:', res.data.id);
            
            // Cleanup
            console.log('Cleaning up test file...');
            await drive.files.delete({ fileId: res.data.id });
            console.log('Cleanup complete.');
        } catch (err) {
            console.error('FAILED to create test file:', err.message);
            if (err.response && err.response.data) {
                console.error('Detailed Error:', JSON.stringify(err.response.data, null, 2));
            }
        }

    } catch (err) {
        console.error('DEBUG SCRIPT ERROR:', err);
    }
}

debugDrive();
