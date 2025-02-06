require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const http = require('http');
//const msgpack = require('msgpack-lite'); // Artık kullanılmıyor
const axios = require('axios');
const chalk = require('chalk');
const { Server } = require("socket.io"); // Socket.IO'yu import et


const app = express();
const server = http.createServer(app);
const io = new Server(server); // Socket.IO sunucusunu oluştur

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 50000,
        connectTimeoutMS: 50000,
    })
    .then(() => console.log('MongoDB connected'))
    .catch(error => {
        console.error('Database connection error:', error);
        process.exit(1);
    });

// User Schema
const User = mongoose.model('User', {
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    verified: { type: Boolean, default: false },
    verificationCode: String
});

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // JSON body parser'ı ekle
app.use(express.static('public')); // Eğer public klasörünüz varsa
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Middleware: Authentication Check
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

// Routes
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/board');
    }
    res.render('register');
});

app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.render('register', { error: 'All fields are required' });
        }

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.render('register', { error: 'Username or email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationCode = Math.random().toString(36).substring(2, 15);

        const user = new User({
            username,
            email,
            password: hashedPassword,
            verificationCode
        });
        await user.save();

        try {
            await transporter.sendMail({
                to: email,
                subject: 'Email Verification',
                text: `Your verification code is: ${verificationCode}`
            });
        } catch (emailError) {
            console.error("Email sending failed:", emailError);
            return res.render('register', { error: 'Registration successful, but verification email failed. Please try again later.' });
        }

        res.redirect('/verify');
    } catch (error) {
        console.error("Registration error:", error);
        res.render('register', { error: 'Registration failed' });
    }
});

app.get('/verify', (req, res) => {
    res.render('verify');
});

app.post('/verify', async (req, res) => {
    try {
        const { code } = req.body;
        const user = await User.findOne({ verificationCode: code, verified: false });

        if (!user) {
            return res.render('verify', { error: 'Invalid verification code' });
        }
        user.verified = true;
        user.verificationCode = undefined;
        await user.save();

        req.session.userId = user._id;
        res.redirect('/board');
    } catch (error) {
        console.error("Verification error:", error);
        res.render('verify', { error: 'Verification failed' });
    }
});

app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/board');
    }
    res.render('login');
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.render('login', { error: 'Invalid credentials' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.render('login', { error: 'Invalid credentials' });
        }

        if (!user.verified) {
            return res.render('login', { error: 'Please verify your email first' });
        }

        req.session.userId = user._id;
        res.redirect('/board');
    } catch (error) {
        console.error("Login error:", error);
        res.render('login', { error: 'Login failed' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).send('Logout failed');
        }
        res.redirect('/login');
    });
});

app.get('/board', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
         if (!user) {
            console.error("Kullanıcı bulunamadı.");
            return res.redirect('/login'); // veya uygun bir hata sayfasına
        }
        res.render('board', { user });
    } catch (error) {
        console.error("Whiteboard fetch error:", error);
        res.redirect('/login');
    }
});

const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Bağlı istemcileri ve kullanıcı ID'lerini saklamak için bir Map kullan
const clients = new Map();

// Socket.IO bağlantılarını yönet
io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;

    if (!userId) {
        console.error('Bağlantı isteğinde userId bulunamadı.');
        socket.disconnect(); // Kullanıcı ID'si yoksa bağlantıyı kes
        return;
    }

    console.log(`Yeni bir istemci bağlandı. userId: ${userId}, socketId: ${socket.id}`);

    // Kullanıcıyı kendi ID'sine sahip bir odaya ekle
    socket.join(userId);

    socket.on('drawing', (message) => {
      //  console.log("Alınan çizim mesajı:", message); //Hata ayıklama
        // Aynı odadaki (aynı userId'ye sahip) diğer istemcilere gönder
        socket.to(userId).emit('drawing', message);
    });

    socket.on('chat', (message) => {
        //Sohbet mesajlarını aynı odadaki kullanıcılara gönder
        socket.to(userId).emit('chat', message);
    });

    socket.on('disconnect', () => {
        console.log(`Bir istemci bağlantısı kapandı. userId: ${userId}, socketId: ${socket.id}`);
    });

      socket.on('error', (error) => {
        console.error('Socket.IO hatası:', error);
    });
});

console.log('WebSocket sunucusu 8080 portunda çalışıyor.');
const PORT = process.env.PORT || 3000;

const asciiArt = chalk.cyanBright.bold`
  _____                       _
 |  __ \\                     | |
 | |__) |___ _ __   ___  _ __| |_ ___ _ __
 |  _  // _ \\ '_ \\ / _ \\| '__| __/ _ \\ '__|
 | | \\ \\  __/ |_) | (_) | |  | ||  __/ |
 |_|  \\_\\___| .__/ \\___/|_|   \\__\\___|_|
            | |
            |_|
`;

const serverStartText = chalk.yellowBright`
  ██████╗  █████╗ ███████╗██╗  ██╗███████╗
  ██╔══██╗██╔══██╗██╔════╝██║  ██║██╔════╝
  ██████╔╝███████║███████╗███████║█████╗
  ██╔══██╗██╔══██║╚════██║██╔══██║██╔══╝
  ██║  ██║██║  ██║███████║██║  ██║███████╗
  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝
`;

