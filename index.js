import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { Resend } from "resend";
import MailChecker from "mailchecker";
import dns from "dns/promises";
import crypto from "crypto";

async function validaEmail(email) {
  const formatoOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!formatoOk) return { valido: false, motivo: "Formato email non valido." };

  if (!MailChecker.isValid(email)) {
    return { valido: false, motivo: "Email temporanea non accettata." };
  }

  const dominio = email.split("@")[1];
  try {
    const mx = await dns.resolveMx(dominio);
    if (!mx || mx.length === 0) {
      return { valido: false, motivo: "Il dominio email non esiste." };
    }
  } catch {
    return { valido: false, motivo: "Il dominio email non esiste." };
  }

  return { valido: true };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeOptionalTextList(value) {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeOptionalText(item))
      .filter(Boolean);
    return normalized.length ? normalized : undefined;
  }

  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.split(/\n\s*\n/) : undefined;
}

function buildQuizProperties(quizAnswers = []) {
  if (!Array.isArray(quizAnswers)) return {};

  const propertyNames = {
    guidaLavaggio: "cmr_guida_lavaggio",
    porosita: "cmr_porosita",
    sts: "cmr_sts",
    spessoreDensita: "cmr_spessore_densita",
    personalitaRicci: "cmr_personalita_ricci",
    problemaPrincipale: "cmr_problema_principale",
    obiettivoDesiderato: "cmr_obiettivo_desiderato",
  };

  return quizAnswers.reduce(
    (properties, answer) => {
      if (!answer?.id) return properties;

      const propertyName = propertyNames[answer.id] || `cmr_${answer.id}`;
      properties[propertyName] = answer.label || answer.value || "";
      properties[`${propertyName}_value`] = answer.value || "";

      return properties;
    },
    {
      cmr_risposte_test: quizAnswers,
      cmr_test_completed_at: new Date().toISOString(),
    }
  );
}

function getKlaviyoHeaders() {
  return {
    Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
    accept: "application/vnd.api+json",
    "content-type": "application/vnd.api+json",
    revision: "2026-04-15",
  };
}

async function syncQuizProfileToKlaviyo({
  email,
  name,
  phone,
  newsletterConsent,
  kitConsigliato,
  quizAnswers,
}) {
  const headers = getKlaviyoHeaders();
  const searchResponse = await axios.get(
    "https://a.klaviyo.com/api/profiles/",
    {
      headers,
      params: { filter: `equals(email,"${email}")` },
    }
  );

  const existingProfile = searchResponse.data?.data?.[0];
  const profileProperties = {
    privacy_policy_confirmed: true,
    newsletter_opt_in: Boolean(newsletterConsent),
    kit_consigliato: kitConsigliato,
    ...buildQuizProperties(quizAnswers),
  };

  if (!existingProfile?.id) {
    await axios.post(
      "https://a.klaviyo.com/api/profiles/",
      {
        data: {
          type: "profile",
          attributes: {
            email,
            first_name: name || undefined,
            phone_number: phone || undefined,
            properties: profileProperties,
          },
        },
      },
      { headers }
    );
  } else {
    await axios.patch(
      `https://a.klaviyo.com/api/profiles/${existingProfile.id}/`,
      {
        data: {
          type: "profile",
          id: existingProfile.id,
          attributes: {
            first_name: name || undefined,
            phone_number: phone || undefined,
            properties: profileProperties,
          },
        },
      },
      { headers }
    );
  }

  console.log("[Klaviyo] Quiz profile synced", {
    profileId: existingProfile?.id || "created",
    answerCount: Array.isArray(quizAnswers) ? quizAnswers.length : 0,
  });
}

dotenv.config();

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase non è configurato nel backend");
  return {
    url,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  };
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

