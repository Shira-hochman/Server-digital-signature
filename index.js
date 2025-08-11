const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs').promises; // שימוש בגרסה האסינכרונית
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// הגדרות CORS
const allowedOrigins = [
  'http://localhost:3000',
  'https://client-digital-signature-x7xa.vercel.app',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const UPLOAD_FOLDER = path.join(__dirname, 'uploads');

// בדיקה אם התיקייה קיימת, אם לא - יוצר אותה
(async () => {
  try {
    await fs.mkdir(UPLOAD_FOLDER, { recursive: true });
  } catch (error) {
    console.error('Failed to create uploads directory:', error);
  }
})();

app.use('/files', express.static(UPLOAD_FOLDER));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, fileId + ext);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.docx') {
      return cb(new Error('יש להעלות קובץ מסוג docx בלבד'), false);
    }
    cb(null, true);
  },
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'לא התקבל קובץ או שהפורמט אינו נתמך (יש להעלות קובץ docx).' });
  }

  const fileId = path.parse(req.file.filename).name;
const shareLink = `https://client-digital-signature-x7xa.vercel.app/sign/${fileId}`;

  res.json({ message: 'הקובץ התקבל', shareLink });
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_ADDRESS,
    pass: process.env.EMAIL_PASSWORD,
  },
});

app.post('/sign/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const { signerName } = req.body;

  if (!signerName) {
    return res.status(400).json({ error: 'חסר שם חתימה' });
  }

  let filePath;
  try {
    const files = await fs.readdir(UPLOAD_FOLDER);
    const fileName = files.find(f => path.parse(f).name === fileId && f.endsWith('.docx'));

    if (!fileName) {
      return res.status(404).json({ error: 'קובץ docx לא נמצא' });
    }

    filePath = path.join(UPLOAD_FOLDER, fileName);
    const content = await fs.readFile(filePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.setData({ signerName });
    doc.render();
    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    await fs.writeFile(filePath, buf);

    const mailOptions = {
      from: process.env.EMAIL_ADDRESS,
      to: process.env.EMAIL_ADDRESS,
      subject: `המסמך נחתם על ידי: ${signerName}`,
      html: `<p>מצורף המסמך החתום.</p>`,
      attachments: [{ filename: fileName, path: filePath }],
    };

    await transporter.sendMail(mailOptions);
    await fs.unlink(filePath); // מחיקת הקובץ לאחר השליחה

    res.json({ message: `הקובץ נחתם ונשלח בהצלחה על ידי ${signerName}` });
  } catch (error) {
    console.error('שגיאה:', error);
    res.status(500).json({ error: 'אירעה שגיאה בשרת. אנא נסה שוב מאוחר יותר.' });
  }
});

app.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;
  try {
    const files = await fs.readdir(UPLOAD_FOLDER);
    const fileName = files.find(f => path.parse(f).name === fileId);

    if (!fileName) {
      return res.status(404).send('קובץ לא נמצא');
    }

    const filePath = path.join(UPLOAD_FOLDER, fileName);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).send('שגיאה בשרת');
  }
});

app.listen(PORT, () => {
  console.log(`✅ השרת רץ על פורט ${PORT}`);
});