// ansi-escapes'i dinamik import ile yükle
import('ansi-escapes').then((ansiModule) => {
    const serverStartAnimation = async (ansi) => {
        console.clear();
        console.log(ansi.cursorHide);

        let frame = 0;
        const colors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
        let colorIndex = 0;

        // Daha karmaşık roket animasyonu
        const rocketFrames = [
            ["    🚀    "],
            ["   🚀🔥   "],
            ["  🚀 🔥  ", "   🔥   "], // İki satırlı
            [" 🚀  🔥 ", "  🔥 🔥  "],
            ["🚀   🔥 ", " 🔥 🔥 🔥 "],
            ["✨  🚀 ", "✨🔥 🔥🔥✨"],
            ["✨ ✨🚀", "✨🔥 🔥🔥✨"],
            ["✨ ✨ ", "🚀🔥 🔥🔥✨"], // Roket yukarı
            ["✨ ✨ ", " 🔥🔥 🔥 ✨"],
            ["✨ ✨ ", " 🔥🔥 ✨ "], // Sönümleniyor
            ["✨ ✨ ", "  ✨   "],
            ["✨  ", "      "],
            ["   ", "      "],
            ["   ", "      "], // Kayboluyor
        ];


        const animationSpeed = 120;
        const totalFrames = 45;

        const animationInterval = setInterval(() => {
            console.clear();

            // Renkli, yanıp sönen ASCII Art
            console.log(chalk[colors[colorIndex % colors.length]].bold(asciiArt));

            // İlerleyen, renkli çizgi
            const line = chalk.hsl(frame * 5, 100, 50)("=".repeat(Math.min(frame * 1.5, 60)));
            console.log(line);


            // Gelişmiş Roket Animasyonu (birden fazla satır)
            let rocketFrame = rocketFrames[Math.min(frame, rocketFrames.length - 1)];
            rocketFrame.forEach(line => {
                console.log(" ".repeat(25 - Math.min(frame, 25)) + chalk.yellow(line));
            });

            // Yükleniyor mesajı (yanıp sönen, renkli)
            const loadingText = "Sunucu Hazırlanıyor";
            let dots = "";
            for (let i = 0; i < (frame % 4); i++) {
                dots += ".";
            }
            const loadingMessage = chalk.rgb(255, 165 + 90 * Math.sin(frame * 0.1), 0).bold(loadingText + dots);
            console.log(loadingMessage);

            // İlerleme çubuğu (gradyan)
            const progress = Math.min(frame / (totalFrames - 5), 1);
            const progressBarLength = 30;
            const filledLength = Math.round(progress * progressBarLength);
            const emptyLength = progressBarLength - filledLength;
            let progressBar = "";
            for (let i = 0; i < filledLength; i++) {
                progressBar += chalk.bgHsl(i * (120 / progressBarLength), 100, 50)(" ");
            }
            progressBar += chalk.bgGray(" ".repeat(emptyLength));
            console.log(`[${progressBar}] ${Math.round(progress * 100)}%`);

            // Önemli Bilgiler (animasyonlu)
            if (frame >= totalFrames - 10) {
                const infoColor = chalk.hsl((frame * 10) % 360, 100, 50);
                console.log(infoColor.bold("🔑 Port:"), chalk.white(PORT));console.log(infoColor.bold("🔗 Bağlantı:"), chalk.white(`http://localhost:${PORT}`));
            }

            console.log(chalk.hsl(360 - (frame * 5), 100, 50)(line));

            frame++;
            colorIndex = (colorIndex + 1) % colors.length;

            if (frame > totalFrames) {
                clearInterval(animationInterval);
                console.log(ansi.cursorShow);
                console.log(chalk.greenBright.bold("\n🚀 Sunucu başarıyla başlatıldı! 🚀\n"));
                console.log(serverStartText);
                console.log(chalk.cyanBright.bold("✨ Yaratıcılığınızı konuşturun! ✨\n"));
            }
        }, animationSpeed);
    };

    server.listen(PORT, () => serverStartAnimation(ansiModule));


}).catch(err => {
    console.error("ansi-escapes yüklenemedi:", err);
    process.exit(1);
});

// Hugging Face Inference API için yardımcı fonksiyon
async function getHuggingFaceResponse(userMessage) {
    try {
        const response = await axios.post(
            "https://api-inference.huggingface.co/models/google/flan-t5-base",  // Daha iyi ve güncel bir model
            {
                inputs: userMessage,
                parameters: {
                    // İsteğe bağlı parametreler (modelin davranışını ayarlamak için)
                    max_length: 100,  // Üretilecek maksimum token sayısı
                    temperature: 0.7, // Daha yaratıcı/çeşitli cevaplar için (0.1 - 1.0 arası)
                    top_p: 0.9,      // En olası token'ların %90'ı arasından seçim yap
                    repetition_penalty: 1.2, // Tekrar eden kelimeleri azalt (1.0'dan büyük değerler)
                    wait_for_model: true, // Modelin yüklenmesini bekle (ilk istekte daha yavaş olabilir)
                },
              options: {
                wait_for_model: true, // Model yüklenene kadar bekle
               },
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Hugging Face'in cevabı genellikle bir dizi içinde gelir.
        if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].generated_text) {
            return response.data[0].generated_text;
        } else {
             console.error("Hugging Face API'sinden geçersiz yanıt:", response.data);  //Hata ayıklama
             return "Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin."; // Veya uygun bir hata mesajı
        }


    } catch (error) {
        console.error("Hugging Face API error:", error);
         if (error.response) {
            console.error(error.response.status, error.response.data); // Daha detaylı hata mesajı
        }
        return "Üzgünüm, şu anda sohbet botuyla iletişim kurulamıyor."; // Kullanıcıya hata mesajı
    }
}


// Chat endpoint'i (Hugging Face Inference API ile)
app.post('/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const botReply = await getHuggingFaceResponse(userMessage); // Yardımcı fonksiyonu çağır
        res.json({ reply: botReply });
    } catch (error) {
        // getHuggingFaceResponse zaten hata mesajı döndürüyor, burada tekrar işlemeye gerek yok.
        res.status(500).json({ error: 'Chat interaction failed' });
    }
});
