const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Token'ı localStorage'da sakla
            localStorage.setItem('token', data.token);

            loginMessage.textContent = 'Login successful.';
            loginMessage.style.color = 'green';

            // Ana sayfaya yönlendir (index.html veya başka bir sayfa)
            window.location.href = 'index.html';
        } else {
            loginMessage.textContent = data.error || 'Login failed.';
            loginMessage.style.color = 'red';
        }
    } catch (error) {
      console.error('Error:', error);
        loginMessage.textContent = 'An error occurred.';
        loginMessage.style.color = 'red';
    }
});