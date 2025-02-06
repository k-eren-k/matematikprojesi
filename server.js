require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const http = require('http');
const axios = require('axios');
const chalk = require('chalk');
const { Server } = require("socket.io");
const MongoStore = require('connect-mongo'); // Use connect-mongo for session storage


const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
    username: { type: String, unique: true, required: true, trim: true }, // Trim whitespace
    email: { type: String, unique: true, required: true, trim: true, lowercase: true }, // Trim and lowercase email
    password: { type: String, required: true },
    verified: { type: Boolean, default: false },
    verificationCode: String,
    resetPasswordToken: String, // Add a field for password reset tokens
    resetPasswordExpires: Date  // And a field for token expiry
});

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // Ensure this is correctly serving your static files.

// Session configuration using connect-mongo
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        httpOnly: true, // Prevent client-side JavaScript access
        sameSite: 'lax' // CSRF protection
    },
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI
    })
}));

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail', // Or your email provider
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    // Add TLS options for better security (STARTTLS)
    tls: {
        rejectUnauthorized: false // Consider removing this in production and properly configuring certificates
    }
});

// Middleware: Authentication Check
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

// --- Routes ---

app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/board');
    }
    res.render('register'); // Or a landing page
});

app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.render('register', { error: 'All fields are required' });
        }

        // Basic input validation (add more as needed)
        if (password.length < 8) {
            return res.render('register', { error: 'Password must be at least 8 characters long' });
        }

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.render('register', { error: 'Username or email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationCode = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); // Longer, more secure code

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
                text: `Your verification code is: ${verificationCode}`,
                html: `<p>Your verification code is: <strong>${verificationCode}</strong></p>` // Use HTML for a better email
            });
        } catch (emailError) {
            console.error("Email sending failed:", emailError);
            // BEST PRACTICE: Don't delete the user.  Allow them to request a new verification email.
            return res.render('register', { error: 'Registration successful, but verification email failed.  Please request a new code.' });
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
        user.verificationCode = undefined; // Clear the code
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
        const user = await User.findOne({ email: email.toLowerCase() }); // Use lowercase for email comparison

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
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.redirect('/login');
    });
});

app.get('/board', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            console.error("User not found.");
            return res.redirect('/login');
        }
        res.render('board', { user: { username: user.username } }); // Pass only necessary user data
    } catch (error) {
        console.error("Whiteboard fetch error:", error);
        res.redirect('/login'); // Or a more specific error page
    }
});

// Add a route for requesting a new verification code
app.get('/resend-verification', (req, res) => {
    res.render('resend'); // Create a resend.ejs view
});

app.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            return res.render('resend', { error: 'Email not found.' });
        }

        if (user.verified) {
            return res.render('resend', { error: 'Email is already verified.' });
        }

        // Generate a new verification code
        const newVerificationCode = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        user.verificationCode = newVerificationCode;
        await user.save();

        // Send the new code
        await transporter.sendMail({
            to: email,
            subject: 'New Verification Code',
            text: `Your new verification code is: ${newVerificationCode}`,
            html: `<p>Your new verification code is: <strong>${newVerificationCode}</strong></p>`
        });

        res.render('resend', { success: 'A new verification code has been sent.' }); // Use a success message

    } catch (error) {
        console.error("Resend verification error:", error);
        res.render('resend', { error: 'Failed to resend verification code.' });
    }
});

// Add password reset routes
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password'); // Create a forgot-password.ejs view
});

app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            // Don't reveal whether the email exists for security reasons.
            return res.render('forgot-password', { success: 'If an account with that email exists, a password reset link has been sent.' });
        }

        const token = crypto.randomBytes(32).toString('hex'); // Generate a secure random token
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // Token expires in 1 hour
        await user.save();

         await transporter.sendMail({
            to: email,
            subject: 'Password Reset',
            html: `<p>You are receiving this because you (or someone else) have requested the reset of the password for your account.</p>
                   <p>Please click on the following link, or paste this into your browser to complete the process:</p>
                   <p><a href="<span class="math-inline">\{req\.protocol\}\://</span>{req.get('host')}/reset-password/${token}">Reset Password</a></p>
                   <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>`
        });
        res.render('forgot-password', { success: 'If an account with that email exists, a password reset link has been sent.' });

    } catch (error) {
        console.error("Forgot password error:", error);
        res.render('forgot-password', { error: 'Failed to request password reset.' });
    }
});

app.get('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() } // Check if the token is still valid
        });

        if (!user) {
            return res.render('reset-password', { error: 'Password reset token is invalid or has expired.' }); // Create reset-password.ejs
        }

        res.render('reset-password', { token }); // Pass the token to the view
    } catch (error) {
        console.error("Reset password error:", error);
        res.render('reset-password', { error: 'Failed to access password reset page.' });
    }
});


