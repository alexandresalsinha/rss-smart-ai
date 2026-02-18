const fs = require('fs');
const Parser = require('rss-parser');
const ExcelJS = require('exceljs');
require('dotenv').config();
const OpenAI = require('openai');

const parser = new Parser();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

function exportToHTML(analysisText, htmlFile) {
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Top News Analysis</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background-color: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }
        h1 {
            text-align: center;
            color: #667eea;
            margin-bottom: 10px;
            font-size: 2.5em;
        }
        .date {
            text-align: center;
            color: #666;
            font-size: 0.95em;
            margin-bottom: 30px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 15px;
        }
        .analysis-content {
            white-space: pre-wrap;
            word-wrap: break-word;
            font-size: 1em;
            line-height: 1.8;
        }
        .article {
            margin-bottom: 30px;
            padding: 20px;
            background-color: #f5f5f5;
            border-left: 4px solid #667eea;
            border-radius: 4px;
        }
        a {
            color: #667eea;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: #999;
            font-size: 0.9em;
            border-top: 1px solid #ddd;
            padding-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📰 Top News of the Day</h1>
        <div class="date">Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        <div class="analysis-content">${analysisText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        <div class="footer">Analysis powered by OpenAI GPT-4</div>
    </div>
</body>
</html>
    `;

    fs.writeFileSync(htmlFile, htmlContent);
    console.log(`Analysis saved to ${htmlFile}`);
}

async function analyzeWithOpenAI(newsItems) {
    if (!process.env.OPENAI_API_KEY) {
        console.warn('Skipping OpenAI analysis: OPENAI_API_KEY not found in .env');
        return;
    }

    console.log('Analyzing news with OpenAI to find the Top 10...');

    // Prepare a simplified list for the prompt to save tokens
    const newsList = newsItems.map((item, index) => `${index + 1}. ${item.title} (${item.date.toISOString().split('T')[0]}) - ${item.url}`).join('\n');

    const prompt = `
    Here is a list of news headlines from today:
    ${newsList}

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

    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            // model: 'gpt-4o',
            model: 'gpt-4o',
        });

        const analysisResult = completion.choices[0].message.content;
        console.log('\n--- Top 20 News of the Day ---\n');
        console.log(analysisResult);
        console.log('\n------------------------------\n');

        const analysisFile = 'top_news_analysis.txt';
        fs.writeFileSync(analysisFile, analysisResult);
        console.log(`Analysis saved to ${analysisFile}`);

        // Export to HTML
        const htmlFile = 'top_news_analysis.html';
        exportToHTML(analysisResult, htmlFile);

    } catch (err) {
        console.error('Error during OpenAI analysis:', err.message);
    }
}

async function main() {
    const feeds = await readFeeds('feeds.txt');
    console.log(`Found ${feeds.length} feeds.`);

    let allNews = [];
    for (const feed of feeds) {
        console.log(`Fetching ${feed}...`);
        const news = await fetchNews(feed);
        allNews = allNews.concat(news);
    }

    const todaysNews = allNews.filter(item => isToday(item.date));
    console.log(`Found ${todaysNews.length} news items from today.`);

    await exportToExcel(todaysNews, 'news_today.xlsx');

    if (todaysNews.length > 0) {
        await analyzeWithOpenAI(todaysNews);
    } else {
        console.log('No news from today to analyze.');
    }
}

main();
