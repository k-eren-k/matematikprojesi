const verifyForm = document.getElementById('verifyForm');
const verifyMessage = document.getElementById('verifyMessage');
const resendButton = document.getElementById('resendCode');

verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value;
    const verificationCode = document.getElementById('verificationCode').value;

    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, code: verificationCode })
        });

        const data = await response.json();

        if (response.ok) {
            verifyMessage.textContent = data.message || 'Verification successful.';
            verifyMessage.style.color = 'green';
            window.location.href = 'login.html';
        } else {
            verifyMessage.textContent = data.error || 'Verification failed.';
            verifyMessage.style.color = 'red';
            resendButton.style.display = 'block';
        }
    } catch (error) {
        console.error('Error:', error);
        verifyMessage.textContent = 'An error occurred.';
        verifyMessage.style.color = 'red';
    }
});

resendButton.addEventListener('click', async () => {
    verifyMessage.textContent = 'Resending code...';
    verifyMessage.style.color = 'blue';

    try {
        const email = document.getElementById('email').value;
        const response = await fetch('/api/resend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (response.ok) {
            verifyMessage.textContent = data.message || 'New verification code sent.';
            verifyMessage.style.color = 'green';
        } else {
            verifyMessage.textContent = data.error || 'Failed to resend verification code.';
            verifyMessage.style.color = 'red';
        }
    } catch (error) {
        console.error('Error:', error);
        verifyMessage.textContent = 'An error occurred while resending the code.';
        verifyMessage.style.color = 'red';
    }
});