const fs = require('fs');
const Parser = require('rss-parser');
const ExcelJS = require('exceljs');
require('dotenv').config();
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const parser = new Parser();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function readFeeds(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } catch (err) {
        console.error('Error reading feeds file:', err);
        return [];
    }
}

async function fetchNews(feedUrl) {
    try {
        const feed = await parser.parseURL(feedUrl);
        return feed.items.map(item => ({
            title: item.title,
            description: item.contentSnippet || item.content,
            url: item.link,
            date: new Date(item.pubDate || item.isoDate)
        }));
    } catch (err) {
        console.error(`Error fetching feed ${feedUrl}:`, err.message);
        return [];
    }
}

function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

function getDateStamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function exportToExcel(newsItems, outputFile) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Today\'s News');

    worksheet.columns = [
        { header: 'Title', key: 'title', width: 50 },
        { header: 'Description', key: 'description', width: 80 },
        { header: 'Url', key: 'url', width: 50 },
        { header: 'Date', key: 'date', width: 20 }
    ];

    newsItems.forEach(item => {
        worksheet.addRow({
            title: item.title,
            description: item.description,
            url: item.url,
            date: item.date.toISOString().split('T')[0] // Format date as YYYY-MM-DD
        });
    });

    await workbook.xlsx.writeFile(outputFile);
    console.log(`Exported ${newsItems.length} news items to ${outputFile}`);
}

