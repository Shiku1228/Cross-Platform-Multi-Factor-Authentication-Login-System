# Formspree Setup Guide

Your MFA Authentication System is now integrated with Formspree for sending verification emails.

## Current Configuration

The system is already configured with your Formspree endpoint:
- **Formspree Endpoint:** `https://formspree.io/f/xreanjvz`
- **Integration Method:** AJAX/JavaScript submission

## How It Works

1. User requests verification code → `sendGmailVerificationCode()` function
2. Code is generated (6-digit) → `simulateEmailSending()` function  
3. Data sent to Formspree → `sendRealEmailViaFormspree()` function
4. Formspree sends email to user with verification code
5. If Formspree fails → Falls back to simulation mode (displays code in console)

## Form Data Structure

The system sends this data to your Formspree form:

```json
{
    "email": "user@example.com",
    "verification_code": "123456",
    "subject": "Your Verification Code",
    "message": "Hello,\n\nYour verification code is: 123456\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nThanks,\nMFA Authentication System"
}
```

## Formspree Dashboard Setup

1. Go to [Formspree Dashboard](https://formspree.io/dashboard)
2. Navigate to your form settings
3. Configure email notifications:
   - Set recipient email address
   - Customize email template if needed
   - Set up email subject line

## Email Template (Optional)

In your Formspree form settings, you can customize the email template using these variables:

- `{{email}}` - Recipient email address
- `{{verification_code}}` - The 6-digit verification code
- `{{subject}}` - Email subject
- `{{message}}` - Full message content

## Testing

1. Open your MFA application
2. Try to sign in with email verification
3. Check your email for the verification code
4. If no email arrives, check browser console for fallback simulation

## Benefits of Formspree

- ✅ No server-side code required
- ✅ Handles email delivery automatically  
- ✅ Spam protection included
- ✅ Free tier available (50 submissions/month)
- ✅ Easy dashboard management
- ✅ Custom email templates

## Troubleshooting

**If emails aren't being sent:**
1. Check Formspree dashboard for submission logs
2. Verify your form is active (not disabled)
3. Check email configuration in form settings
4. Look at browser console for error messages

**If you see simulation mode:**
- Check network connection
- Verify Formspree endpoint is correct
- Check Formspree service status

## Production Considerations

- Monitor Formspree submission limits
- Consider upgrading to paid plan for higher volume
- Set up email notifications in Formspree dashboard
- Configure spam filters appropriately

## Alternative: Backend Service

For high-volume applications, consider:
- Firebase Cloud Functions + SendGrid
- Node.js backend + Nodemailer
- AWS SES
- Your own email API

Formspree is perfect for development, testing, and small to medium applications.
