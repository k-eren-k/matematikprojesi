const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// View Engine Ayarları
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.static('public'));

mongoose.connect('mongodb+srv://mongo:mongo@cluster0.6us6keo.mongodb.net/?retryWrites=true&w=majority');

const UserSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationCode: String,
    verificationCodeExpires: Date
});

const User = mongoose.model('User', UserSchema);

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Email Verification',
        text: `Your verification code is: ${code}. It expires in 30 seconds.`
    };
    await transporter.sendMail(mailOptions);
}

// Sayfa Yönlendirmeleri
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// Register API
app.post('/api/register', async (req, res) => {
    try {
        if (req.body.password !== req.body.confirmPassword) {
            return res.status(400).json({ error: "Passwords do not match." });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const verificationCode = generateVerificationCode();
        const verificationCodeExpires = new Date(Date.now() + 30 * 1000);

        const existingUser = await User.findOne({ email: req.body.email });
        if (existingUser) {
            return res.status(400).json({ error: "Email already registered." });
        }

        const user = new User({
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            username: req.body.username,
            email: req.body.email,
            password: hashedPassword,
            verificationCode: verificationCode,
            verificationCodeExpires: verificationCodeExpires
        });

        await user.save();
        await sendVerificationEmail(req.body.email, verificationCode);
        res.json({ success: true, message: 'Verification code sent to email.' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Login API
app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        if (!user.isVerified) return res.status(401).json({ error: 'Email not verified.' });

        const valid = await bcrypt.compare(req.body.password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        res.status(500).json({ error: "Login failed due to an unexpected error." });
    }
});

// Socket.IO - Çizim Verilerini Paylaşma
io.on('connection', (socket) => {
    socket.on('draw', (data) => {
        socket.broadcast.emit('draw', data);
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));
