const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.install', 'https://www.googleapis.com/auth/drive'];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
    console.error('Error: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not found in .env');
    console.log('Please add them to your .env file first.');
    process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
});

console.log('Authorize this app by visiting this url:', authUrl);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
        if (err) return console.error('Error retrieving access token', err);
        console.log('\n--- SUCCESS! ---');
        console.log('Add this REFRESH TOKEN to your .env file:');
        console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}`);
    });
});
