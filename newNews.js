const path = require('path');
process.chdir(__dirname);

const fs = require('fs');
const Parser = require('rss-parser');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');

const parser = new Parser({ timeout: 15000 });
const seenFile = path.join(__dirname, 'seen_news.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const RUN_INTERVAL_MS = 5 * 60 * 1000;
const EMAIL_RECIPIENT = '2alexandresalsinha@gmail.com';

const mailTransporter = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    })
    : null;

const analysisPrompt = `
    Here is a list of news headlines from today:
    {newsList}

    Please identify the Top 5 most significant news items from this list.
    
    For each item, provide:
    - The Title
    - The Description
    - The URL


    You are helping me decide if this article is something I would be interested in reading. I am Alexandre Salsinha.
    I am interested in investment markets, cryptocurrency, and finally,health breakthroughs and very important world news.
    I am also interested in any new developments with ChatGPT, Gemini, Claude, MCP, and Perplexity. I'm very interested in when AI collides with society in interesting ways, or cool stuff that everyday people can do with AI.

    If there is a news about this compannies, I would be interested in reading it, and put it in the top of the list:
    - Microsoft
    - Nvidia
    - equinix
    - vertiv
    - intuitive surgical
    - constellation energy
    - first solar
    - schneider electric

    I'm not interested in these kinds of articles:
    - All Apple related news
    - Gadgets that aren't innovative
    - Marketing or salesy press releases
    - Minor product updates
    - Articles that are trying to sell me something (unless what they're selling is super cool)

    Convert all dollar values to euros (€) using the current exchange rate.
    If there isn't enough information in the title and summary to decide if the article would be interesting to me, search for information on the topic to decide.

    Format the output as a numbered list. Only output the numbered list and nothing else before or after it.
`;

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
        console.log(`Fetched feed ${feedUrl}:`, feed.items.length, 'items');
        return feed.items.map(item => ({
            title: item.title,
            url: item.link,
            date: new Date(item.pubDate || item.isoDate),
            source: feed.title || feedUrl
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

function formatDateDMY(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

function loadSeen() {
    try {
        const data = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
        return new Set(data.urls || []);
    } catch (err) {
        return new Set();
    }
}

function saveSeen(seenUrls) {
    fs.writeFileSync(seenFile, JSON.stringify({ urls: Array.from(seenUrls) }, null, 2));
}

async function analyzeWithGemini(newsItems) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('Skipping Gemini analysis: GEMINI_API_KEY not found in .env');
        return null;
    }

    console.log('Filtering new news with Google Gemini...');

    const newsList = newsItems.map((item, index) => `${index + 1}. ${item.title} (${formatDateDMY(item.date)}) - ${item.url}`).join('\n');
    const prompt = analysisPrompt.replace('{newsList}', newsList);

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        const analysisResult = result.response.text();

        console.log('\n--- New News Filtered by Gemini ---\n');
        console.log(analysisResult);
        console.log('\n------------------------------\n');

        return analysisResult;
    } catch (err) {
        console.error('Error during Gemini analysis:', err.message);
        return null;
    }
}

function parseAnalysisItems(analysisText) {
    const itemRegex = /\*\*Title:\*\*\s*([\s\S]*?)\s*\*\*Description:\*\*\s*([\s\S]*?)\s*\*\*URL:\*\*\s*(\S+)/g;
    const items = [];
    let match;
    while ((match = itemRegex.exec(analysisText)) !== null) {
        items.push({
            title: match[1].trim(),
            description: match[2].trim(),
            url: match[3].trim()
        });
    }
    return items;
}

async function sendAnalysisItemEmail(item) {
    if (!mailTransporter) {
        console.warn('Skipping email: GMAIL_USER or GMAIL_APP_PASSWORD not found in .env');
        return;
    }

    try {
        await mailTransporter.sendMail({
            from: process.env.GMAIL_USER,
            to: EMAIL_RECIPIENT,
            subject: item.title,
            text: `${item.description}\n\n${item.url}`,
            html: `<p>${item.description}</p><p><a href="${item.url}">${item.url}</a></p>`
        });
        console.log(`Analysis email sent to ${EMAIL_RECIPIENT}: ${item.title}`);
    } catch (err) {
        console.error('Error sending analysis email:', err.message);
    }
}

async function main() {
    const feeds = await readFeeds('feeds.txt');
    console.log(`Found ${feeds.length} feeds.`);

    const results = await Promise.all(feeds.map(feed => fetchNews(feed)));
    const allNews = results.flat();

    const todaysNews = allNews.filter(item => item.url && isToday(item.date));

    const seenUrls = loadSeen();
    const newNews = todaysNews.filter(item => !seenUrls.has(item.url));

    if (newNews.length === 0) {
        console.log('No new news found today.');
        return;
    }

    console.log(`\n--- ${newNews.length} new news item(s) today (${formatDateDMY(new Date())}) ---\n`);
    newNews.forEach((item, index) => {
        console.log(`${index + 1}. [${item.source}] ${item.title}`);
        // console.log(item);
        console.log(`   ${item.url}\n`);
    });

    const analysisText = await analyzeWithGemini(newNews);
    if (analysisText) {
        const analysisItems = parseAnalysisItems(analysisText);
        for (const item of analysisItems) {
            await sendAnalysisItemEmail(item);
        }
    }

    newNews.forEach(item => seenUrls.add(item.url));
    saveSeen(seenUrls);
}

let isRunning = false;

async function runMain() {
    if (isRunning) {
        console.warn('Previous run still in progress, skipping this tick.');
        return;
    }
    isRunning = true;
    try {
        await main();
    } catch (err) {
        console.error('Error during run:', err);
    } finally {
        isRunning = false;
    }
}

runMain();
setInterval(runMain, RUN_INTERVAL_MS);
