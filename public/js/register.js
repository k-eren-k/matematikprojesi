const registerForm = document.getElementById('registerForm');
const registerMessage = document.getElementById('registerMessage');

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const firstName = document.getElementById('firstName').value;
    const lastName = document.getElementById('lastName').value;
    const username = document.getElementById('username').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ firstName, lastName, username, email, password, confirmPassword })
        });

        const data = await response.json();

        if (response.ok) {
            registerMessage.textContent = data.message || 'Registration successful. Check your email to verify.';
            registerMessage.style.color = 'green';
            localStorage.setItem('userEmail', email); // Kayıttan sonra e-posta adresini localStorage'a kaydet
            window.location.href = 'verify.html';
        } else {
            registerMessage.textContent = data.error || 'Registration failed.';
            registerMessage.style.color = 'red';
        }
    } catch (error) {
        console.error('Error:', error);
        registerMessage.textContent = 'An error occurred.';
        registerMessage.style.color = 'red';
    }
});