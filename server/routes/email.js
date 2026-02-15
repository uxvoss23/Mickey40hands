const express = require('express');
const router = express.Router();
const { Resend } = require('resend');
const pool = require('../db/pool');

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

function buildRouteEmailHTML(routeData, baseUrl) {
  const { routeName, scheduledDate, stops, totalRevenue, totalMiles, avgDistance, driveToFirst, driveFromLast, routeId } = routeData;
  const techRouteUrl = routeId && baseUrl ? `${baseUrl}/tech-route/${routeId}` : '';

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

          ${techRouteUrl ? `
          <!-- Tech Route Link -->
          <tr>
            <td style="background: #ffffff; padding: 12px 20px; border-bottom: 1px solid #e2e8f0; text-align: center;">
              <a href="${techRouteUrl}" target="_blank" style="display: inline-block; background: #22c55e; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none;">
                📋 Open Route Checklist
              </a>
              <p style="margin: 6px 0 0; color: #94a3b8; font-size: 11px;">Tap to mark stops complete as you go</p>
            </td>
          </tr>
          ` : ''}

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

function buildAssessmentEmailHTML(data, enrollmentTokens, previousServiceData) {
  const { customerName, address, serviceDate, panelCount, servicePrice, pricePerPanel,
          buildupLevel, debris, surfaceDamage, systemChecks, urgentChecks, inspectionNotes,
          recommendedFrequency, recurringStatus, photos } = data;

  const firstName = (customerName || 'there').split(' ')[0];
  const formattedDate = serviceDate ? new Date(serviceDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }) : 'your recent service';

  const beforePhotos = (photos || []).filter(p => p.label && (p.label.includes('Before') || p.label.includes('Buildup')));
  const afterPhotos = (photos || []).filter(p => p.label && (p.label.includes('After') || p.label.includes('Clean')));
  const issuePhotosList = (photos || []).filter(p => p.label && p.label.startsWith('Issue:'));

  const normalizeDamage = (sd) => {
    if (!sd) return [];
    if (typeof sd === 'string') {
      if (sd === 'None') return [{ type: 'None' }];
      return [{ type: sd }];
    }
    if (Array.isArray(sd)) return sd;
    return [];
  };
  const damageItems = normalizeDamage(surfaceDamage);
  const damageIsNone = damageItems.length === 0 || (damageItems.length === 1 && damageItems[0].type === 'None');
  const damageCount = damageItems.filter(d => d.type !== 'None').reduce((sum, d) => sum + (d.count || 1), 0);

  const systemIssues = (systemChecks || []).filter(c => c !== 'No visible issues');
  const noSystemIssues = systemChecks && systemChecks.includes('No visible issues') && systemIssues.length === 0;

  const damageNarrative = (() => {
    if (damageIsNone) return ' The good news is that no surface damage was found on any of your panels.';
    const items = damageItems.filter(d => d.type !== 'None');
    const pluralize = (word, count) => {
      const w = word.toLowerCase();
      if (count <= 1) return w;
      if (w === 'crack') return 'cracks';
      if (w === 'chip') return 'chips';
      if (w === 'micro-cracks' || w === 'micro-crack') return 'micro-cracks';
      if (w === 'hot spots' || w === 'hot spot') return 'hot spots';
      return w;
    };
    const parts = items.map(d => {
      const cnt = d.count || 1;
      return cnt > 1 ? `${cnt} ${pluralize(d.type, cnt)}` : d.type.toLowerCase();
    });
    let joined;
    if (parts.length === 1) joined = parts[0];
    else if (parts.length === 2) joined = parts.join(' and ');
    else joined = parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    return ` We identified the following surface damage: ${joined}.`;
  })();

  const buildupNarrative = {
    'Light': 'a light layer of dust and residue',
    'Moderate': 'a moderate buildup of dirt and debris that was reducing your panel efficiency',
    'Heavy': 'a heavy accumulation of grime that was significantly impacting your solar production'
  };
  const buildupDesc = buildupNarrative[buildupLevel] || 'some buildup on your panels';

  const cleanDebris = (debris || []).map(d => d.startsWith('Other: ') ? d.replace('Other: ', '').trim() : d).filter(Boolean);
  const debrisDesc = cleanDebris.length > 0 ? (() => {
    const items = cleanDebris.map(d => d.toLowerCase());
    let joined;
    if (items.length === 1) joined = items[0];
    else if (items.length === 2) joined = items.join(' and ');
    else joined = items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
    return ` The primary contaminants were ${joined}.`;
  })() : '';

  const price = parseFloat(servicePrice) || 0;
  const ppp = parseFloat(pricePerPanel) || 9;
  const panels = parseInt(panelCount) || 0;
  const annualPrice = panels > 0 ? (panels * ppp * 0.90).toFixed(2) : (price * 0.90).toFixed(2);
  const biannualPrice = panels > 0 ? (panels * ppp * 0.85).toFixed(2) : (price * 0.85).toFixed(2);
  const triannualPrice = panels > 0 ? (panels * ppp * 0.80).toFixed(2) : (price * 0.80).toFixed(2);
  const fullPrice = panels > 0 ? (panels * ppp).toFixed(2) : (price > 0 ? price.toFixed(2) : '0.00');
  const annualSave = (parseFloat(fullPrice) - parseFloat(annualPrice)).toFixed(2);
  const biannualSave = ((parseFloat(fullPrice) * 2) - (parseFloat(biannualPrice) * 2)).toFixed(2);
  const triannualSave = ((parseFloat(fullPrice) * 3) - (parseFloat(triannualPrice) * 3)).toFixed(2);

  const photoGrid = (photoList, maxWidth) => {
    if (!photoList || photoList.length === 0) return '';
    const width = photoList.length === 1 ? '100%' : (photoList.length === 2 ? '48%' : '31%');
    return photoList.map(p => `
      <div style="display:inline-block;width:${width};vertical-align:top;padding:4px;">
        <img src="${p.data}" alt="${p.label}" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;display:block;" />
        <div style="font-size:10px;color:#64748b;text-align:center;margin-top:6px;font-weight:500;">${p.label.replace('Issue: ', '')}</div>
      </div>
    `).join('');
  };

  const isEnrolled = recurringStatus && recurringStatus.startsWith('enrolled_');
  const enrolledPlanType = isEnrolled ? recurringStatus.replace('enrolled_', '') : null;
  const enrolledPlanLabels = { annual: 'Annual', biannual: 'Bi-Annual', triannual: '3x Per Year' };
  const enrolledPlanFreq = { annual: '1x per year', biannual: '2x per year', triannual: 'Every 4 months' };
  const enrolledPlanPrices = { annual: annualPrice, biannual: biannualPrice, triannual: triannualPrice };
  const enrolledPlanSavings = { annual: annualSave, biannual: biannualSave, triannual: triannualSave };
  const enrolledPlanDiscounts = { annual: '10%', biannual: '15%', triannual: '20%' };

  const enrolledConfirmation = isEnrolled ? `
    <tr>
      <td style="background:#ffffff;padding:0 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);border-radius:16px;padding:28px 24px;text-align:center;">
              <div style="font-size:40px;margin-bottom:10px;">🎉</div>
              <h2 style="color:#ffffff;margin:0 0 6px;font-size:20px;font-weight:800;">You're Enrolled in Recurring Maintenance!</h2>
              <p style="color:rgba(255,255,255,0.85);margin:0 0 24px;font-size:14px;line-height:1.5;">Great news — you've signed up for our recurring maintenance plan. Your panels will stay at peak performance with regularly scheduled professional cleanings.</p>

              <div style="background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.3);border-radius:16px;padding:24px 20px;text-align:center;max-width:280px;margin:0 auto;">
                <div style="background:rgba(255,255,255,0.2);color:#ffffff;padding:4px 14px;border-radius:20px;font-size:10px;font-weight:800;display:inline-block;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Your Plan</div>
                <div style="font-size:22px;font-weight:800;color:#ffffff;margin-bottom:2px;">${enrolledPlanLabels[enrolledPlanType] || enrolledPlanType}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:16px;">${enrolledPlanFreq[enrolledPlanType] || ''}</div>
                <div style="font-size:32px;font-weight:800;color:#ffffff;">$${enrolledPlanPrices[enrolledPlanType] || fullPrice}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);margin:4px 0 12px;">per cleaning</div>
                <div style="background:rgba(255,255,255,0.25);border-radius:10px;padding:10px 16px;margin-top:8px;">
                  <div style="color:#ffffff;font-size:13px;font-weight:700;">You save ${enrolledPlanDiscounts[enrolledPlanType] || ''} per cleaning</div>
                  <div style="color:rgba(255,255,255,0.7);font-size:11px;margin-top:2px;">$${enrolledPlanSavings[enrolledPlanType] || '0'} savings per year vs standard pricing</div>
                </div>
              </div>

              <div style="margin-top:20px;text-align:left;max-width:320px;margin-left:auto;margin-right:auto;">
                <div style="color:rgba(255,255,255,0.9);font-size:13px;padding:6px 0;">✅ Priority scheduling for all appointments</div>
                <div style="color:rgba(255,255,255,0.9);font-size:13px;padding:6px 0;">✅ Locked-in discounted rate</div>
                <div style="color:rgba(255,255,255,0.9);font-size:13px;padding:6px 0;">✅ Automatic scheduling — no calls needed</div>
                <div style="color:rgba(255,255,255,0.9);font-size:13px;padding:6px 0;">✅ Cancel or adjust anytime — no contracts</div>
              </div>

              <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:16px 0 0;">We'll reach out before each service to confirm your appointment.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : '';

  const enrollmentCards = (!isEnrolled && enrollmentTokens) ? `
    <tr>
      <td style="background:#ffffff;padding:0 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:16px;padding:28px 24px;text-align:center;">
              <h2 style="color:#ffffff;margin:0 0 6px;font-size:20px;font-weight:800;">Keep Your Panels at Peak Performance</h2>
              <p style="color:rgba(255,255,255,0.85);margin:0 0 20px;font-size:14px;line-height:1.5;">Lock in your maintenance plan today and save on every cleaning. Our recurring customers enjoy priority scheduling, discounted rates, and the peace of mind that their solar investment is always performing at its best.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr>
                  <td width="33%" style="padding:0 4px;vertical-align:top;">
                    <div style="background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.25);border-radius:14px;padding:20px 12px;text-align:center;">
                      <div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Annual</div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin:2px 0 8px;">1x per year</div>
                      <div style="font-size:26px;font-weight:800;color:#ffffff;">$${annualPrice}</div>
                      <div style="font-size:11px;color:#a5f3fc;margin:2px 0 0;">per cleaning</div>
                      <div style="background:#22c55e;color:#ffffff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;display:inline-block;margin:10px 0;">Save $${annualSave}/yr</div>
                      <div style="margin-top:12px;">
                        <a href="${enrollmentTokens.annual || '#'}" style="display:inline-block;background:#ffffff;color:#4f46e5;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;width:80%;box-sizing:border-box;">Select Plan</a>
                      </div>
                    </div>
                  </td>
                  <td width="33%" style="padding:0 4px;vertical-align:top;">
                    <div style="background:rgba(255,255,255,0.18);border:2px solid #fbbf24;border-radius:14px;padding:20px 12px;text-align:center;position:relative;">
                      <div style="background:#fbbf24;color:#1e293b;padding:3px 12px;border-radius:10px;font-size:10px;font-weight:800;display:inline-block;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Most Popular</div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Bi-Annual</div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin:2px 0 8px;">2x per year</div>
                      <div style="font-size:26px;font-weight:800;color:#ffffff;">$${biannualPrice}</div>
                      <div style="font-size:11px;color:#a5f3fc;margin:2px 0 0;">per cleaning</div>
                      <div style="background:#22c55e;color:#ffffff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;display:inline-block;margin:10px 0;">Save $${biannualSave}/yr</div>
                      <div style="margin-top:12px;">
                        <a href="${enrollmentTokens.biannual || '#'}" style="display:inline-block;background:#fbbf24;color:#1e293b;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;width:80%;box-sizing:border-box;">Select Plan</a>
                      </div>
                    </div>
                  </td>
                  <td width="33%" style="padding:0 4px;vertical-align:top;">
                    <div style="background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.25);border-radius:14px;padding:20px 12px;text-align:center;">
                      <div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">3x Per Year</div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin:2px 0 8px;">Every 4 months</div>
                      <div style="font-size:26px;font-weight:800;color:#ffffff;">$${triannualPrice}</div>
                      <div style="font-size:11px;color:#a5f3fc;margin:2px 0 0;">per cleaning</div>
                      <div style="background:#22c55e;color:#ffffff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;display:inline-block;margin:10px 0;">Save $${triannualSave}/yr</div>
                      <div style="margin-top:12px;">
                        <a href="${enrollmentTokens.triannual || '#'}" style="display:inline-block;background:#ffffff;color:#4f46e5;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;width:80%;box-sizing:border-box;">Select Plan</a>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:12px 0 0;">Cancel or adjust your plan anytime. No contracts, no hassle.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:20px 20px 0 0;padding:32px 24px;text-align:center;">
              <div style="font-size:13px;color:#fbbf24;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Sunton Solutions</div>
              <h1 style="color:#ffffff;margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">Your Solar Panel<br/>Service Report</h1>
              <div style="display:inline-block;background:rgba(99,102,241,0.3);border:1px solid rgba(99,102,241,0.5);border-radius:20px;padding:6px 16px;">
                <span style="color:#a5b4fc;font-size:12px;font-weight:600;">${formattedDate}</span>
              </div>
            </td>
          </tr>

          <!-- Personal Greeting -->
          <tr>
            <td style="background:#ffffff;padding:24px 24px 16px;">
              <p style="margin:0;color:#1e293b;font-size:15px;line-height:1.6;">
                Hi ${firstName},
              </p>
              <p style="margin:10px 0 0;color:#475569;font-size:14px;line-height:1.6;">
                Thank you for trusting Sunton Solutions with your solar panel maintenance${panels > 0 ? ` — all ${panels} panels have been professionally cleaned and inspected` : ''}. Below is a complete summary of what our technician found and what was done during your service.
              </p>
            </td>
          </tr>

          <!-- Section 1: What We Found -->
          <tr>
            <td style="background:#ffffff;padding:8px 24px 20px;">
              <div style="border-left:4px solid #f59e0b;padding-left:16px;margin-bottom:16px;">
                <h2 style="margin:0 0 4px;color:#1e293b;font-size:18px;font-weight:800;">What We Found</h2>
                <p style="margin:0;color:#64748b;font-size:12px;">Initial panel condition before cleaning</p>
              </div>
              <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">
                During our inspection, we observed ${buildupDesc}.${debrisDesc}${damageNarrative}
              </p>
              ${beforePhotos.length > 0 ? `
                <div style="margin-bottom:8px;">
                  <div style="background:#fffbeb;border-radius:10px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;">
                    <span style="font-size:20px;margin-right:10px;">📸</span>
                    <div>
                      <div style="font-size:14px;font-weight:800;color:#92400e;">Before Cleaning</div>
                      <div style="font-size:11px;color:#b45309;">Initial condition documented</div>
                    </div>
                  </div>
                  ${photoGrid(beforePhotos)}
                </div>
              ` : ''}
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                <tr>
                  <td width="50%" style="padding:6px 4px 6px 0;">
                    <div style="background:${buildupLevel === 'Heavy' ? '#fef2f2' : buildupLevel === 'Moderate' ? '#fffbeb' : '#f0fdf4'};border-radius:10px;padding:14px;text-align:center;">
                      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Buildup Level</div>
                      <div style="font-size:20px;font-weight:800;color:${buildupLevel === 'Heavy' ? '#dc2626' : buildupLevel === 'Moderate' ? '#d97706' : '#16a34a'};margin-top:4px;">${buildupLevel || 'N/A'}</div>
                    </div>
                  </td>
                  <td width="50%" style="padding:6px 0 6px 4px;">
                    ${damageIsNone ? `
                    <div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center;">
                      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Surface Findings</div>
                      <div style="font-size:20px;font-weight:800;color:#16a34a;margin-top:4px;">No Damage</div>
                    </div>
                    ` : `
                    <div style="background:#fef2f2;border-radius:10px;padding:14px;text-align:center;">
                      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Surface Findings</div>
                      <div style="margin-top:8px;">
                        ${damageItems.filter(d => d.type !== 'None').map(d =>
                          `<span style="display:inline-block;background:#fee2e2;color:#dc2626;padding:4px 10px;border-radius:16px;font-size:12px;font-weight:700;margin:2px;">${d.type}${d.count > 1 ? ' \u00d7' + d.count : ''}</span>`
                        ).join('')}
                      </div>
                    </div>
                    `}
                  </td>
                </tr>
              </table>
              ${cleanDebris.length > 0 ? `
                <div style="margin-top:10px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px;">Contaminants Removed</div>
                  ${cleanDebris.map(d => `<span style="display:inline-block;background:#f1f5f9;color:#475569;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;margin:2px 4px 2px 0;">${d}</span>`).join('')}
                </div>
              ` : ''}
            </td>
          </tr>

          <!-- Section 2: What We Did -->
          <tr>
            <td style="background:#ffffff;padding:8px 24px 20px;">
              <div style="border-left:4px solid #22c55e;padding-left:16px;margin-bottom:16px;">
                <h2 style="margin:0 0 4px;color:#1e293b;font-size:18px;font-weight:800;">What We Did</h2>
                <p style="margin:0;color:#64748b;font-size:12px;">Results after professional cleaning</p>
              </div>
              <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">
                Your panels have been thoroughly cleaned using our professional deionized water system. All ${buildupLevel ? buildupLevel.toLowerCase() + ' ' : ''}buildup${cleanDebris.length > 0 ? (() => { const d = cleanDebris.map(x => x.toLowerCase()); const joined = d.length === 1 ? d[0] : d.length === 2 ? d.join(' and ') : d.slice(0,-1).join(', ') + ', and ' + d[d.length-1]; return ', including ' + joined + ','; })() : ''} has been carefully removed to restore optimal sunlight absorption and maximize your energy production.
              </p>
              ${afterPhotos.length > 0 ? `
                <div style="margin-bottom:8px;">
                  <div style="background:#f0fdf4;border-radius:10px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;">
                    <span style="font-size:20px;margin-right:10px;">✨</span>
                    <div>
                      <div style="font-size:14px;font-weight:800;color:#166534;">After Cleaning</div>
                      <div style="font-size:11px;color:#15803d;">Restored to peak performance</div>
                    </div>
                  </div>
                  ${photoGrid(afterPhotos)}
                </div>
              ` : ''}
            </td>
          </tr>

          <!-- Section 3: System Health Check -->
          <tr>
            <td style="background:#ffffff;padding:8px 24px 20px;">
              <div style="border-left:4px solid #6366f1;padding-left:16px;margin-bottom:16px;">
                <h2 style="margin:0 0 4px;color:#1e293b;font-size:18px;font-weight:800;">System Health Check</h2>
                <p style="margin:0;color:#64748b;font-size:12px;">Full inspection of your solar system</p>
              </div>
              ${noSystemIssues ? `
                <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin-bottom:12px;">
                  <div style="font-size:28px;margin-bottom:6px;">✅</div>
                  <div style="color:#16a34a;font-size:16px;font-weight:700;">All Systems Look Great</div>
                  <p style="color:#4ade80;font-size:13px;margin:6px 0 0;">No issues were found during our comprehensive inspection of your racking, wiring, and panel surfaces.</p>
                </div>
              ` : `
                <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">During our inspection, our technician noted the following items for your awareness:</p>
                ${(() => {
                  const urgentList = urgentChecks || [];
                  const issueExplanations = {
                    'Loose racking / hardware': 'Loose mounts can shift panels out of alignment and expose your roof to potential water damage over time.',
                    'Pest activity': 'Birds and rodents nesting under panels can chew wiring and block airflow, reducing performance and creating fire risk.',
                    'Shading concern': 'Even partial shading on one panel can significantly reduce output across your entire system.',
                    'Roof penetration concern': 'Compromised seals around roof mounts can lead to leaks that cause costly structural damage if left unaddressed.',
                    'Conduit / wiring concern': 'Damaged or exposed wiring reduces system efficiency and poses a potential electrical safety hazard.'
                  };
                  return systemIssues.map(issue => {
                    const cleanIssue = issue.startsWith('Other: ') ? issue.replace('Other: ', '').trim() : issue;
                    const explanation = issueExplanations[issue] || '';
                    const isUrgent = urgentList.includes(issue);
                    if (isUrgent) {
                      return `
                      <div style="background:#fef2f2;border:2px solid #dc2626;border-left:5px solid #dc2626;border-radius:0 10px 10px 0;padding:16px;margin-bottom:10px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                          <span style="background:#dc2626;color:#fff;font-size:10px;font-weight:800;padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">Urgent</span>
                          <span style="color:#991b1b;font-size:14px;font-weight:700;">${cleanIssue}</span>
                        </div>
                        ${explanation ? `<div style="color:#7f1d1d;font-size:12px;line-height:1.5;margin-top:6px;">${explanation}</div>` : ''}
                        <div style="color:#dc2626;font-size:12px;font-weight:600;margin-top:8px;padding-top:8px;border-top:1px solid #fecaca;">We recommend addressing this as soon as possible to protect your system and your home.</div>
                      </div>`;
                    }
                    return `
                    <div style="background:#fef2f2;border-left:3px solid #ef4444;border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:8px;">
                      <div style="color:#dc2626;font-size:13px;font-weight:600;">⚠️ ${cleanIssue}</div>
                      ${explanation ? `<div style="color:#64748b;font-size:12px;line-height:1.5;margin-top:4px;">${explanation}</div>` : ''}
                    </div>`;
                  }).join('');
                })()}
              `}
              ${issuePhotosList.length > 0 ? `
                <div style="margin-top:12px;">
                  <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:8px;">Documented Issues</div>
                  ${photoGrid(issuePhotosList)}
                </div>
              ` : ''}
              ${inspectionNotes ? `
                <div style="margin-top:14px;background:#f8fafc;border-radius:12px;padding:16px;border-left:3px solid #6366f1;">
                  <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px;">Notes From Your Technician</div>
                  <p style="color:#334155;font-size:14px;line-height:1.6;margin:0;">${inspectionNotes}</p>
                </div>
              ` : ''}
            </td>
          </tr>

          <!-- Section 4: Service Comparison (if previous data available) -->
          ${previousServiceData ? (() => {
            const prevBuildup = previousServiceData.buildup_level || 'N/A';
            const prevDamageItems = normalizeDamage(previousServiceData.surface_damage);
            const prevDamageCount = prevDamageItems.filter(d => d.type !== 'None').reduce((sum, d) => sum + (d.count || 1), 0);
            const currentDamageCount = damageCount;
            const prevFormattedDate = previousServiceData.service_date ? new Date(previousServiceData.service_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'your previous service';
            const buildupRank = { 'Light': 1, 'Moderate': 2, 'Heavy': 3 };
            const prevBuildupRank = buildupRank[prevBuildup] || 0;
            const currBuildupRank = buildupRank[buildupLevel] || 0;
            const buildupImproved = currBuildupRank < prevBuildupRank;
            const buildupWorse = currBuildupRank > prevBuildupRank;
            const buildupSame = currBuildupRank === prevBuildupRank;
            const damageImproved = currentDamageCount < prevDamageCount;
            const damageWorse = currentDamageCount > prevDamageCount;
            const damageSame = currentDamageCount === prevDamageCount;
            const buildupTrend = buildupImproved ? '<div style="color:#16a34a;font-size:16px;margin-top:4px;">\u2191 Improved</div>' : buildupWorse ? '<div style="color:#dc2626;font-size:16px;margin-top:4px;">\u2193 Increased</div>' : '<div style="color:#94a3b8;font-size:16px;margin-top:4px;">\u2192 Same</div>';
            const damageTrend = damageImproved ? '<div style="color:#16a34a;font-size:16px;margin-top:4px;">\u2191 Improved</div>' : damageWorse ? '<div style="color:#dc2626;font-size:16px;margin-top:4px;">\u2193 Increased</div>' : '<div style="color:#94a3b8;font-size:16px;margin-top:4px;">\u2192 Same</div>';
            const currentBuildupColor = buildupLevel === 'Heavy' ? '#dc2626' : buildupLevel === 'Moderate' ? '#d97706' : '#16a34a';
            const currentDamageColor = currentDamageCount === 0 ? '#16a34a' : currentDamageCount <= 2 ? '#d97706' : '#dc2626';
            let compNarrative = '';
            if (buildupImproved && (damageImproved || damageSame)) {
              compNarrative = 'Great news \u2014 your buildup level has decreased since your last service, indicating your maintenance schedule is working well.';
            } else if (buildupSame && damageSame) {
              compNarrative = 'Your panel conditions are consistent with your last service, suggesting a stable environment.';
            } else if (buildupWorse || damageWorse) {
              compNarrative = 'We noticed increased buildup compared to your last cleaning. You may want to consider more frequent maintenance.';
            } else {
              compNarrative = 'Overall, your panel conditions are holding steady. Keep up the regular maintenance!';
            }
            return `
          <tr>
            <td style="background:#ffffff;padding:8px 24px 20px;">
              <div style="border-left:4px solid #06b6d4;padding-left:16px;margin-bottom:16px;">
                <h2 style="margin:0 0 4px;color:#1e293b;font-size:18px;font-weight:800;">Since Your Last Cleaning</h2>
                <p style="margin:0;color:#64748b;font-size:12px;">Comparing to your service on ${prevFormattedDate}</p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding:6px 4px 6px 0;">
                    <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center;">
                      <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;">Buildup</div>
                      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Previous: ${prevBuildup}</div>
                      <div style="font-size:14px;font-weight:800;color:${currentBuildupColor};margin-top:2px;">Now: ${buildupLevel || 'N/A'}</div>
                      ${buildupTrend}
                    </div>
                  </td>
                  <td width="50%" style="padding:6px 0 6px 4px;">
                    <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center;">
                      <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;">Damage</div>
                      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Previous: ${prevDamageCount} issues</div>
                      <div style="font-size:14px;font-weight:800;color:${currentDamageColor};margin-top:2px;">Now: ${currentDamageCount} issues</div>
                      ${damageTrend}
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;color:#475569;font-size:13px;line-height:1.5;font-style:italic;">${compNarrative}</p>
            </td>
          </tr>`;
          })() : ''}

          <!-- Section 5: Our Recommendation -->
          <tr>
            <td style="background:#ffffff;padding:8px 24px 24px;">
              <div style="border-left:4px solid #8b5cf6;padding-left:16px;margin-bottom:16px;">
                <h2 style="margin:0 0 4px;color:#1e293b;font-size:18px;font-weight:800;">Our Recommendation</h2>
                <p style="margin:0;color:#64748b;font-size:12px;">Keeping your solar investment performing</p>
              </div>
              <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">
                Based on the ${buildupLevel ? buildupLevel.toLowerCase() : ''} buildup we found${cleanDebris.length > 0 ? ' (' + (() => { const d = cleanDebris.map(x => x.toLowerCase()); return d.length === 1 ? d[0] : d.length === 2 ? d.join(' and ') : d.slice(0,-1).join(', ') + ', and ' + d[d.length-1]; })() + ')' : ''}${!noSystemIssues && systemIssues.length > 0 ? (() => { const clean = systemIssues.map(s => s.startsWith('Other: ') ? s.replace('Other: ','').trim() : s).map(s => s.toLowerCase()); if (clean.length <= 2) { return ' and the ' + (clean.length === 1 ? clean[0] : clean[0] + ' and ' + clean[1]) + ' we noticed'; } return ' and the ' + clean[0] + ', ' + clean[1] + ', and other items we noticed'; })() : ''}, we recommend <strong style="color:#4f46e5;">${recommendedFrequency || 'regular'} cleaning</strong> to keep your panels performing at maximum efficiency. Regular maintenance can improve your solar output by up to 25% and extend the lifespan of your system.
              </p>
              <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe;border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:11px;color:#6366f1;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Recommended Schedule</div>
                <div style="font-size:28px;font-weight:800;color:#4f46e5;margin:6px 0;">${recommendedFrequency || 'Regular'}</div>
                <div style="font-size:12px;color:#64748b;">Based on your property's conditions and panel setup</div>
              </div>
            </td>
          </tr>

          <!-- Section 5: Recurring Plan / Enrollment -->
          ${isEnrolled ? enrolledConfirmation : enrollmentCards}

          <!-- Footer -->
          <tr>
            <td style="text-align:center;padding:28px 24px;border-radius:0 0 20px 20px;background:#ffffff;">
              <p style="color:#1e293b;font-size:14px;font-weight:600;margin:0 0 6px;">Thank you for choosing Sunton Solutions!</p>
              <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.5;">Have questions about your assessment or want to schedule your next cleaning?<br/>Simply reply to this email or give us a call — we're happy to help.</p>
              <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;">
                <span style="color:#cbd5e1;font-size:11px;">© ${new Date().getFullYear()} Sunton Solutions • Solar Panel Cleaning & Maintenance</span>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

router.post('/preview-assessment', (req, res) => {
  try {
    const { assessmentData } = req.body;
    if (!assessmentData) {
      return res.status(400).json({ error: 'Missing assessmentData' });
    }
    const previewTokens = {
      annual: '#preview-annual',
      biannual: '#preview-biannual',
      triannual: '#preview-triannual'
    };
    const html = buildAssessmentEmailHTML(assessmentData, previewTokens, null);
    res.json({ html });
  } catch (err) {
    console.error('Assessment preview error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate preview' });
  }
});

router.post('/send-assessment', rateLimit, async (req, res) => {
  try {
    const { to, assessmentData } = req.body;
    if (!to || !assessmentData) {
      return res.status(400).json({ error: 'Missing required fields: to, assessmentData' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: 'Email service not configured' });
    }

    const customerId = assessmentData.customerId;
    const servicePrice = parseFloat(assessmentData.servicePrice) || 0;
    const pricePerPanel = parseFloat(assessmentData.pricePerPanel) || 9;
    const panelCount = parseInt(assessmentData.panelCount) || 0;
    const recurringStatus = assessmentData.recurringStatus || '';
    const isEnrolledByTech = recurringStatus.startsWith('enrolled_');

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    let enrollmentTokens = null;

    if (isEnrolledByTech && customerId) {
      const planType = recurringStatus.replace('enrolled_', '');
      const planIntervals = { annual: '12', biannual: '6', triannual: '4' };
      const discountMultiplier = { annual: 0.90, biannual: 0.85, triannual: 0.80 };
      const interval = planIntervals[planType] || '6';
      const discount = discountMultiplier[planType] || 0.85;

      const panels = panelCount || 0;
      const ppp = pricePerPanel || 9;
      const discountedPrice = panels > 0 ? (panels * ppp * discount).toFixed(2) : (servicePrice * discount).toFixed(2);
      const discountedPPP = (ppp * discount).toFixed(2);

      await pool.query(
        `DELETE FROM jobs WHERE customer_id = $1 AND is_recurring = true AND (status IS NULL OR status = 'scheduled') AND completed_date IS NULL`,
        [customerId]
      );

      await pool.query('UPDATE customers SET is_recurring = true WHERE id = $1', [customerId]);

      const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      const customer = customerResult.rows[0] || {};

      const baseJob = {
        job_description: 'Solar Panel Cleaning',
        price: discountedPrice,
        price_per_panel: discountedPPP,
        panel_count: panels,
        preferred_days: customer.preferred_days || '',
        preferred_time: customer.preferred_time || '',
        technician: ''
      };

      const { generateRecurringJobs } = require('./jobs');
      await generateRecurringJobs(customerId, baseJob, interval, new Date());

      console.log(`Auto-enrolled customer ${customerId} in ${planType} plan at $${discountedPrice}/cleaning`);
    } else if (customerId && !isEnrolledByTech) {
      const plans = ['annual', 'biannual', 'triannual'];
      enrollmentTokens = {};
      for (const plan of plans) {
        const token = generateToken();
        await pool.query(
          `INSERT INTO enrollment_tokens (token, customer_id, plan_type, service_price, price_per_panel, panel_count) VALUES ($1, $2, $3, $4, $5, $6)`,
          [token, customerId, plan, servicePrice, pricePerPanel, panelCount]
        );
        enrollmentTokens[plan] = `${baseUrl}/enroll/${token}`;
      }
    }

    let previousServiceData = null;
    if (customerId) {
      try {
        const prevResult = await pool.query(
          `SELECT rs.completion_data, rs.completed_at FROM route_stops rs WHERE rs.customer_id = $1 AND rs.completed_at IS NOT NULL ORDER BY rs.completed_at DESC LIMIT 1 OFFSET 1`,
          [customerId]
        );
        if (prevResult.rows.length > 0) {
          const prevRow = prevResult.rows[0];
          const prevData = prevRow.completion_data ? (typeof prevRow.completion_data === 'string' ? JSON.parse(prevRow.completion_data) : prevRow.completion_data) : {};
          previousServiceData = {
            buildup_level: prevData.buildup_level || prevData.buildupLevel || null,
            surface_damage: prevData.surface_damage || prevData.surfaceDamage || null,
            system_checks: prevData.system_checks || prevData.systemChecks || null,
            service_date: prevRow.completed_at
          };
        }
      } catch (err) {
        console.error('Error fetching previous service data:', err);
      }
    }

    const html = buildAssessmentEmailHTML(assessmentData, enrollmentTokens, previousServiceData);
    const subject = `Your Solar Panel Service Report - ${assessmentData.customerName || 'Customer'} - ${assessmentData.serviceDate ? new Date(assessmentData.serviceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent Service'}`;

    const { data, error } = await resend.emails.send({
      from: 'Sunton Solutions <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    });

    if (error) {
      console.error('Resend assessment error:', error);
      const msg = error.message || 'Failed to send email';
      if (msg.includes('testing emails') || msg.includes('only send')) {
        return res.status(403).json({ error: 'Free tier: Can only send to the account owner email. Verify a domain at resend.com/domains for other addresses.' });
      }
      return res.status(500).json({ error: msg });
    }

    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Assessment email error:', err);
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

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

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const html = buildRouteEmailHTML(routeData, baseUrl);
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