function exportToHTML(analysisText, htmlFile, provider = 'OpenAI') {
    // Parse articles from the text - split by numbered items
    const articleMatches = analysisText.match(/\d+\.\s+.+?(?=\n\d+\.|$)/gs) || [];
    const articlesHTML = articleMatches.map((article, index) => {
        let title = '';
        let content = article;
        
        // For Gemini format: extract title from **Title:** field
        const geminiTitleMatch = article.match(/\*\*Title:\*\*\s+(.+?)(?:\n|$)/);
        if (geminiTitleMatch) {
            title = geminiTitleMatch[1].trim();
            // Remove the **Original Number:** line and clean up content
            content = article.replace(/\*\*Original Number:\*\*\s+\d+\s*\n/, '');
        } else {
            // For OpenAI format: extract title from the first line
            const titleMatch = article.match(/\d+\.\s+(.+?)(?:\n|$)/);
            title = titleMatch ? titleMatch[1].trim() : '';
            // Remove markdown bold formatting if present
            title = title.replace(/\*\*/g, '');
        }
        
        // Extract URL if present
        const urlMatch = article.match(/(https?:\/\/[^\s\n]+)/);
        const url = urlMatch ? urlMatch[1] : '';
        

        return `
        <div class="article">
            <div class="article-number">${index + 1}</div>
            <h3 class="article-title">${title}</h3>
            <div class="article-content">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\d+\.\s+/, '').trim()}</div>
            ${url ? `<a href="${url}" target="_blank" class="article-link">Read More →</a>` : ''}
        </div>
        `;
    }).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Top News Analysis</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 30px 20px;
            line-height: 1.6;
            color: #333;
        }
        
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        
        .header {
            background-color: white;
            padding: 40px;
            border-radius: 12px 12px 0 0;
            text-align: center;
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
        }
        
        h1 {
            color: #667eea;
            font-size: 2.8em;
            margin-bottom: 15px;
            font-weight: 700;
        }
        
        .date {
            color: #888;
            font-size: 1.1em;
            padding: 15px 0;
            border-bottom: 2px solid #f0f0f0;
        }
        
        .articles {
            background-color: white;
            padding: 20px;
            border-radius: 0 0 12px 12px;
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
        }
        
        .article {
            padding: 30px;
            margin-bottom: 25px;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            border-radius: 10px;
            border-left: 5px solid #667eea;
            transition: transform 0.2s, box-shadow 0.2s;
            position: relative;
        }
        
        .article:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.2);
        }
        
        .article-number {
            display: inline-block;
            background: #667eea;
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            text-align: center;
            line-height: 40px;
            font-weight: bold;
            margin-bottom: 15px;
            font-size: 1.1em;
        }
        
        .article-title {
            color: #333;
            font-size: 1.4em;
            margin-bottom: 15px;
            font-weight: 600;
            line-height: 1.4;
        }
        
        .article-content {
            color: #555;
            font-size: 0.95em;
            line-height: 1.8;
            margin-bottom: 15px;
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        .article-link {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            transition: background 0.2s;
            margin-top: 10px;
        }
        
        .article-link:hover {
            background: #5568d3;
        }
        
        .footer {
            text-align: center;
            color: #ccc;
            font-size: 0.9em;
            margin-top: 30px;
            padding: 20px;
        }
        
        @media (max-width: 768px) {
            h1 {
                font-size: 2em;
            }
            
            .header {
                padding: 30px;
            }
            
            .article {
                padding: 20px;
            }
            
            .article-title {
                font-size: 1.2em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📰 Top News of the Day</h1>
            <div class="date">Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div class="articles">
            ${articlesHTML}
        </div>
        <div class="footer">Analysis powered by ${provider}</div>
    </div>
</body>
</html>`;

    fs.writeFileSync(htmlFile, htmlContent);
    console.log(`Analysis saved to ${htmlFile}`);
}

function exportToSpeechText(analysisText, textFile) {
    // Remove URLs (https://... and http://...)
    let cleanText = analysisText.replace(/https?:\/\/[^\s\n]+/g, '');
    
    // Remove all asterisks (used for markdown formatting)
    cleanText = cleanText.replace(/\*/g, '');
    
    // Remove specific label strings
    cleanText = cleanText.replace(/URL:\s*/g, '');
    cleanText = cleanText.replace(/Description:\s*/g, '');
    cleanText = cleanText.replace(/Title:\s*/g, '');
    
    // Clean up excessive whitespace and newlines
    cleanText = cleanText.replace(/\n\s*\n\s*\n/g, '\n\n'); // Replace 3+ newlines with 2
    cleanText = cleanText.trim();
    
    fs.writeFileSync(textFile, cleanText);
    console.log(`Speech-ready text exported to ${textFile}`);
    
    return cleanText;
}

function resolveOutputGcsUri(audioFile) {
    const explicitUri = process.env.GOOGLE_TTS_OUTPUT_GCS_URI;
    if (explicitUri) {
        return explicitUri;
    }

    const prefix = process.env.GOOGLE_TTS_OUTPUT_GCS_PREFIX;
    if (!prefix) {
        return null;
    }

    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return `${normalizedPrefix}${path.basename(audioFile)}`;
}

function parseGcsUri(gcsUri) {
    if (!gcsUri.startsWith('gs://')) {
        throw new Error(`Invalid GCS URI: ${gcsUri}`);
    }

    const withoutScheme = gcsUri.slice('gs://'.length);
    const firstSlash = withoutScheme.indexOf('/');
    if (firstSlash === -1) {
        throw new Error(`GCS URI must include an object path: ${gcsUri}`);
    }

    return {
        bucket: withoutScheme.slice(0, firstSlash),
        object: withoutScheme.slice(firstSlash + 1)
    };
}

async function generateAudioFromText(textFile, audioFile) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.warn('Skipping audio generation: GOOGLE_APPLICATION_CREDENTIALS environment variable not set');
        console.log('Set GOOGLE_APPLICATION_CREDENTIALS to your Google Cloud service account JSON file path');
        return;
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_TTS_LOCATION || 'us';
    const outputGcsUri = resolveOutputGcsUri(audioFile);

    if (!projectId) {
        console.warn('Skipping audio generation: GOOGLE_CLOUD_PROJECT environment variable not set');
        return;
    }

    if (!outputGcsUri) {
        console.warn('Skipping audio generation: set GOOGLE_TTS_OUTPUT_GCS_URI or GOOGLE_TTS_OUTPUT_GCS_PREFIX');
        return;
    }

    try {
        console.log('Generating long-form audio using Google Text-to-Speech...');
        const text = fs.readFileSync(textFile, 'utf8');
        const client = new textToSpeech.TextToSpeechLongAudioSynthesizeClient();

        const request = {
            parent: `projects/${projectId}/locations/${location}`,
            input: { text: text },
            voice: {
                languageCode: 'en-US',
                name: 'en-US-Neural2-C',
                ssmlGender: 'MALE'
            },
            audioConfig: { audioEncoding: 'LINEAR16' },
            outputGcsUri: outputGcsUri
        };

        const [operation] = await client.synthesizeLongAudio(request);
        await operation.promise();
        console.log(`Long-form audio saved to ${outputGcsUri}`);

        try {
            const storage = new Storage();
            const { bucket, object } = parseGcsUri(outputGcsUri);
            await storage.bucket(bucket).file(object).download({ destination: audioFile });
            console.log(`Audio downloaded to ${audioFile}`);
        } catch (downloadError) {
            console.warn(`Unable to download audio from GCS: ${downloadError.message}`);
        }
    } catch (err) {
        console.error('Error generating audio:', err.message);
    }
}

const analysisPrompt = `
    Here is a list of news headlines from today:
    {newsList}

    Please identify the Top 30 most significant news items from this list.
    For each item, provide:
    - The original number from the list
    - The Title
    - The Description
    - A brief reason why it is significant.
    - The URL
    

    You are helping me decide if this article is something I would be interested in reading. I am Alexandre Salsinha. I am interested in artificial intelligence, music technology, technology, gadgets, drones, vibe coding, investment markets, robotics, computer programming,  technology ,Cryptocurrency, music production, IT Security,  Virtual Reality and augmented really, and finally,health breakthroughs . I am also interested in any new developments with ChatGPT, Gemini, Claude, MCP, and Perplexity. I'm very interested in when AI collides with society in interesting ways, or cool stuff that everyday people can do with AI.

    I'm not interested in these kinds of articles:
    - Gadgets that aren't innovative
    - Marketing or salesy press releases
    - Minor product updates
    - Articles that are trying to sell me something (unless what they're selling is super cool)

    If there isn't enough information in the title and summary to decide if the article would be interesting to me, search for information on the topic to decide. 
    
    Format the output as a numbered list.
`;

async function analyzeWithOpenAI(newsItems, dateStamp) {
    if (!process.env.OPENAI_API_KEY) {
        console.warn('Skipping OpenAI analysis: OPENAI_API_KEY not found in .env');
        return;
    }

    console.log('Analyzing news with OpenAI to find the Top 30...');

    // Prepare a simplified list for the prompt to save tokens
    const newsList = newsItems.map((item, index) => `${index + 1}. ${item.title} (${item.date.toISOString().split('T')[0]}) - ${item.url}`).join('\n');
    const prompt = analysisPrompt.replace('{newsList}', newsList);

    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'gpt-4o',
        });

        const analysisResult = completion.choices[0].message.content;
        console.log('\n--- Top 30 News of the Day (OpenAI) ---\n');
        console.log(analysisResult);
        console.log('\n------------------------------\n');

        const analysisFile = `top_news_analysis_${dateStamp}.txt`;
        fs.writeFileSync(analysisFile, analysisResult);
        console.log(`Analysis saved to ${analysisFile}`);

        // Export to HTML
        const htmlFile = `top_news_analysis_${dateStamp}.html`;
        exportToHTML(analysisResult, htmlFile, 'OpenAI GPT-4o');

        // Export to speech-ready text
        const speechTextFile = `top_news_analysis_speech_${dateStamp}.txt`;
        exportToSpeechText(analysisResult, speechTextFile);

        // Generate audio from speech text
        const audioFile = `top_news_analysis_${dateStamp}.wav`;
        await generateAudioFromText(speechTextFile, audioFile);

    } catch (err) {
        console.error('Error during OpenAI analysis:', err.message);
    }
}

async function analyzeWithGemini(newsItems, dateStamp) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('Skipping Gemini analysis: GEMINI_API_KEY not found in .env');
        return;
    }

    console.log('Analyzing news with Google Gemini to find the Top 30...');

    // Prepare a simplified list for the prompt to save tokens
    const newsList = newsItems.map((item, index) => `${index + 1}. ${item.title} (${item.date.toISOString().split('T')[0]}) - ${item.url}`).join('\n');
    const prompt = analysisPrompt.replace('{newsList}', newsList);

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        const analysisResult = result.response.text();
        
        console.log('\n--- Top 30 News of the Day (Gemini) ---\n');
        console.log(analysisResult);
        console.log('\n------------------------------\n');

        const analysisFile = `top_news_analysis_gemini_${dateStamp}.txt`;
        fs.writeFileSync(analysisFile, analysisResult);
        console.log(`Analysis saved to ${analysisFile}`);

        // Export to HTML
        const htmlFile = `top_news_analysis_gemini_${dateStamp}.html`;
        exportToHTML(analysisResult, htmlFile, 'Google Gemini');

        // Export to speech-ready text
        const speechTextFile = `top_news_analysis_gemini_speech_${dateStamp}.txt`;
        exportToSpeechText(analysisResult, speechTextFile);

        // Generate audio from speech text
        const audioFile = `top_news_analysis_gemini_${dateStamp}.wav`;
        await generateAudioFromText(speechTextFile, audioFile);

    } catch (err) {








        console.error('Error during Gemini analysis:', err.message);
    }
}

async function main() {
    // const feeds = await readFeeds('feeds.txt');
    // console.log(`Found ${feeds.length} feeds.`);

    const feeds = [];
        const speechTextFile = `top_news_analysis_gemini_speech_2026-02-22.txt`;

    const audioFile = `top_news_analysis_gemini_speech_2026-02-22.wav`;
        await generateAudioFromText(speechTextFile, audioFile);
        return;
    let allNews = [];
    for (const feed of feeds) {
        console.log(`Fetching ${feed}...`);
        const news = await fetchNews(feed);
        allNews = allNews.concat(news);
    }

    const todaysNews = allNews.filter(item => isToday(item.date));
    console.log(`Found ${todaysNews.length} news items from today.`);

    const dateStamp = getDateStamp();
    await exportToExcel(todaysNews, `news_today_${dateStamp}.xlsx`);

    if (todaysNews.length > 0) {
        // Get the API provider from command line argument
        const apiProvider = process.argv[2]?.toLowerCase() || 'openai';
        
        if (apiProvider === 'gemini') {
            await analyzeWithGemini(todaysNews, dateStamp);
        } else if (apiProvider === 'openai') {
            await analyzeWithOpenAI(todaysNews, dateStamp);
        } else if (apiProvider === 'both') {
            await analyzeWithOpenAI(todaysNews, dateStamp);
            await analyzeWithGemini(todaysNews, dateStamp);
        } else {
            console.error(`Unknown API provider: ${apiProvider}`);
            console.log('Usage: node index.js [openai|gemini|both]');
            console.log('  openai (default) - Use OpenAI GPT-4o');
            console.log('  gemini           - Use Google Gemini');
            console.log('  both             - Use both APIs');
            process.exit(1);
        }
    } else {
        console.log('No news from today to analyze.');
    }
}

main();