async function findQuizSession(emailNormalized, sessionId) {
  const { url, headers } = getSupabaseConfig();
  const { data: byEmail } = await axios.get(`${url}/rest/v1/quiz_sessions`, {
    headers,
    params: { select: "*", email_normalized: `eq.${emailNormalized}`, limit: 1 },
  });
  if (byEmail?.[0]) {
    return { session: byEmail[0], sessionId: byEmail[0].session_id || sessionId };
  }
  if (!sessionId) return { session: null, sessionId: crypto.randomUUID() };

  const { data: bySession } = await axios.get(`${url}/rest/v1/quiz_sessions`, {
    headers,
    params: { select: "*", session_id: `eq.${sessionId}`, limit: 1 },
  });
  const session = bySession?.[0] || null;
  if (session && session.email_normalized !== emailNormalized) {
    return { session: null, sessionId: crypto.randomUUID() };
  }
  return { session, sessionId };
}

async function saveQuizSession(existingSession, payload) {
  const { url, headers } = getSupabaseConfig();
  if (existingSession?.id) {
    const { data } = await axios.patch(
      `${url}/rest/v1/quiz_sessions`,
      { ...payload, updated_at: new Date().toISOString() },
      { headers: { ...headers, Prefer: "return=representation" }, params: { id: `eq.${existingSession.id}` } }
    );
    return data?.[0];
  }
  const { data } = await axios.post(
    `${url}/rest/v1/quiz_sessions`,
    payload,
    { headers: { ...headers, Prefer: "return=representation" } }
  );
  return data?.[0];
}

async function updateQuizSession(id, values) {
  if (!id) return;
  const { url, headers } = getSupabaseConfig();
  await axios.patch(
    `${url}/rest/v1/quiz_sessions`,
    { ...values, updated_at: new Date().toISOString() },
    { headers, params: { id: `eq.${id}` } }
  );
}

