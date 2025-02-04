const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// Kullanıcının oturum açıp açmadığını kontrol et
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = 'login.html';
} else {
    // JWT'den kullanıcı adını al
    const tokenPayload = JSON.parse(atob(token.split('.')[1]));
    const username = tokenPayload.username;
    document.getElementById('username').textContent = username;
}

let isDrawing = false;
let currentColor = 'black';
let currentLineWidth = 5;
let currentTool = 'pencil'; // Varsayılan araç

// Araç seçimi
document.getElementById('pencilTool').addEventListener('click', () => {
    currentTool = 'pencil';
    selectTool('pencilTool');
});
document.getElementById('brushTool').addEventListener('click', () => {
    currentTool = 'brush';
    selectTool('brushTool');
});
document.getElementById('highlighterTool').addEventListener('click', () => {
    currentTool = 'highlighter';
    selectTool('highlighterTool');
});
document.getElementById('eraserTool').addEventListener('click', () => {
    currentTool = 'eraser';
    selectTool('eraserTool');
});

// Boyut kontrolü
const lineWidthRange = document.getElementById('lineWidthRange');
lineWidthRange.addEventListener('input', () => {
    currentLineWidth = lineWidthRange.value;
});

// Çizgi yumuşatma için geçmiş noktaları sakla
const lastPoints = [];
const smoothingRadius = 5;

// Canvas boyutunu ayarla
function resizeCanvas() {
    canvas.width = window.innerWidth * 0.8;
    canvas.height = window.innerHeight * 0.8;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Basınca duyarlılık için yardımcı fonksiyon (güncellenmiş)
function calculateLineWidth(speed) {
    if (currentTool === 'pencil') {
        const minWidth = 1;
        const maxWidth = 10;
        const minSpeed = 0;
        const maxSpeed = 500;
        const normalizedSpeed = Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)));
        const lineWidth = maxWidth - (maxWidth - minWidth) * normalizedSpeed;
        return lineWidth;
    } else if (currentTool === 'brush') {
        // Fırça için farklı bir boyutlandırma kullan
        const minWidth = 5;
        const maxWidth = 25;
        const minSpeed = 0;
        const maxSpeed = 500;
        const normalizedSpeed = Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)));
        const lineWidth = maxWidth - (maxWidth - minWidth) * normalizedSpeed;
        return lineWidth;
    } else if (currentTool === 'highlighter') {
        // Fosforlu kalem için sabit bir boyut kullan
        return 15;
    } else {
        return currentLineWidth;
    }
}

// Çizim olayları
canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const x = e.offsetX;
    const y = e.offsetY;
    lastPoints.push({ x, y, time: Date.now() });
    ctx.beginPath();
    ctx.moveTo(x, y);
});

canvas.addEventListener('mousemove', (e) => {
    if (isDrawing) {
        const newPoint = { x: e.offsetX, y: e.offsetY, time: Date.now() };
        lastPoints.push(newPoint);

        const controlPoints = calculateControlPoints(lastPoints);

        if (lastPoints.length > 1) {
            const distance = Math.sqrt(
                Math.pow(lastPoints[lastPoints.length - 1].x - lastPoints[0].x, 2) +
                Math.pow(lastPoints[lastPoints.length - 1].y - lastPoints[0].y, 2)
            );
            const timeDiff = lastPoints[lastPoints.length - 1].time - lastPoints[0].time;
            const speed = timeDiff > 0 ? distance / timeDiff * 100 : 0;
            currentLineWidth = calculateLineWidth(speed);
        }

        drawLine(controlPoints);

        socket.emit('draw', { points: controlPoints, color: currentColor, lineWidth: currentLineWidth, tool: currentTool });
    }
});

canvas.addEventListener('mouseup', () => {
    isDrawing = false;
    ctx.closePath();
    lastPoints.length = 0;
});

canvas.addEventListener('mouseleave', () => {
    isDrawing = false;
    ctx.closePath();
    lastPoints.length = 0;
});

// Çizgiyi çiz (güncellenmiş)
function drawLine(points) {
    if (points.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = currentLineWidth;
    } else if (currentTool === 'highlighter'){
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(255, 255, 0, 0.4)`;
        ctx.lineWidth = currentLineWidth;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentLineWidth;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 2; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.quadraticCurveTo(points[points.length - 2].x, points[points.length - 2].y, points[points.length - 1].x, points[points.length - 1].y);

    ctx.stroke();
}

// Kontrol noktalarını hesapla
function calculateControlPoints(points) {
    if (points.length < 3) {
        return points;
    }

    const controlPoints = [];
    for (let i = 0; i < points.length; i++) {
        if (i == 0 || i == points.length - 1) {
            controlPoints.push(points[i]);
        } else {
            const p0 = points[i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const controlPoint = {
                x: p1.x,
                y: p1.y,
                time: p1.time
            };
            controlPoints.push(controlPoint);
        }
    }
    return controlPoints;
}

// Diğer kullanıcılardan gelen çizim verilerini al (güncellenmiş)
socket.on('draw', (data) => {
    const { points, color, lineWidth, tool } = data;
    const originalColor = currentColor;
    const originalLineWidth = currentLineWidth;
    const originalTool = currentTool;

    currentColor = color;
    currentLineWidth = lineWidth;
    currentTool = tool;

    drawLine(points);

    // Geri yükle
    currentColor = originalColor;
    currentLineWidth = originalLineWidth;
    currentTool = originalTool;
});

// Renk seçimi
const colorBoxes = document.querySelectorAll('.color-box');
colorBoxes.forEach(box => {
    box.addEventListener('click', () => {
        if (currentTool !== 'eraser') {
            currentColor = box.dataset.color;
        }
        colorBoxes.forEach(b => b.classList.remove('selected'));
        box.classList.add('selected');
    });
});

// Geri butonu
document.getElementById('backButton').addEventListener('click', () => {
    window.location.href = '/';
});

// Araç seçimi için yardımcı fonksiyon
function selectTool(toolId) {
    document.querySelectorAll('.tool-button').forEach(button => {
        button.classList.remove('selected');
    });
    document.getElementById(toolId).classList.add('selected');
}