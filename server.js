// Local run: `npm start` (reads .env). On Vercel, api/index.js is used instead.
require("dotenv").config();
const path = require('path');
const app = require('./app');
const PORT = process.env.PORT || 3000;

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🏫 School Management System running at http://localhost:${PORT}\n`);
});
