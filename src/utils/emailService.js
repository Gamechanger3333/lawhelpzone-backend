import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create reusable transporter
const createTransporter = () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      // Production: Use SendGrid or similar
      return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
    } else {
      // Development: Use Gmail
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_APP_PASSWORD,
        },
      });
    }
  } catch (error) {
    console.error('âŒ Failed to create email transporter:', error);
    return null;
  }
};

export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      console.warn('âš ï¸ Email credentials not configured. Email not sent.');
      return { success: false, message: 'Email not configured' };
    }

    const transporter = createTransporter();

    if (!transporter) {
      console.warn('âš ï¸ Email transporter not available. Email not sent.');
      return { success: false, message: 'Email transporter not available' };
    }

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'LawHelpZone'}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log('âœ… Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('âŒ Email sending failed:', error.message);
    return { success: false, error: error.message };
  }
};

export const emailTemplates = {
  emailVerification: ({ name, verificationURL }) => ({
    subject: 'Verify Your Email - LawHelpZone',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1e3a8a; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 30px; }
          .button { 
            display: inline-block; 
            padding: 12px 30px; 
            background: #1e3a8a; 
            color: white; 
            text-decoration: none; 
            border-radius: 5px;
            margin: 20px 0;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to LawHelpZone!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Thank you for registering with LawHelpZone. Please verify your email address:</p>
            <div style="text-align: center;">
              <a href="${verificationURL}" class="button">Verify Email Address</a>
            </div>
            <p>Or copy this link: ${verificationURL}</p>
            <p><strong>This link expires in 24 hours.</strong></p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} LawHelpZone. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  passwordReset: ({ name, resetURL }) => ({
    subject: 'Password Reset Request - LawHelpZone',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 30px; }
          .button { 
            display: inline-block; 
            padding: 12px 30px; 
            background: #dc2626; 
            color: white; 
            text-decoration: none; 
            border-radius: 5px;
            margin: 20px 0;
          }
          .warning { 
            background: #fef3c7; 
            border-left: 4px solid #f59e0b; 
            padding: 15px;
            margin: 20px 0;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>We received a request to reset your password:</p>
            <div style="text-align: center;">
              <a href="${resetURL}" class="button">Reset Password</a>
            </div>
            <p>Or copy this link: ${resetURL}</p>
            <div class="warning">
              <strong>âš ï¸ Important:</strong>
              <ul>
                <li>This link expires in 10 minutes</li>
                <li>If you didn't request this, ignore this email</li>
              </ul>
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} LawHelpZone. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),
};

export const sendBulkEmails = async (emails) => {
  const results = await Promise.allSettled(
    emails.map(email => sendEmail(email))
  );
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`ðŸ“§ Bulk email results: ${successful} sent, ${failed} failed`);
  
  return { successful, failed, results };
};