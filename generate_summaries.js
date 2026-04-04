const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TextToSpeechLongAudioSynthesizeClient } = require('@google-cloud/text-to-speech');
const { Storage } = require('@google-cloud/storage');
const { google } = require('googleapis');

const argv = yargs(hideBin(process.argv))
    .option('file', {
        alias: 'f',
        description: 'HTML file to process',
        type: 'string',
        demandOption: true
    })
    .option('indices', {
        alias: 'i',
        description: 'Comma-separated list of indices to process',
        type: 'string',
        demandOption: true
    })
    .help()
    .alias('help', 'h')
    .argv;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function uploadToDrive(filePath) {
    try {
        console.log(`Uploading ${filePath} to Google Drive...`);

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            'urn:ietf:wg:oauth:2.0:oob'
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID.trim();
        const fileMetadata = {
            name: path.basename(filePath),
            parents: [folderId],
        };

        let mimeType = 'application/octet-stream';
        if (filePath.endsWith('.mp3')) mimeType = 'audio/mpeg';
        else if (filePath.endsWith('.wav')) mimeType = 'audio/wav';
        else if (filePath.endsWith('.html')) mimeType = 'text/html';

        const media = {
            mimeType: mimeType,
            body: fs.createReadStream(filePath),
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id',
            supportsAllDrives: true,
        });

        console.log(`Successfully uploaded: ${filePath} (Drive ID: ${response.data.id})`);
        return response.data.id;
    } catch (err) {
        console.error('Error uploading to Google Drive:', err.message);
        if (err.response && err.response.data) {
            console.error('Detailed Error:', JSON.stringify(err.response.data, null, 2));
        }
    }
}

async function synthesizeLongAudio(speechTextFile, audioFile) {
    const client = new TextToSpeechLongAudioSynthesizeClient();
    const storage = new Storage();

    // Load configuration from .env
    const bucketName = process.env.GCS_BUCKET_NAME;
    const inputFilePath = speechTextFile;
    const outputGcsUriPrefix = process.env.OUTPUT_GCS_URI_PREFIX || `gs://${bucketName}/output/`;

    if (!bucketName) {
        console.error('Error: GCS_BUCKET_NAME is not set in .env file.');
        process.exit(1);
    }

    if (!fs.existsSync(inputFilePath)) {
        console.error(`Error: Input file "${inputFilePath}" not found.`);
        process.exit(1);
    }

    const text = fs.readFileSync(inputFilePath, 'utf8');

    console.log(`Starting long-form synthesis for: ${inputFilePath}`);
    console.log(`Character count: ${text.length}`);

    const parent = `projects/${await client.getProjectId()}/locations/global`;

    const outputFileName = audioFile;
    const outputGcsUri = `${outputGcsUriPrefix}${outputFileName}`;

    const request = {
        parent: parent,
        input: {
            text: text,
        },
        audioConfig: {
            audioEncoding: 'LINEAR16', // High quality WAV
        },
        voice: {
            languageCode: 'en-US',
            name: 'en-US-Standard-A', // You can change this to your preferred voice
        },
        outputGcsUri: outputGcsUri,
    };

    try {
        // This is a Long Running Operation (LRO)
        const [operation] = await client.synthesizeLongAudio(request);

        console.log(`Operation started. LRO Name: ${operation.name}`);
        console.log('Waiting for operation to complete...');

        await operation.promise();

        console.log('Synthesis complete!');
        console.log(`Audio stored at: ${outputGcsUri}`);

        // Download the file
        console.log(`Downloading audio file to local directory...`);
        const localFileName = path.basename(outputGcsUri);
        const options = {
            destination: localFileName,
        };

        // Extract bucket and file path from URI (gs://bucket/path/to/file)
        const gcsPath = outputGcsUri.replace(`gs://${bucketName}/`, '');
        await storage.bucket(bucketName).file(gcsPath).download(options);

        console.log(`Successfully downloaded: ${localFileName}`);

        // Upload to Google Drive if configured
        if (process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_DRIVE_FOLDER_ID !== 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE') {
            await uploadToDrive(localFileName);
        }
    } catch (err) {
        console.error('ERROR:', err);
    }
}

async function extractTextFromUrl(url) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (!response.ok) return null;
        const html = await response.text();
        const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text.substring(0, 50000); // limit chars to avoid token limits
    } catch (err) {
        console.error(`Error fetching ${url}:`, err.message);
        return null;
    }
}

