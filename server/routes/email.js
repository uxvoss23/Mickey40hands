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
    const serviceType = stop.serviceType || ((stop.customerType || 'residential') === 'commercial' ? 'Commercial Panel Cleaning' : 'Residential Panel Cleaning');
    const serviceIcon = (stop.customerType || 'residential') === 'commercial' ? '🏢' : '🏠';
    const amount = stop.amountPaid ? `$${parseFloat(stop.amountPaid).toFixed(2)}` : '$0.00';
    const time = stop.scheduledTime ? new Date(`2000-01-01T${stop.scheduledTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    const distance = i === 0 ? `${(stop.distanceFromPrevious || 0).toFixed(1)} mi from HQ` : `${(stop.distanceFromPrevious || 0).toFixed(1)} mi from prev`;
    const customerNotes = stop.customerNotes || '';
    const jobNotes = stop.jobNotes || '';
    const mapsLink = encodeURIComponent(stop.address || '');
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsLink}`;

    return `
      <!-- Stop ${i + 1} -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
        <tr>
          <td style="padding: 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
              <tr>
                <td style="background: #6366f1; width: 44px; text-align: center; vertical-align: top; padding: 14px 0;">
                  <span style="color: #ffffff; font-size: 18px; font-weight: 700;">${i + 1}</span>
                </td>
                <td style="padding: 12px 14px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <span style="font-weight: 700; color: #1e293b; font-size: 15px;">${stop.name}</span>
                        ${time ? `<span style="color: #6366f1; font-weight: 600; font-size: 13px;"> &bull; ${time}</span>` : ''}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top: 2px;">
                        <span style="color: #8b5cf6; font-size: 12px; font-weight: 500;">${serviceIcon} ${serviceType}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top: 4px;">
                        <a href="${mapsUrl}" style="color: #3b82f6; font-size: 13px; text-decoration: underline;" target="_blank">📍 ${stop.address}</a>
                      </td>
                    </tr>
                    ${phoneList ? `<tr><td style="padding-top: 3px;"><a href="tel:${(stop.phone || '').replace(/[^0-9+]/g, '')}" style="color: #64748b; font-size: 13px; text-decoration: none;">📞 ${phoneList}</a></td></tr>` : ''}
                    <tr>
                      <td style="padding-top: 6px;">
                        <table cellpadding="0" cellspacing="0"><tr>
                          <td style="background: #f1f5f9; border-radius: 4px; padding: 3px 8px; margin-right: 6px;">
                            <span style="color: #64748b; font-size: 11px;">${panels} panels</span>
                          </td>
                          <td style="width: 6px;"></td>
                          <td style="background: #f1f5f9; border-radius: 4px; padding: 3px 8px;">
                            <span style="color: #64748b; font-size: 11px;">${distance}</span>
                          </td>
                          <td style="width: 6px;"></td>
                          <td style="background: #f0fdf4; border-radius: 4px; padding: 3px 8px;">
                            <span style="color: #059669; font-size: 11px; font-weight: 600;">${amount}</span>
                          </td>
                        </tr></table>
                      </td>
                    </tr>
                    ${customerNotes ? `<tr><td style="padding-top: 6px;"><div style="color: #1e40af; font-size: 12px; padding: 6px 10px; background: #eff6ff; border-radius: 6px; border-left: 3px solid #3b82f6;">👤 ${customerNotes}</div></td></tr>` : ''}
                    ${jobNotes ? `<tr><td style="padding-top: 4px;"><div style="color: #92400e; font-size: 12px; padding: 6px 10px; background: #fffbeb; border-radius: 6px; border-left: 3px solid #f59e0b;">📝 ${jobNotes}</div></td></tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @media screen and (max-width: 600px) {
      .outer-wrap { padding: 8px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-text-size-adjust: 100%;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9;">
    <tr>
      <td align="center" class="outer-wrap" style="padding: 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          
          <!-- Header -->
          <tr>
            <td style="background: #4f46e5; border-radius: 16px 16px 0 0; padding: 28px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0 0 4px 0; font-size: 22px; font-weight: 700;">
                ☀️ Sunton Solutions
              </h1>
              <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">
                Solar Panel Cleaning
              </p>
            </td>
          </tr>

          <!-- Route Info -->
          <tr>
            <td style="background: #ffffff; padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <h2 style="margin: 0 0 4px 0; color: #1e293b; font-size: 17px; font-weight: 700;">${routeName}</h2>
                    <p style="margin: 0; color: #6366f1; font-size: 13px; font-weight: 500;">📅 ${formattedDate}</p>
                  </td>
                  <td style="text-align: right; vertical-align: top;">
                    <span style="background: #f0fdf4; color: #059669; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 15px;">${stops.length} Stops</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Stats Grid (2x2) -->
          <tr>
            <td style="background: #ffffff; padding: 12px 16px; border-bottom: 2px solid #e2e8f0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="text-align: center; padding: 8px 4px;">
                    <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Revenue</div>
                    <div style="color: #059669; font-size: 20px; font-weight: 700;">$${(totalRevenue || 0).toFixed(2)}</div>
                  </td>
                  <td width="50%" style="text-align: center; padding: 8px 4px;">
                    <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Total Miles</div>
                    <div style="color: #1e293b; font-size: 20px; font-weight: 700;">${(totalMiles || 0).toFixed(1)}</div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="text-align: center; padding: 8px 4px;">
                    <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Drive to 1st</div>
                    <div style="color: #1e293b; font-size: 18px; font-weight: 700;">${(driveToFirst || 0).toFixed(1)} mi</div>
                  </td>
                  <td width="50%" style="text-align: center; padding: 8px 4px;">
                    <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Drive Home</div>
                    <div style="color: #1e293b; font-size: 18px; font-weight: 700;">${(driveFromLast || 0).toFixed(1)} mi</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Stops (Card Layout) -->
          <tr>
            <td style="padding: 12px 12px 4px 12px; background: #f1f5f9;">
              ${stopsHTML}
            </td>
          </tr>

          <!-- Footer Summary -->
          <tr>
            <td style="padding: 0 12px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 14px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #1e293b; font-size: 15px; font-weight: 700;">Total Revenue</td>
                        <td style="text-align: right; color: #059669; font-weight: 700; font-size: 20px;">$${(totalRevenue || 0).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td style="padding-top: 6px; color: #64748b; font-size: 12px;">Total driving distance</td>
                        <td style="padding-top: 6px; text-align: right; color: #64748b; font-size: 12px;">${(totalMiles || 0).toFixed(1)} miles</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="text-align: center; padding: 16px; color: #94a3b8; font-size: 11px;">
              Sent from Sunton Solutions CRM
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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