async function saveMetaLeadEvent(values) {
  try {
    const { url, headers } = getSupabaseConfig();
    await axios.post(`${url}/rest/v1/meta_lead_events`, values, { headers });
  } catch (error) {
    console.error("[Meta CAPI] Unable to save event history", {
      eventId: values.event_id,
      status: error?.response?.status,
      message: error?.response?.data?.message || error.message,
    });
  }
}

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || undefined;
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function trackMetaLead({ req, session, email, sourceUrl }) {
  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();
  if (!session?.id) return;

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN;
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v25.0";
  const eventId = `quiz_lead_${session.id}_${crypto.randomUUID()}`;
  const attemptNumber = Number(session.meta_lead_attempts || 0) + 1;
  const attemptedAt = new Date().toISOString();
  const eventLog = {
    quiz_session_id: session.id,
    email_normalized: normalizeEmail(email),
    event_id: eventId,
    event_name: "Lead",
    test_mode: Boolean(testEventCode),
    attempted_at: attemptedAt,
  };

  console.info("[Meta CAPI] Lead attempt", {
    sessionId: session.id,
    eventId,
    attemptNumber,
    pixelConfigured: Boolean(pixelId),
    tokenConfigured: Boolean(accessToken),
    testMode: Boolean(testEventCode),
  });
  await updateQuizSession(session.id, {
    meta_lead_event_id: eventId,
    meta_lead_attempts: attemptNumber,
    meta_lead_last_attempt_at: attemptedAt,
    meta_lead_http_status: null,
    meta_lead_response: null,
  });

  if (!pixelId || !accessToken) {
    console.warn("[Meta CAPI] Skipped: missing environment variables", {
      pixelConfigured: Boolean(pixelId),
      tokenConfigured: Boolean(accessToken),
    });
    await updateQuizSession(session.id, {
      meta_lead_error: "Meta Conversions API non configurata",
      meta_lead_response: {
        stage: "configuration",
        pixelConfigured: Boolean(pixelId),
        tokenConfigured: Boolean(accessToken),
      },
    });
    await saveMetaLeadEvent({
      ...eventLog,
      error: "Meta Conversions API non configurata",
      response: {
        stage: "configuration",
        pixelConfigured: Boolean(pixelId),
        tokenConfigured: Boolean(accessToken),
      },
    });
    return;
  }

  const emailHash = crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");
  const event = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: normalizeSourceUrl(sourceUrl),
    user_data: {
      em: [emailHash],
      external_id: [emailHash],
      client_ip_address: getRequestIp(req),
      client_user_agent: req.headers["user-agent"],
    },
    custom_data: {
      content_name: "Quiz Conosco i Miei Ricci",
      content_category: "Quiz Funnel",
    },
  };

  try {
    const body = { data: [event] };
    if (testEventCode) body.test_event_code = testEventCode;
    const metaResponse = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${pixelId}/events`,
      body,
      { params: { access_token: accessToken } }
    );
    console.info("[Meta CAPI] Lead accepted", {
      sessionId: session.id,
      eventId,
      status: metaResponse.status,
      eventsReceived: metaResponse.data?.events_received,
    });
    await updateQuizSession(session.id, {
      meta_lead_event_id: eventId,
      meta_lead_sent_at: new Date().toISOString(),
      meta_lead_error: null,
      meta_lead_http_status: metaResponse.status,
      meta_lead_response: {
        events_received: metaResponse.data?.events_received ?? null,
        messages: metaResponse.data?.messages ?? [],
        fbtrace_id: metaResponse.data?.fbtrace_id ?? null,
      },
    });
    await saveMetaLeadEvent({
      ...eventLog,
      sent_at: new Date().toISOString(),
      http_status: metaResponse.status,
      response: {
        events_received: metaResponse.data?.events_received ?? null,
        messages: metaResponse.data?.messages ?? [],
        fbtrace_id: metaResponse.data?.fbtrace_id ?? null,
      },
    });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error.message || "Errore Meta sconosciuto";
    const status = error?.response?.status || null;
    const metaError = error?.response?.data?.error;
    console.error("[Meta CAPI] Lead rejected", {
      sessionId: session.id,
      eventId,
      status,
      code: metaError?.code,
      type: metaError?.type,
      message,
    });
    await updateQuizSession(session.id, {
      meta_lead_event_id: eventId,
      meta_lead_error: String(message).slice(0, 1000),
      meta_lead_http_status: status,
      meta_lead_response: {
        code: metaError?.code ?? null,
        type: metaError?.type ?? null,
        error_subcode: metaError?.error_subcode ?? null,
        fbtrace_id: metaError?.fbtrace_id ?? null,
      },
    });
    await saveMetaLeadEvent({
      ...eventLog,
      http_status: status,
      error: String(message).slice(0, 1000),
      response: {
        code: metaError?.code ?? null,
        type: metaError?.type ?? null,
        error_subcode: metaError?.error_subcode ?? null,
        fbtrace_id: metaError?.fbtrace_id ?? null,
      },
    });
  }
}

async function trackMetaPageView({ req, sourceUrl }) {
  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN;
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v25.0";
  const eventId = `quiz_pageview_${crypto.randomUUID()}`;

  if (!pixelId || !accessToken) {
    console.warn("[Meta CAPI] PageView skipped: missing environment variables", {
      eventId,
      pixelConfigured: Boolean(pixelId),
      tokenConfigured: Boolean(accessToken),
    });
    return { eventId, sent: false };
  }

  const event = {
    event_name: "PageView",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: normalizeSourceUrl(sourceUrl),
    user_data: {
      client_ip_address: getRequestIp(req),
      client_user_agent: req.headers["user-agent"],
    },
    custom_data: {
      content_name: "Quiz Conosco i Miei Ricci",
      content_category: "Quiz Funnel",
    },
  };

  const body = { data: [event] };
  if (testEventCode) body.test_event_code = testEventCode;
  const metaResponse = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${pixelId}/events`,
    body,
    { params: { access_token: accessToken } }
  );
  console.info("[Meta CAPI] PageView accepted", {
    eventId,
    status: metaResponse.status,
    eventsReceived: metaResponse.data?.events_received,
  });
  return { eventId, sent: true };
}

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://frontend-riccia-test.vercel.app",
  "https://laragazzariccia.com",
  "https://frontend-riccia-test-qhyizd7i0-hugos-projects-f083374c.vercel.app"
];
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Riccia Test API",
    runtime: "express",
    version: "express-v1",
    metaConfigured: Boolean(
      process.env.META_PIXEL_ID && process.env.META_CONVERSIONS_API_TOKEN
    ),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