async function main() {
    const filePath = path.resolve(argv.file);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const targetIndices = argv.indices.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    console.log(`Processing indices: ${targetIndices.join(', ')} from file: ${argv.file}`);

    const htmlContent = fs.readFileSync(filePath, 'utf8');

    const articleRegex = /<div class="article-number">(\d+)<\/div>[\s\S]*?<h3 class="article-title">(.*?)<\/h3>[\s\S]*?<a href="(.*?)"/g;
    const articles = [];
    let match;
    while ((match = articleRegex.exec(htmlContent)) !== null) {
        articles.push({
            number: parseInt(match[1]),
            title: match[2].trim(),
            url: match[3]
        });
    }

    const selectedArticles = articles.filter(a => targetIndices.includes(a.number));

    if (selectedArticles.length === 0) {
        console.log("No matching articles found.");
        return;
    }

    let model;
    try {
        model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    } catch (err) {
        console.error('Failed to initialize Gemini. Check your GEMINI_API_KEY.', err.message);
        process.exit(1);
    }

    const summaries = [];

    for (const article of selectedArticles) {
        console.log(`Summarizing Article ${article.number}: ${article.title}`);
        // let contentToSummarize = await extractTextFromUrl(article.url);

        // const prompt = contentToSummarize 
        //     ? `Please summarize the following article in a comprehensive paragraph. \n\nTitle: ${article.title}\nURL: ${article.url}\n\nArticle Text:\n${contentToSummarize}`
        //     : `Please provide a comprehensive summary of the article at this URL, based on the title and your knowledge. \n\nTitle: ${article.title}\nURL: ${article.url}`;

        const prompt = `summarize this url "${article.url}" by giving the TL;DR and Key Takeaways in bullet points.`;


        try {
            const result = await model.generateContent(prompt);
            const summary = result.response.text();
            summaries.push({
                ...article,
                summary
            });
            console.log(`  -> Summary generated.`);
        } catch (err) {
            console.error(`  -> Error summarizing article ${article.number}:`, err.message);
            summaries.push({ ...article, summary: `Failed to generate summary: ${err.message}` });
        }
    }

    const outputPrefix = filePath.substring(0, filePath.lastIndexOf('.')) || filePath;
    const dateStamp = new Date().toISOString().split('T')[0];
    const outputFile = `${outputPrefix}_detailed_${dateStamp}.html`.replace(/\\/g, '/').split('/').pop();

    let articlesHTML = summaries.map(article => {
        let formattedSummary = article.summary
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n\s*[\*\-]\s+/g, '<br/><br/>&bull; ')
            .replace(/^\s*[\*\-]\s+/g, '&bull; ')
            .replace(/\n/g, '<br/>');

        return `
        <div class="article">
            <div class="article-number">${article.number}</div>
            <h3 class="article-title">${article.title}</h3>
            <div class="article-content">${formattedSummary}</div>
            <a href="${article.url}" target="_blank" class="article-link">Original Article →</a>
        </div>
        `;
    }).join('');

    const outputHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Detailed News Summaries</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 30px 20px; line-height: 1.6; color: #333; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { background-color: white; padding: 40px; border-radius: 12px 12px 0 0; text-align: center; box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1); }
        h1 { color: #667eea; font-size: 2.8em; margin-bottom: 15px; font-weight: 700; }
        .date { color: #888; font-size: 1.1em; padding: 15px 0; border-bottom: 2px solid #f0f0f0; }
        .articles { background-color: white; padding: 20px; border-radius: 0 0 12px 12px; box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1); }
        .article { padding: 30px; margin-bottom: 25px; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border-radius: 10px; border-left: 5px solid #667eea; transition: transform 0.2s, box-shadow 0.2s; position: relative; }
        .article-number { display: inline-block; background: #667eea; color: white; width: 40px; height: 40px; border-radius: 50%; text-align: center; line-height: 40px; font-weight: bold; margin-bottom: 15px; font-size: 1.1em; }
        .article-title { color: #333; font-size: 1.4em; margin-bottom: 15px; font-weight: 600; line-height: 1.4; }
        .article-content { color: #555; font-size: 0.95em; line-height: 1.8; margin-bottom: 15px; }
        .article-link { display: inline-block; background: #667eea; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; transition: background 0.2s; margin-top: 10px; }
        .article-link:hover { background: #5568d3; }
        .footer { text-align: center; color: #ccc; font-size: 0.9em; margin-top: 30px; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📄 Detailed Summaries</h1>
            <div class="date">Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div class="articles">
            ${articlesHTML}
        </div>
        <div class="footer">Detailed Analysis powered by Google Gemini</div>
    </div>
</body>
</html>`;

    let textContent = summaries.map(article => {
        let plainTextSummary = article.summary
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/#/g, '')
            .replace(/[\-\+]\s/g, '')
            .trim();
        return `Article ${article.number}. ${article.title}.\n\n${plainTextSummary}`;
    }).join('\n\nNext Article.\n\n');

    const outputTextFile = `${outputPrefix}_speech_${dateStamp}.txt`.replace(/\\/g, '/').split('/').pop();
    fs.writeFileSync(outputTextFile, textContent);
    console.log(`Speech summaries saved to ${outputTextFile}`);

    fs.writeFileSync(outputFile, outputHtml);
    console.log(`HTML summaries saved to ${outputFile}`);

    // Upload HTML to Google Drive if configured
    if (process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_DRIVE_FOLDER_ID !== 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE') {
        await uploadToDrive(outputFile);
    }

    // Generate audio from speech text
    const audioFile = `${outputPrefix}_speech_${dateStamp}.mp3`.replace(/\\/g, '/').split('/').pop();
    await synthesizeLongAudio(outputTextFile, audioFile);
}

main();
