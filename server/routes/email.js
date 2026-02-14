const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 5;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many email requests. Please wait a minute before trying again.' });
  }
  
  entry.count++;
  return next();
}

function buildRouteEmailHTML(routeData) {
  const { routeName, scheduledDate, stops, totalRevenue, totalMiles, avgDistance, driveToFirst, driveFromLast } = routeData;

  const formattedDate = new Date(scheduledDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const stopsHTML = stops.map((stop, i) => {
    const phoneList = [stop.phone, ...(stop.secondaryPhones || [])].filter(Boolean).join(', ');
    const panels = stop.panelCount || stop.totalPanels || 'N/A';
    const recurring = (stop.isRecurring || stop.recurring) ? 'Yes' : 'No';
    const lastService = stop.lastServiceDate || 'N/A';
    const amount = stop.amountPaid ? `$${parseFloat(stop.amountPaid).toFixed(2)}` : '$0.00';
    const time = stop.scheduledTime ? new Date(`2000-01-01T${stop.scheduledTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    const distance = i === 0 ? 'Start' : `${(stop.distanceFromPrevious || 0).toFixed(1)} mi`;
    const notes = stop.customerNotes || stop.notes || '';

    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 14px 12px; text-align: center; font-weight: 700; color: #6366f1; font-size: 16px; width: 40px;">
          ${i + 1}
        </td>
        <td style="padding: 14px 12px;">
          <div style="font-weight: 600; color: #1e293b; font-size: 14px; margin-bottom: 2px;">${stop.name}</div>
          <div style="color: #64748b; font-size: 12px;">${stop.address}</div>
          ${phoneList ? `<div style="color: #64748b; font-size: 12px; margin-top: 2px;">📞 ${phoneList}</div>` : ''}
          ${notes ? `<div style="color: #f59e0b; font-size: 12px; margin-top: 4px; padding: 4px 8px; background: #fffbeb; border-radius: 4px; border-left: 3px solid #f59e0b;">📝 ${notes}</div>` : ''}
        </td>
        <td style="padding: 14px 12px; text-align: center; color: #6366f1; font-weight: 600; font-size: 13px; white-space: nowrap;">
          ${time}
        </td>
        <td style="padding: 14px 12px; text-align: center; color: #64748b; font-size: 12px; white-space: nowrap;">
          ${distance}
        </td>
        <td style="padding: 14px 12px; text-align: center; font-size: 12px;">
          <span style="color: #64748b;">${panels} panels</span>
        </td>
        <td style="padding: 14px 12px; text-align: center; font-weight: 600; color: #059669; font-size: 13px; white-space: nowrap;">
          ${amount}
        </td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 700px; margin: 0 auto; padding: 20px;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); border-radius: 16px 16px 0 0; padding: 32px 28px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0 0 4px 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
        ☀️ Sunton Solutions
      </h1>
      <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">
        Solar Panel Cleaning
      </p>
    </div>

    <!-- Route Info Bar -->
    <div style="background: #ffffff; padding: 20px 28px; border-bottom: 2px solid #e2e8f0;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="margin: 0 0 4px 0; color: #1e293b; font-size: 18px; font-weight: 700;">
            ${routeName}
          </h2>
          <p style="margin: 0; color: #6366f1; font-size: 14px; font-weight: 500;">
            📅 ${formattedDate}
          </p>
        </div>
        <div style="text-align: right;">
          <div style="background: #f0fdf4; color: #059669; padding: 8px 16px; border-radius: 24px; font-weight: 700; font-size: 18px; display: inline-block;">
            ${stops.length} Stops
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Row -->
    <div style="background: #ffffff; padding: 16px 28px; border-bottom: 2px solid #e2e8f0;">
      <!--[if mso]>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="25%" valign="top">
      <![endif]-->
      <div style="display: inline-block; width: 24%; text-align: center; vertical-align: top; padding: 8px 0;">
        <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Revenue</div>
        <div style="color: #059669; font-size: 20px; font-weight: 700;">$${(totalRevenue || 0).toFixed(2)}</div>
      </div>
      <!--[if mso]></td><td width="25%" valign="top"><![endif]-->
      <div style="display: inline-block; width: 24%; text-align: center; vertical-align: top; padding: 8px 0;">
        <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Total Miles</div>
        <div style="color: #1e293b; font-size: 20px; font-weight: 700;">${(totalMiles || 0).toFixed(1)}</div>
      </div>
      <!--[if mso]></td><td width="25%" valign="top"><![endif]-->
      <div style="display: inline-block; width: 24%; text-align: center; vertical-align: top; padding: 8px 0;">
        <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Drive to 1st</div>
        <div style="color: #1e293b; font-size: 20px; font-weight: 700;">${(driveToFirst || 0).toFixed(1)} mi</div>
      </div>
      <!--[if mso]></td><td width="25%" valign="top"><![endif]-->
      <div style="display: inline-block; width: 24%; text-align: center; vertical-align: top; padding: 8px 0;">
        <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Avg Between</div>
        <div style="color: #1e293b; font-size: 20px; font-weight: 700;">${(avgDistance || 0).toFixed(1)} mi</div>
      </div>
      <!--[if mso]></td></tr></table><![endif]-->
    </div>

    <!-- Stops Table -->
    <div style="background: #ffffff; border-radius: 0 0 16px 16px; overflow: hidden;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 12px; text-align: center; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; width: 40px;">#</th>
            <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Customer</th>
            <th style="padding: 12px; text-align: center; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Time</th>
            <th style="padding: 12px; text-align: center; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Distance</th>
            <th style="padding: 12px; text-align: center; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Panels</th>
            <th style="padding: 12px; text-align: center; color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${stopsHTML}
        </tbody>
      </table>

      <!-- Footer Summary -->
      <div style="padding: 20px 28px; background: #f8fafc; border-top: 2px solid #e2e8f0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="color: #64748b; font-size: 12px;">Drive home from last stop:</td>
            <td style="text-align: right; color: #1e293b; font-weight: 600; font-size: 13px;">${(driveFromLast || 0).toFixed(1)} miles</td>
          </tr>
          <tr>
            <td style="padding-top: 8px; color: #1e293b; font-size: 14px; font-weight: 700;">Total Revenue:</td>
            <td style="padding-top: 8px; text-align: right; color: #059669; font-weight: 700; font-size: 18px;">$${(totalRevenue || 0).toFixed(2)}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 11px;">
      Sent from Sunton Solutions CRM
    </div>
  </div>
</body>
</html>`;
}

router.post('/send-route', rateLimit, async (req, res) => {
  try {
    const { to, routeData } = req.body;

    if (!to || !routeData) {
      return res.status(400).json({ error: 'Missing required fields: to, routeData' });
    }

    if (!routeData.routeName || !routeData.scheduledDate || !Array.isArray(routeData.stops) || routeData.stops.length === 0) {
      return res.status(400).json({ error: 'Invalid route data: routeName, scheduledDate, and at least one stop are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = Array.isArray(to) ? to : [to];
    if (!recipients.every(e => emailRegex.test(e))) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: 'Email service not configured' });
    }

    const html = buildRouteEmailHTML(routeData);
    const subject = `Route: ${routeData.routeName} - ${new Date(routeData.scheduledDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} (${routeData.stops.length} stops)`;

    const { data, error } = await resend.emails.send({
      from: 'Sunton Solutions <onboarding@resend.dev>',
      to: recipients,
      subject,
      html
    });

    if (error) {
      console.error('Resend error:', error);
      const msg = error.message || 'Failed to send email';
      if (msg.includes('testing emails') || msg.includes('only send')) {
        return res.status(403).json({ error: 'Free tier: Can only send to the account owner email (solarcleaning@suntonsolutions.com). To send to other addresses, verify a domain at resend.com/domains.' });
      }
      return res.status(500).json({ error: msg });
    }

    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

module.exports = router;
