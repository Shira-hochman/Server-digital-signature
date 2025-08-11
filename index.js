const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ CORS עבור לוקאלי ו־Render
const allowedOrigins = [
  'http://localhost:3000',
  'https://my-client.onrender.com', // החליפי לכתובת האמיתית של הקליינט
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
if (!fs.existsSync(UPLOAD_FOLDER)) fs.mkdirSync(UPLOAD_FOLDER);

app.use('/files', express.static(UPLOAD_FOLDER));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, fileId + ext);
  },
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא התקבל קובץ' });

  const fileId = path.parse(req.file.filename).name;
  const baseUrl = req.headers.origin || `https://my-client.onrender.com`; // תחליף אם צריך
  const shareLink = `${baseUrl}/sign/${fileId}`;

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

  try {
    const files = fs.readdirSync(UPLOAD_FOLDER);
    const fileName = files.find(f => path.parse(f).name === fileId);

    if (!fileName || !fileName.endsWith('.docx')) {
      return res.status(404).json({ error: 'קובץ docx לא נמצא' });
    }

    const filePath = path.join(UPLOAD_FOLDER, fileName);
    const content = fs.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.setData({ signerName });
    doc.render();
    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    fs.writeFileSync(filePath, buf);

    const mailOptions = {
      from: process.env.EMAIL_ADDRESS,
      to: process.env.EMAIL_ADDRESS,
      subject: `המסמך נחתם על ידי: ${signerName}`,
      html: `<p>מצורף המסמך החתום.</p>`,
      attachments: [{ filename: fileName, path: filePath }],
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: `הקובץ נחתם ונשלח בהצלחה על ידי ${signerName}` });
  } catch (error) {
    console.error('שגיאה:', error);
    res.status(500).json({ error: 'שגיאה: ' + error.message });
  }
});

app.get('/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  const files = fs.readdirSync(UPLOAD_FOLDER);
  const fileName = files.find(f => path.parse(f).name === fileId);

  if (!fileName) return res.status(404).send('קובץ לא נמצא');

  const filePath = path.join(UPLOAD_FOLDER, fileName);
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`✅ השרת רץ על פורט ${PORT}`);
});