app.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.render('reset-password', { error: 'Password reset token is invalid or has expired.' });
        }

        // Validate new password (e.g., length, complexity)
        if (password)// Validate new password (e.g., length, complexity)
            if (password.length < 8) {
                return res.render('reset-password', { error: 'Password must be at least 8 characters long.', token });
            }
    
            const hashedPassword = await bcrypt.hash(password, 10);
            user.password = hashedPassword;
            user.resetPasswordToken = undefined; // Clear the token
            user.resetPasswordExpires = undefined; // Clear the expiry
            await user.save();
    
            res.redirect('/login'); // Redirect to login after successful password reset
    
        } catch (error) {
            console.error("Reset password error:", error);
            res.render('reset-password', { error: 'Failed to reset password.', token });
        }
    });
    // --- WebSocket / Socket.IO ---
    const crypto = require('crypto'); // For generating secure random IDs
    
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
    
        if (!userId) {
            console.error('Connection request without userId. Disconnecting.');
            socket.disconnect(); // Disconnect unauthorized connections
            return;
        }
    
        console.log(`Client connected: userId: ${userId}, socketId: ${socket.id}`);
        socket.join(userId);
    
        socket.on('drawing', (message) => {
            //  console.log("Received drawing message:", message); // Debugging
            socket.to(userId).emit('drawing', message);
        });
    
        socket.on('chat', (message) => {
            socket.to(userId).emit('chat', message);
        });
    
        socket.on('disconnect', () => {
            console.log(`Client disconnected: userId: ${userId}, socketId: ${socket.id}`);
        });
    
        socket.on('error', (error) => {
            console.error('Socket.IO error:', error);
        });
    });
    // --- Chatbot (Hugging Face) ---
    
    async function getHuggingFaceResponse(userMessage) {
        try {
            const response = await axios.post(
                "https://api-inference.huggingface.co/models/google/flan-t5-base",
                {
                    inputs: userMessage,
                    parameters: {
                        max_length: 100,
                        temperature: 0.7,
                        top_p: 0.9,
                        repetition_penalty: 1.2,
                        wait_for_model: true // Ensure model is loaded
                    },
                  options: {
                      wait_for_model: true // Wait for the model to load (important!)
                  }
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
    
            if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].generated_text) {
                return response.data[0].generated_text;
            } else {
                console.error("Invalid response from Hugging Face API:", response.data);
                return "Sorry, I encountered an error. Please try again.";
            }
    
        } catch (error) {
            console.error("Hugging Face API error:", error);
            if (error.response) {
                console.error("Hugging Face API Error Details:", error.response.status, error.response.data);
            }  else if (error.request) {
              console.error("No response received from Hugging Face API");
            }
            return "Sorry, I'm currently unable to chat.";
        }
    }
    
    
    app.post('/chat', async (req, res) => {
        try {
            const userMessage = req.body.message;
            const botReply = await getHuggingFaceResponse(userMessage);
            res.json({ reply: botReply });
        } catch (error) {
             console.error("Chat interaction error:", error); // Log the error
            res.status(500).json({ error: 'Chat interaction failed' });
        }
    });
    
    // --- Server Startup (with Animation) ---
    
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
    
    // Use dynamic import for ansi-escapes
    import('ansi-escapes').then((ansiModule) => {
        const serverStartAnimation = async (ansi) => {
            console.clear();
            console.log(ansi.cursorHide);
    
            let frame = 0;
            const colors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
            let colorIndex = 0;
    
            // Rocket animation frames
            const rocketFrames = [
                ["    🚀    "],
                ["   🚀🔥   "],
                ["  🚀 🔥  ", "   🔥   "], // Two-line
                [" 🚀  🔥 ", "  🔥 🔥  "],
                ["🚀   🔥 ", " 🔥 🔥 🔥 "],
                ["✨  🚀 ", "✨🔥 🔥🔥✨"],
                ["✨ ✨🚀", "✨🔥 🔥🔥✨"],
                ["✨ ✨ ", "🚀🔥 🔥🔥✨"], // Rocket moves up
                ["✨ ✨ ", " 🔥🔥 🔥 ✨"],
                ["✨ ✨ ", " 🔥🔥 ✨ "], // Fading
                ["✨ ✨ ", "  ✨   "],
                ["✨  ", "      "],
                ["   ", "      "],
                ["   ", "      "], // Disappears
            ];
    
    
            const animationSpeed = 120;
            const totalFrames = 45;
    
            const animationInterval = setInterval(() => {
                console.clear();
    
                // Colorful, flashing ASCII Art
                console.log(chalk[colors[colorIndex % colors.length]].bold(asciiArt));
    
                // Moving, colorful line
                const line = chalk.hsl(frame * 5, 100, 50)("=".repeat(Math.min(frame * 1.5, 60)));
                console.log(line);
    
    
                // Advanced Rocket Animation (multiple lines)
                let rocketFrame = rocketFrames[Math.min(frame, rocketFrames.length - 1)];
                rocketFrame.forEach(line => {
                    console.log(" ".repeat(25 - Math.min(frame, 25)) + chalk.yellow(line));
                });
    
                // Loading message (flashing, colorful)
                const loadingText = "Server Preparing";
                let dots = "";
                for (let i = 0; i < (frame % 4); i++) {
                    dots += ".";
                }
                const loadingMessage = chalk.rgb(255, 165 + 90 * Math.sin(frame * 0.1), 0).bold(loadingText + dots);
                console.log(loadingMessage);
    
                // Progress bar (gradient)
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
    
                // Important Information (animated)
                if (frame >= totalFrames - 10) {
                    const infoColor = chalk.hsl((frame * 10) % 360, 100, 50);
                    console.log(infoColor.bold("🔑 Port:"), chalk.white(PORT));
                    console.log(infoColor.bold("🔗 Link:"), chalk.white(`http://localhost:${PORT}`)); // Corrected the link
                }
    
                console.log(chalk.hsl(360 - (frame * 5), 100, 50)(line));
    
                frame++;
                colorIndex = (colorIndex + 1) % colors.length;
    
                if (frame > totalFrames) {
                    clearInterval(animationInterval);
                    console.log(ansi.cursorShow);
                    console.log(chalk.greenBright.bold("\n🚀 Server started successfully! 🚀\n"));
                    console.log(serverStartText);
                    console.log(chalk.cyanBright.bold("✨ Let your creativity flow! ✨\n"));
                }
            }, animationSpeed);
        };
    
        server.listen(PORT, () => serverStartAnimation(ansiModule));
    
    }).catch(err => {
        console.error("Failed to load ansi-escapes:", err);
        process.exit(1);
    });
