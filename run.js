var spawn = require('child_process').spawn;
// spawn('node', ['index.js'], {
//     detached: true
// });

spawn('node', ['index.js', 'gemini'],
    { stdio: 'ignore', detached: true }).unref()