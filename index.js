import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { Resend } from "resend";
import MailChecker from "mailchecker";
import dns from "dns/promises";

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

dotenv.config();

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://frontend-riccia-test.vercel.app",
  "https://laragazzariccia.com",
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

function generaEmailHTML({ nome, passi, prodotti }) {
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

          <tr>
            <td class="content-cell" style="background: white; padding: 6px 26px 12px 26px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>${prodottiHTML}</tr>
              </table>
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
                Per qualsiasi dubbio puoi contattarci anche su WhatsApp al <strong style="color: ${TEXT_DARK};">+39 351 610 1655</strong>.
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

app.post("/api/subscribe", async (req, res) => {
  try {
    const { email, name, phone, rutina, prodotti, newsletterConsent } = req.body;

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
              properties: {
                privacy_policy_confirmed: true,
                newsletter_opt_in: Boolean(newsletterConsent),
              },
            },
          },
        },
        { headers }
      );
    }

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

    if (rutina && prodotti) {
      const lineas = rutina.split("\n- ").filter((r) => r.trim() !== "");
      const passi = lineas.slice(1);

      const html = generaEmailHTML({
        nome: name || "amica",
        passi,
        prodotti,
      });

      const { data: resendData, error: resendError } = await resend.emails.send({
        from: "La Ragazza Riccia <info@laragazzariccia.com>",
        to: email,
        subject: `La tua routine personalizzata è pronta, ${name || "amica"}!`,
        html,
      });

      console.log(resendError, resendData);

      if (resendError) {
        console.error("Resend error:", resendError);
        return res.status(200).json({
          success: true,
          emailError: true,
          message: "Iscrizione completata, ma l'email non è stata consegnata.",
          resendError: resendError.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      emailError: false,
      message: existingProfile?.id
        ? "Existing user updated and email sent"
        : "New user created and email sent",
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

export default app;