function generaEmailHTML({
  nome,
  passi,
  prodotti,
  consiglio,
  consiglioStyling,
  consiglioLavaggio,
  consiglioSTS,
}) {
  const LOGO_URL =
    "https://laragazzariccia.com/cdn/shop/files/logo_riccia_2026_2x_08368373-224e-4a3c-9095-ee095c1f98a8.png";
  const PINK = "#E92176";
  const PINK_LIGHT = "#fbeaf0";
  const PINK_MID = "#f4c0d1";
  const TEXT_DARK = "#4B1528";
  const TEXT_MID = "#72243E";
  const TEXT_SOFT = "#993556";

  const passiHTML = passi
    .map((passo, i) => {
      const [label, ...rest] = passo.split(":");
      const testo = rest.length > 0 ? rest.join(":").trim() : passo;

      return `
      <tr>
        <td style="padding: 0 0 14px 0;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="34" valign="top" style="padding-right: 14px;">
                <div style="
                  width: 30px;
                  height: 30px;
                  border-radius: 50%;
                  background: ${PINK_LIGHT};
                  color: ${PINK};
                  font-size: 14px;
                  font-weight: 800;
                  text-align: center;
                  line-height: 30px;
                  font-family: Arial, sans-serif;
                ">${i + 1}</div>
              </td>
              <td valign="middle" style="font-family: Arial, sans-serif; font-size: 16px; color: ${TEXT_MID}; line-height: 1.55;">
                <strong>${escapeHtml(label)}:</strong> ${escapeHtml(testo)}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join("");

  const prodottiHTML = prodotti
    .map(
      (p) => `
      <td class="product-cell" width="33.33%" valign="top" style="padding: 0 8px 18px 8px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1.5px solid ${PINK_MID}; border-radius: 14px; background: #ffffff;">
          <tr>
            <td style="padding: 12px; text-align: center;">
              <a href="${escapeHtml(p.link)}" target="_blank" style="text-decoration: none;">
                <img src="${escapeHtml(p.immagine)}" alt="${escapeHtml(p.nome)}" width="140" height="140" style="width: 100%; max-width: 140px; height: 140px; object-fit: cover; border-radius: 10px; display: block; margin: 0 auto 10px auto;" />
                <span style="font-family: Arial, sans-serif; font-size: 14px; font-weight: 700; color: ${TEXT_DARK}; line-height: 1.35; display: block;">${escapeHtml(p.nome)}</span>
              </a>
            </td>
          </tr>
        </table>
      </td>`
    )
    .join("");

  const consiglioHTML = consiglio
    ? `
          <tr>
            <td class="content-cell" style="background: white; padding: 4px 34px 24px 34px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${PINK_LIGHT}; border: 1.5px solid ${PINK_MID}; border-radius: 14px;">
                <tr>
                  <td style="padding: 18px;">
                    <p style="margin: 0 0 8px 0; font-family: Arial, sans-serif; font-size: 14px; font-weight: 800; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.08em;">
                      Il consiglio per i tuoi ricci
                    </p>
                    <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                      ${escapeHtml(consiglio)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : "";

  const consiglioStylingHTML = consiglioStyling
    ? `
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 10px; background: ${PINK_LIGHT}; border: 1.5px solid ${PINK_MID}; border-radius: 14px;">
                <tr>
                  <td style="padding: 18px;">
                    <p style="margin: 0 0 8px 0; font-family: Arial, sans-serif; font-size: 14px; font-weight: 800; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.08em;">
                      Nota di styling
                    </p>
                    <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                      ${escapeHtml(consiglioStyling)}
                    </p>
                  </td>
                </tr>
              </table>`
    : "";

  const consiglioLavaggioHTML = consiglioLavaggio
    ? `
          <tr>
            <td class="content-cell" style="background: white; padding: 4px 34px 18px 34px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #b269a10a; border: 1.5px solid #BB75AA; border-radius: 14px;">
                <tr>
                  <td style="padding: 18px;">
                    <p style="margin: 0 0 8px 0; font-family: Arial, sans-serif; font-size: 14px; font-weight: 800; color: #E82176; text-transform: uppercase; letter-spacing: 0.08em;">
                      Consiglio di lavaggio
                    </p>
                    <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                      ${escapeHtml(consiglioLavaggio)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : "";

  const consiglioSTSHTML = consiglioSTS?.length
    ? `
          <tr>
            <td class="content-cell" style="background: white; padding: 4px 34px 24px 34px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${PINK_LIGHT}; border: 1.5px solid ${PINK_MID}; border-radius: 14px;">
                <tr>
                  <td style="padding: 18px;">
                    <p style="margin: 0 0 10px 0; font-family: Arial, sans-serif; font-size: 14px; font-weight: 800; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.08em;">
                      Un consiglio per questo momento
                    </p>
                    ${consiglioSTS.map((testo) => `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 12px 0; background: #ffffff; border: 1px solid ${PINK_MID}; border-radius: 10px;"><tr><td style="padding: 14px; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">${escapeHtml(testo)}</td></tr></table>`).join("")}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>La tua routine personalizzata</title>
  <style>
    @media only screen and (max-width: 560px) {
      .email-wrapper { padding: 12px 8px !important; }
      .email-container { width: 100% !important; }
      .content-cell { padding-left: 18px !important; padding-right: 18px !important; }
      .product-cell { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background: #fff5f9;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" class="email-wrapper" style="background: #fff5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="640" class="email-container" style="max-width: 640px; width: 640px;">
          <tr>
            <td style="background: white; padding: 28px 24px 22px 24px; text-align: center; border-radius: 18px 18px 0 0;">
              <img src="${LOGO_URL}" alt="La Ragazza Riccia" width="220" style="display: block; width: 220px; max-width: 80%; height: auto; margin: 0 auto; border: 0;" />
            </td>
          </tr>

          <tr>
            <td style="height: 10px; background: ${PINK};"></td>
          </tr>

          <tr>
            <td class="content-cell" style="background: white; padding: 34px 34px 10px 34px;">
              <p style="margin: 0 0 18px 0; font-family: Arial, sans-serif; font-size: 24px; font-weight: 800; color: ${TEXT_DARK}; line-height: 1.35; text-transform: uppercase;">
                ABBIAMO ANALIZZATO LE TUE RISPOSTE
              </p>
              <p style="margin: 0 0 12px 0; font-family: Arial, sans-serif; font-size: 16px; color: ${TEXT_MID}; line-height: 1.7;">
                I tuoi ricci sono unici e per questo abbiamo preparato una routine personalizzata basata sul metodo Conosco i Miei Ricci®.
              </p>
              <p style="margin: 0; font-family: Arial, sans-serif; font-size: 16px; color: ${TEXT_MID}; line-height: 1.7;">
                Di seguito trovi i prodotti che ti consigliamo e l'ordine in cui utilizzarli.
              </p>
            </td>
          </tr>

          <tr>
            <td class="content-cell" style="background: white; padding: 24px 34px 18px 34px;">
              <p style="margin: 0 0 18px 0; font-family: Arial, sans-serif; font-size: 15px; font-weight: 800; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.1em;">
                La tua routine personalizzata
              </p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${passiHTML}
              </table>
            </td>
          </tr>

          ${consiglioLavaggioHTML}

          ${consiglioHTML}

          ${consiglioSTSHTML}

          <tr>
            <td class="content-cell" style="background: white; padding: 6px 26px 12px 26px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>${prodottiHTML}</tr>
              </table>
              ${consiglioStylingHTML}
            </td>
          </tr>

          <tr>
            <td class="content-cell" style="background: white; padding: 18px 34px 34px 34px; border-radius: 0 0 18px 18px;">
              <p style="margin: 0 0 10px 0; font-family: Arial, sans-serif; font-size: 15px; font-weight: 800; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.08em;">
                COME UTILIZZARE I PRODOTTI?
              </p>
              <p style="margin: 0 0 14px 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                Clicca su ogni prodotto per scoprire nella sezione "Consigli d'uso" come utilizzarlo al meglio in base alle esigenze dei tuoi capelli.
              </p>
              <p style="margin: 0 0 20px 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                Ti consigliamo di seguire la routine per almeno 4-6 settimane prima di valutarne i risultati, mi raccomando facci sapere se hai dubbi o bisogno di supporto.
              </p>
              <p style="margin: 0 0 20px 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                Per qualsiasi dubbio puoi contattarci anche su WhatsApp:
                <a href="https://wa.me/393516101655" target="_blank" style="color: ${PINK}; font-weight: 800; text-decoration: underline;">scrivici qui</a>.
              </p>
              <p style="margin: 0 0 10px 0; font-family: Arial, sans-serif; font-size: 16px; font-weight: 800; color: ${TEXT_DARK};">
                Un ultimo consiglio da Audrey 🩷
              </p>
              <p style="margin: 0 0 14px 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                Riccioluta i prodotti sono importanti, ma il vero cambiamento arriva quando impari a conoscere i tuoi ricci e a rispondere alle loro esigenze nel tempo.
              </p>
              <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                Per questo motivo ho creato il metodo Conosco i Miei Ricci®: perché non esiste una routine perfetta per tutte, ma esiste quella giusta per te.
              </p>
              <p style="margin: 18px 0 0 0; font-family: Arial, sans-serif; font-size: 16px; font-weight: 800; color: ${TEXT_DARK}; line-height: 1.5;">
                Team La Ragazza Riccia
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 0 8px 0; text-align: center;">
              <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: ${TEXT_SOFT};">
                Hai ricevuto questa email perché hai completato il test su
                <a href="https://laragazzariccia.com" style="color: ${PINK}; text-decoration: none;">laragazzariccia.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}


async function getShopifyAccessToken() {
  if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
    throw new Error("Credenziali Shopify non configurate");
  }

  const params = new URLSearchParams();

  params.append("grant_type", "client_credentials");
  params.append("client_id", process.env.SHOPIFY_CLIENT_ID);
  params.append("client_secret", process.env.SHOPIFY_CLIENT_SECRET);

  const response = await axios.post(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
    params,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data.access_token;
}

function generaCodigoCoupon() {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

  return `RICCI-${random}`;
}

async function creaShopifyCoupon() {
  if (!process.env.SHOPIFY_STORE_DOMAIN) {
    throw new Error("SHOPIFY_STORE_DOMAIN non configurato");
  }

  const accessToken = await getShopifyAccessToken();

  const code = generaCodigoCoupon();

  const startsAt = new Date();
  const endsAt = new Date(
    startsAt.getTime() + 48 * 60 * 60 * 1000
  );

  const percentuale = Number(process.env.SHOPIFY_TEST_COUPON_PERCENT);

  if (!Number.isFinite(percentuale) || percentuale <= 0 || percentuale > 100) {
    throw new Error("SHOPIFY_TEST_COUPON_PERCENT deve essere compreso tra 1 e 100");
  }

  const mutation = `
    mutation CreateDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(
        basicCodeDiscount: $basicCodeDiscount
      ) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              startsAt
              endsAt
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }

        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `Test Conosco i Miei Ricci - ${code}`,

      code,

      startsAt: startsAt.toISOString(),

      endsAt: endsAt.toISOString(),

      context: {
        all: "ALL",
      },

      customerGets: {
        value: {
          percentage: percentuale / 100,
        },

        items: {
          all: true,
        },
      },

      appliesOncePerCustomer: true,

      usageLimit: 1,
    },
  };

  const response = await axios.post(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`,
    {
      query: mutation,
      variables,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    }
  );

  if (response.data?.errors?.length) {
    console.error(
      "Shopify GraphQL errors:",
      response.data.errors
    );

    throw new Error(
      response.data.errors
        .map((error) => error.message)
        .join(", ")
    );
  }

  const result =
    response.data?.data?.discountCodeBasicCreate;

  if (result?.userErrors?.length) {
    console.error(
      "Shopify discount errors:",
      result.userErrors
    );

    throw new Error(
      result.userErrors
        .map((error) => error.message)
        .join(", ")
    );
  }

  if (!result?.codeDiscountNode?.id) {
    throw new Error(
      "Shopify non ha restituito il coupon creato"
    );
  }

  return {
    id: result.codeDiscountNode.id,
    code,
    percent: percentuale,
    startsAt: startsAt.toISOString(),
    expiresAt: endsAt.toISOString(),
  };
}

app.post("/api/pageview", async (req, res) => {
  try {
    const result = await trackMetaPageView({ req, sourceUrl: req.body?.sourceUrl });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("[Meta CAPI] PageView rejected", {
      status: error?.response?.status,
      message: error?.response?.data?.error?.message || error.message,
    });
    return res.status(200).json({ success: false });
  }
});

app.post("/api/subscribe", async (req, res) => {
  try {
    const {
      email,
      name,
      phone,
      rutina,
      prodotti,
      consiglio,
      consiglioStyling,
      consiglioLavaggio,
      consiglioSTS,
      // Compatibilità con le richieste generate prima del nuovo campo dedicato.
      consiglioSituazioni,
      newsletterConsent,
      quizAnswers,
      sessionId,
      sourceUrl,
    } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    if (typeof rutina !== "string" || !rutina.trim() || !Array.isArray(prodotti) || !prodotti.length) {
      return res.status(400).json({
        success: false,
        message: "La routine e i prodotti consigliati sono obbligatori.",
      });
    }

    const { valido, motivo } = await validaEmail(email);
    if (!valido) {
      return res.status(400).json({
        success: false,
        emailError: true,
        message: motivo,
      });
    }

    const emailNormalized = normalizeEmail(email);
    const requestedSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
      ? sessionId
      : crypto.randomUUID();
    const kitConsigliato = Array.isArray(prodotti)
      ? prodotti.map((prodotto) => prodotto?.nome).filter(Boolean).join(" | ")
      : "";
    const sessionData = {
      name: name || null,
      answers: Array.isArray(quizAnswers) ? quizAnswers : [],
      recommended_kits: Array.isArray(prodotti) ? prodotti : [],
      kit_consigliato: kitConsigliato || null,
    };
    const sendRoutineEmail = async () => {
      const lineas = rutina.split("\n- ").filter((r) => r.trim() !== "");
      const passi = lineas.slice(1);
      const html = generaEmailHTML({
        nome: name || "amica",
        passi,
        prodotti,
        consiglio: normalizeOptionalText(consiglio),
        consiglioStyling: normalizeOptionalText(consiglioStyling),
        consiglioLavaggio: normalizeOptionalText(consiglioLavaggio),
        consiglioSTS:
          normalizeOptionalTextList(consiglioSTS) ||
          normalizeOptionalTextList(consiglioSituazioni),
      });

      const { data, error } = await resend.emails.send({
        from: "La Ragazza Riccia <info@laragazzariccia.com>",
        to: email,
        subject: `La tua routine personalizzata è pronta, ${name || "amica"}!`,
        html,
      });

      if (error) {
        console.error("Resend error:", error);
        const sendError = new Error(error.message || "Resend non ha accettato l'email");
        sendError.statusCode = 502;
        throw sendError;
      }

      console.log("Routine email accepted by Resend:", data?.id);
      return data;
    };
    const {
      session: existingQuizSession,
      sessionId: normalizedSessionId,
    } = await findQuizSession(emailNormalized, requestedSessionId);
    const existingCouponIsActive =
      existingQuizSession?.coupon_code &&
      existingQuizSession?.coupon_expires_at &&
      new Date(existingQuizSession.coupon_expires_at).getTime() > Date.now();

    if (existingCouponIsActive) {
      const refreshedQuizSession = await saveQuizSession(existingQuizSession, sessionData);
      await sendRoutineEmail();
      await updateQuizSession(refreshedQuizSession?.id, { email_sent: true });

      try {
        await trackMetaLead({ req, session: refreshedQuizSession, email, sourceUrl });
        await syncQuizProfileToKlaviyo({
          email,
          name,
          phone,
          newsletterConsent,
          kitConsigliato,
          quizAnswers,
        });
        await updateQuizSession(refreshedQuizSession?.id, { klaviyo_synced: true });
      } catch (integrationError) {
        console.error("Post-email integration error:", integrationError);
      }

      return res.status(200).json({
        success: true,
        emailError: false,
        reusedCoupon: true,
        coupon: {
          code: existingQuizSession.coupon_code,
          percent: existingQuizSession.coupon_percent,
          expiresAt: existingQuizSession.coupon_expires_at,
        },
        message: "Coupon esistente recuperato e routine inviata",
      });
    }

    const coupon = await creaShopifyCoupon();
    console.log("Coupon Shopify creato:", coupon.code);
    const savedQuizSession = await saveQuizSession(existingQuizSession, {
      ...sessionData,
      ...(!existingQuizSession && { session_id: normalizedSessionId, email_normalized: emailNormalized }),
      coupon_code: coupon.code,
      coupon_percent: coupon.percent,
      coupon_created_at: coupon.startsAt,
      coupon_expires_at: coupon.expiresAt,
      coupon_status: "active",
      klaviyo_synced: false,
      email_sent: false,
    });
    await sendRoutineEmail();
    await updateQuizSession(savedQuizSession?.id, { email_sent: true });

    try {
      await trackMetaLead({ req, session: savedQuizSession, email, sourceUrl });

      const headers = getKlaviyoHeaders();
      await syncQuizProfileToKlaviyo({
        email,
        name,
        phone,
        newsletterConsent,
        kitConsigliato,
        quizAnswers,
      });

      if (newsletterConsent) {
        await axios.post(
          "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs",
          {
            data: {
              type: "profile-subscription-bulk-create-job",
              attributes: {
                profiles: {
                  data: [
                    {
                      type: "profile",
                      attributes: {
                        email,
                        subscriptions: {
                          email: { marketing: { consent: "SUBSCRIBED" } },
                        },
                      },
                    },
                  ],
                },
              },
              relationships: {
                list: {
                  data: { type: "list", id: process.env.KLAVIYO_LIST_ID },
                },
              },
            },
          },
          { headers }
        );
      }

      await updateQuizSession(savedQuizSession?.id, { klaviyo_synced: true });
    } catch (integrationError) {
      console.error("Post-email integration error:", integrationError);
    }

    return res.status(200).json({
      success: true,
      emailError: false,
      coupon,
      message: "Klaviyo profile synced and email sent",
    });
  } catch (error) {
    console.error(error);
    return res.status(error?.statusCode || error?.response?.status || 500).json({
      success: false,
      message:
        error?.response?.data?.errors?.[0]?.detail ||
        error?.message ||
        "Internal server error",
      error: error?.response?.data || error.message,
    });
  }
});

app.post("/api/subscribe-salone", async (req, res) => {
  try {
    const { email, nome, nomeSalone } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const { valido, motivo } = await validaEmail(email);
    if (!valido) {
      return res.status(400).json({
        success: false,
        emailError: true,
        message: motivo,
      });
    }

    const headers = {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
      revision: "2026-04-15",
    };

    // Buscar si ya existe el perfil
    const searchResponse = await axios.get(
      `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${email}")`,
      { headers }
    );

    const existingProfile = searchResponse.data?.data?.[0];

    if (!existingProfile?.id) {
      await axios.post(
        "https://a.klaviyo.com/api/profiles/",
        {
          data: {
            type: "profile",
            attributes: {
              email,
              first_name: nome || undefined,
              properties: {
                nome_salone: nomeSalone || undefined,
                privacy_policy_confirmed: true,
              },
            },
          },
        },
        { headers }
      );
    }

    // Suscribir a la lista UHrAZE
    await axios.post(
      "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs",
      {
        data: {
          type: "profile-subscription-bulk-create-job",
          attributes: {
            profiles: {
              data: [
                {
                  type: "profile",
                  attributes: {
                    email,
                    subscriptions: {
                      email: { marketing: { consent: "SUBSCRIBED" } },
                    },
                  },
                },
              ],
            },
          },
          relationships: {
            list: {
              data: { type: "list", id: "UHrAZE" },
            },
          },
        },
      },
      { headers }
    );

    return res.status(200).json({
      success: true,
      message: existingProfile?.id
        ? "Profilo esistente aggiornato"
        : "Nuovo profilo creato e iscritto",
    });
  } catch (error) {
    console.error(error);
    return res.status(error?.response?.status || 500).json({
      success: false,
      message:
        error?.response?.data?.errors?.[0]?.detail || "Internal server error",
      error: error?.response?.data || error.message,
    });
  }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  console.log(`Riccia Test API listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, closing HTTP server`);
  server.close((error) => {
    if (error) {
      console.error("Error while closing HTTP server:", error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
