const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

    fs.writeFileSync(outputFile, outputHtml);
    console.log(`Summaries saved to ${outputFile}`);
}

main();
