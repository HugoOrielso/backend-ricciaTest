import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import { Resend } from "resend";

dotenv.config();

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  "http://localhost:5173",
  "https://frontend-riccia-test.vercel.app",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.get("/", (req, res) => {
  res.status(200).json({ message: "on vercel" });
});

// ─── Genera el HTML del email ────────────────────────────────────────────────
function generaEmailHTML({ nome, passi, prodotti }) {
  const PINK = "#E92176";
  const PINK_LIGHT = "#fbeaf0";
  const PINK_MID = "#f4c0d1";
  const TEXT_DARK = "#4B1528";
  const TEXT_MID = "#72243E";
  const TEXT_SOFT = "#993556";

  const passiHTML = passi
    .map(
      (passo, i) => `
      <tr>
        <td style="padding: 0 0 12px 0;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="32" valign="top" style="padding-right: 12px;">
                <div style="
                  width: 28px;
                  height: 28px;
                  border-radius: 50%;
                  background: ${PINK_LIGHT};
                  color: ${PINK};
                  font-size: 13px;
                  font-weight: 700;
                  text-align: center;
                  line-height: 28px;
                  font-family: sans-serif;
                ">${i + 1}</div>
              </td>
              <td valign="middle" style="
                font-family: sans-serif;
                font-size: 15px;
                color: ${TEXT_MID};
                line-height: 1.5;
              ">${passo}</td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join("");

  const prodottiHTML = prodotti
    .map(
      (p) => `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" class="prodotto-card" style="margin-bottom: 16px; border: 1.5px solid ${PINK_MID}; border-radius: 16px; overflow: hidden; background: white;">
        <tr class="prodotto-row">
          <td class="prodotto-img-cell" width="110" valign="top" style="padding: 16px 0 16px 16px;">
            <img src="${p.immagine}" alt="${p.nome}" width="90" height="90" style="border-radius: 10px; object-fit: cover; display: block;" />
          </td>
          <td class="prodotto-text-cell" valign="middle" style="padding: 16px;">
            <p style="margin: 0 0 6px 0; font-family: sans-serif; font-size: 15px; font-weight: 700; color: ${TEXT_DARK};">${p.nome}</p>
            <p style="margin: 0 0 12px 0; font-family: sans-serif; font-size: 13px; color: ${TEXT_SOFT}; line-height: 1.5;">${p.descrizione}</p>
            <a href="${p.link}" style="
              display: inline-block;
              background: ${PINK};
              color: white;
              font-family: sans-serif;
              font-size: 13px;
              font-weight: 600;
              text-decoration: none;
              padding: 9px 20px;
              border-radius: 10px;
            ">Acquista ora →</a>
          </td>
        </tr>
      </table>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>La tua routine personalizzata</title>
  <style>
    @media only screen and (max-width: 480px) {
      .email-wrapper { padding: 12px 8px !important; }
      .email-container { width: 100% !important; }
      .header-cell { padding: 22px 20px !important; }
      .header-title { font-size: 20px !important; }
      .content-cell { padding: 20px 16px !important; }
      .prodotto-row { display: block !important; }
      .prodotto-img-cell {
        display: block !important;
        width: 100% !important;
        padding: 16px 16px 0 16px !important;
        text-align: center !important;
      }
      .prodotto-img-cell img {
        width: 120px !important;
        height: 120px !important;
        margin: 0 auto !important;
      }
      .prodotto-text-cell {
        display: block !important;
        width: 100% !important;
        padding: 12px 16px 16px 16px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background: #fff5f9;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" class="email-wrapper" style="background: #fff5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" class="email-container" style="max-width: 600px; width: 600px;">

          <!-- Header -->
          <tr>
            <td class="header-cell" style="
              background: ${PINK};
              border-radius: 20px 20px 0 0;
              padding: 28px 32px;
              text-align: center;
            ">
              <p style="margin: 0 0 6px 0; font-family: sans-serif; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.75); letter-spacing: 0.08em; text-transform: uppercase;">La Ragazza Riccia</p>
              <h1 class="header-title" style="margin: 0; font-family: sans-serif; font-size: 26px; font-weight: 800; color: white; line-height: 1.3;">
                La tua routine è pronta, ${nome}! 🌀
              </h1>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td class="content-cell" style="background: white; padding: 24px 32px 8px 32px;">
              <p style="margin: 0; font-family: sans-serif; font-size: 15px; color: ${TEXT_MID}; line-height: 1.7;">
                Abbiamo analizzato le tue risposte e preparato una routine personalizzata per i tuoi ricci. Segui i passaggi qui sotto e scopri i prodotti pensati apposta per te.
              </p>
            </td>
          </tr>

          <!-- Routine steps -->
          <tr>
            <td class="content-cell" style="background: white; padding: 20px 32px 28px 32px;">
              <p style="margin: 0 0 16px 0; font-family: sans-serif; font-size: 11px; font-weight: 700; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.1em;">
                La tua routine
              </p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${passiHTML}
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="background: white; padding: 0 32px;">
              <div style="height: 1px; background: ${PINK_LIGHT};"></div>
            </td>
          </tr>

          <!-- Prodotti -->
          <tr>
            <td class="content-cell" style="background: white; padding: 24px 32px 32px 32px; border-radius: 0 0 20px 20px;">
              <p style="margin: 0 0 16px 0; font-family: sans-serif; font-size: 11px; font-weight: 700; color: ${PINK}; text-transform: uppercase; letter-spacing: 0.1em;">
                Prodotti consigliati
              </p>
              ${prodottiHTML}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 0 8px 0; text-align: center;">
              <p style="margin: 0; font-family: sans-serif; font-size: 12px; color: ${TEXT_SOFT};">
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

// ─── Endpoint principal ──────────────────────────────────────────────────────
app.post("/api/subscribe", async (req, res) => {
  try {
    const { email, name, phone, rutina, prodotti } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // ── 1. Klaviyo: suscribir ────────────────────────────────────────────────
    const headers = {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
      revision: "2026-04-15",
    };

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
              first_name: name || undefined,
              phone_number: phone || undefined,
            },
          },
        },
        { headers }
      );
    }

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

    // ── 2. Resend: enviar email con la rutina ────────────────────────────────
    if (rutina && prodotti) {
      // Separar título y pasos del texto de rutina
      const lineas = rutina.split("\n- ").filter((r) => r.trim() !== "");
      const passi = lineas.slice(1); // quitar primera línea (título)

      const html = generaEmailHTML({
        nome: name || "amica",
        passi,
        prodotti,
      });

      await resend.emails.send({
        from: "La Ragazza Riccia <info@hugoorielso.com>",
        to: email,
        subject: `La tua routine personalizzata è pronta, ${name || "amica"}! 🌀`,
        html,
      });
    }

    return res.status(200).json({
      success: true,
      message: existingProfile?.id
        ? "Existing user subscribed and email sent"
        : "New user created, subscribed and email sent",
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

export default app;